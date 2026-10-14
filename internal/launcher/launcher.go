// Package launcher coordinates native coding-agent profiles and a loopback relay.
package launcher

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/urfave/cli/v3"
	"go.yaml.in/yaml/v3"
)

type configuration struct {
	ServerURL string `yaml:"server_url"`
	ClientID  string `yaml:"client_id"`
}

type installation struct {
	configuration
	configPath string
	profile    string
	address    string
	ownerKey   string
	upstream   *url.URL
}

// Run executes desktop commands without loading server or Kubernetes services.
func Run(ctx context.Context, command *cli.Command) error {
	if command.Name != "launch" {
		var cancel context.CancelFunc
		ctx, cancel = signal.NotifyContext(ctx, os.Interrupt)
		defer cancel()
	}
	if command.Name == "launch" {
		args := command.Args().Slice()
		if len(args) == 0 || args[0] != "claude" {
			return errors.New("usage: agentz [--config FILE] launch claude [Claude flags]")
		}
		if _, err := exec.LookPath(args[0]); err != nil {
			return fmt.Errorf("install Claude Code before launching it: %w", err)
		}
		version, err := exec.CommandContext(ctx, args[0], "--version").Output()
		if err != nil {
			return fmt.Errorf("read Claude version: %w", err)
		}
		var major, minor, patch int
		if _, err := fmt.Sscanf(string(version), "%d.%d.%d", &major, &minor, &patch); err != nil {
			return fmt.Errorf("read Claude version: %w", err)
		}
		if major < 2 || major == 2 && (minor < 1 || minor == 1 && patch < 299) {
			return errors.New("AgentZ requires Claude Code 2.1.299 or later; run claude update")
		}
	}
	installed, err := loadInstallation(ctx, command.String("config"))
	if err != nil {
		return err
	}
	switch command.Name {
	case "serve":
		return installed.serve(ctx)
	case "status", "stop":
		response, err := installed.controlRelay(ctx, command.Name)
		if err != nil {
			return err
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			return fmt.Errorf("relay returned HTTP %d", response.StatusCode)
		}
		_, err = io.Copy(command.Writer, response.Body)
		return err
	case "launch":
		if err := installed.ensureRelay(ctx); err != nil {
			return err
		}
		profile := filepath.Join(installed.profile, "claude")
		if err := os.MkdirAll(profile, 0700); err != nil {
			return err
		}
		// Keep native preferences and credentials. Only gateway selection belongs
		// to the launcher; models arrive through authenticated managed settings.
		settingsPath := filepath.Join(profile, "settings.json")
		settings := make(map[string]json.RawMessage)
		data, err := os.ReadFile(settingsPath)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if err == nil {
			if err := json.Unmarshal(data, &settings); err != nil {
				return fmt.Errorf("read Claude settings: %w", err)
			}
			if settings == nil {
				return errors.New("expected a JSON object in Claude settings")
			}
		}
		gateway, err := json.Marshal(installed.address)
		if err != nil {
			return err
		}
		settings["forceLoginMethod"] = json.RawMessage(`"gateway"`)
		settings["forceLoginGatewayUrl"] = gateway
		data, err = json.MarshalIndent(settings, "", "  ")
		if err != nil {
			return err
		}
		// Rename protects readers from truncated JSON during concurrent launches.
		file, err := os.CreateTemp(profile, ".settings-*")
		if err != nil {
			return err
		}
		defer os.Remove(file.Name())
		_, writeErr := file.Write(data)
		err = errors.Join(writeErr, file.Close())
		if err != nil {
			return err
		}
		if err := os.Rename(file.Name(), settingsPath); err != nil {
			return err
		}
		args := command.Args().Slice()
		child := exec.CommandContext(ctx, args[0], args[1:]...)
		child.Stdin, child.Stdout, child.Stderr = os.Stdin, command.Writer, command.ErrWriter
		child.Env = slices.DeleteFunc(os.Environ(), func(entry string) bool {
			name, _, _ := strings.Cut(entry, "=")
			if runtime.GOOS == "windows" {
				name = strings.ToUpper(name)
			}
			return name == "CLAUDE_CONFIG_DIR" || name == "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY" ||
				strings.HasPrefix(name, "ANTHROPIC_") || name == "CLAUDE_CODE_OAUTH_TOKEN" ||
				name == "CLAUDE_CODE_USE_BEDROCK" || name == "CLAUDE_CODE_USE_VERTEX" ||
				name == "CLAUDE_CODE_USE_FOUNDRY" || name == "CLAUDE_CODE_USE_MANTLE"
		})
		child.Env = append(child.Env, "CLAUDE_CONFIG_DIR="+profile, "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1")
		if err := child.Run(); err != nil {
			var exit *exec.ExitError
			if errors.As(err, &exit) {
				return cli.Exit("Claude exited", exit.ExitCode())
			}
			return err
		}
		return nil
	default:
		return fmt.Errorf("unknown command %q", command.Name)
	}
}

func loadInstallation(ctx context.Context, configPath string) (*installation, error) {
	root, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}
	if configPath == "" {
		configPath = filepath.Join(root, "agentz", "config.yaml")
	}
	configPath, err = filepath.Abs(configPath)
	if err != nil {
		return nil, err
	}
	file, err := os.Open(configPath)
	if err != nil {
		return nil, fmt.Errorf("read %s; create it with server_url and client_id from your native OAuth application: %w", configPath, err)
	}
	defer file.Close()
	var config configuration
	decoder := yaml.NewDecoder(io.LimitReader(file, 64<<10))
	decoder.KnownFields(true)
	if err := decoder.Decode(&config); err != nil {
		return nil, fmt.Errorf("read AgentZ configuration: %w", err)
	}
	if err := decoder.Decode(new(configuration)); err != io.EOF {
		return nil, errors.New("AgentZ configuration must contain one YAML document")
	}
	upstream, err := url.Parse(config.ServerURL)
	if err != nil {
		return nil, fmt.Errorf("invalid server_url: %w", err)
	}
	loopback := upstream.Hostname() == "localhost" || upstream.Hostname() == "127.0.0.1" || upstream.Hostname() == "::1"
	secure := upstream.Scheme == "https" || upstream.Scheme == "http" && loopback
	invalidOrigin := upstream.Host == "" || upstream.User != nil || upstream.RawQuery != "" || upstream.Fragment != "" ||
		(upstream.Path != "" && upstream.Path != "/") || !secure
	if invalidOrigin {
		return nil, errors.New("server_url must be an HTTPS origin; HTTP is allowed only on loopback for development")
	}
	if config.ClientID == "" || strings.ContainsAny(config.ClientID, "\r\n\t ") {
		return nil, errors.New("client_id must be the public native OAuth application's client ID")
	}
	upstream.Path = ""
	digest := sha256.Sum256([]byte(upstream.String() + "\x00" + config.ClientID))
	profile := filepath.Join(root, "agentz", "profiles", hex.EncodeToString(digest[:8]))
	if err := os.MkdirAll(profile, 0700); err != nil {
		return nil, err
	}
	keyPath := filepath.Join(profile, "relay.key")
	key, err := os.OpenFile(keyPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err == nil {
		_, writeErr := key.WriteString(hex.EncodeToString([]byte(rand.Text())))
		err = errors.Join(writeErr, key.Close())
		if err != nil {
			return nil, err
		}
	}
	if err != nil && !errors.Is(err, os.ErrExist) {
		return nil, err
	}
	// An exclusive creator may still be writing the key when another launcher
	// arrives. No process guesses identity from a listening port alone.
	var ownerKey []byte
	for attempt := 0; attempt < 20; attempt++ {
		ownerKey, err = os.ReadFile(keyPath)
		if err != nil {
			return nil, err
		}
		if len(ownerKey) >= 32 {
			break
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(25 * time.Millisecond):
		}
	}
	if len(ownerKey) < 32 {
		return nil, errors.New("relay identity file is empty; remove it and launch again")
	}
	port := 20000 + (int(digest[0])<<8|int(digest[1]))%30000
	return &installation{
		configuration: config, configPath: configPath, profile: profile,
		address: "http://127.0.0.1:" + strconv.Itoa(port), ownerKey: string(ownerKey), upstream: upstream,
	}, nil
}

func (installed *installation) ensureRelay(ctx context.Context) error {
	ready := func() bool {
		response, err := installed.controlRelay(ctx, "status")
		if err != nil {
			return false
		}
		response.Body.Close()
		return true
	}
	if ready() {
		return nil
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	log, err := os.OpenFile(filepath.Join(installed.profile, "relay.log"), os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0600)
	if err != nil {
		return err
	}
	defer log.Close()
	child := exec.Command(executable, "--config", installed.configPath, "relay", "serve")
	child.Stdout, child.Stderr = log, log
	if err := startRelay(child); err != nil {
		return err
	}
	for attempt := 0; attempt < 50; attempt++ {
		if ready() {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
	return errors.New("relay could not start; check the profile's relay.log for a port conflict")
}

func (installed *installation) controlRelay(ctx context.Context, operation string) (*http.Response, error) {
	method := http.MethodGet
	if operation == "stop" {
		method = http.MethodPost
	}
	request, err := http.NewRequestWithContext(ctx, method, installed.address+"/relay/"+operation, nil)
	if err != nil {
		return nil, err
	}
	nonce := strconv.FormatInt(time.Now().Unix(), 10) + ":" + rand.Text()
	message := operation + ":" + nonce
	signature := hmac.New(sha256.New, []byte(installed.ownerKey))
	signature.Write([]byte(message))
	request.Header.Set("X-AgentZ-Relay-Nonce", nonce)
	request.Header.Set("Authorization", "AgentZ-HMAC "+hex.EncodeToString(signature.Sum(nil)))
	client := &http.Client{
		Timeout:       time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("AgentZ relay is unavailable: %w", err)
	}
	signature.Reset()
	signature.Write([]byte("response:" + message))
	expected := hex.EncodeToString(signature.Sum(nil))
	verified := false
	if response.StatusCode == http.StatusOK {
		verified = hmac.Equal([]byte(response.Header.Get("X-AgentZ-Relay-Proof")), []byte(expected))
	}
	if !verified {
		response.Body.Close()
		return nil, errors.New("the listening process did not prove it owns this AgentZ profile")
	}
	return response, nil
}
