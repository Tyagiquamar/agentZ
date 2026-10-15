package launcher

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/jsonrpc"
	"github.com/urfave/cli/v3"

	gatewayapi "github.com/accuknox/agentz/internal/gateway/openapi"
)

// Generate from the stock Codex 0.162.1 checkout, including experimental OAuth.
//go:generate go run github.com/atombender/go-jsonschema@981317255fca --only-models --struct-name-from-title --tags json -p launcher -o codex_protocol.gen.go ../../.ref/codex/codex-rs/app-server-protocol/schema/json/v1/InitializeParams.json ../../.ref/codex/codex-rs/app-server-protocol/schema/json/v2/GatewayOAuthReadResponse.json ../../.ref/codex/codex-rs/app-server-protocol/schema/json/v2/GatewayOAuthChangedNotification.json

// Codex's stdio envelope omits the JSON-RPC version field. Payloads use the
// generated native protocol. This client sends only numeric request IDs.
type codexRPC struct {
	ID     int             `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *jsonrpc.Error  `json:"error,omitempty"`
}

type codexCatalog struct {
	Models []json.RawMessage `json:"models"`
}

type codexReasoningLevel struct {
	Effort      string `json:"effort"`
	Description string `json:"description"`
}

type codexTruncation struct {
	Mode  string `json:"mode"`
	Limit int    `json:"limit"`
}

// Required fields match Codex's ModelInfo contract. Unknown upstream models
// use client-side function tools and explicit limits from the approved catalog.
type codexModel struct {
	Slug                       string                              `json:"slug"`
	DisplayName                string                              `json:"display_name"`
	SupportedReasoningLevels   []codexReasoningLevel               `json:"supported_reasoning_levels"`
	ShellType                  string                              `json:"shell_type"`
	Visibility                 string                              `json:"visibility"`
	SupportedInAPI             bool                                `json:"supported_in_api"`
	Priority                   int                                 `json:"priority"`
	SupportVerbosity           bool                                `json:"support_verbosity"`
	SupportsReasoningSummary   bool                                `json:"supports_reasoning_summary_parameter"`
	DefaultReasoningSummary    string                              `json:"default_reasoning_summary"`
	TruncationPolicy           codexTruncation                     `json:"truncation_policy"`
	ExperimentalSupportedTools []string                            `json:"experimental_supported_tools"`
	InputModalities            []gatewayapi.InferenceModelModality `json:"input_modalities"`
	ContextWindow              int32                               `json:"context_window"`
	MaxContextWindow           int32                               `json:"max_context_window"`
	EffectiveContextWindow     int                                 `json:"effective_context_window_percent"`
	BaseInstructions           string                              `json:"base_instructions"`
	ToolMode                   string                              `json:"tool_mode"`
}

func (installed *installation) codex(ctx context.Context, command *cli.Command, args []string) error {
	profile := filepath.Join(installed.profile, "codex")
	if err := os.MkdirAll(profile, 0700); err != nil {
		return err
	}
	environment := slices.DeleteFunc(os.Environ(), func(entry string) bool {
		name, _, _ := strings.Cut(entry, "=")
		if runtime.GOOS == "windows" {
			name = strings.ToUpper(name)
		}
		return name == "CODEX_HOME" || name == "CODEX_API_KEY" || strings.HasPrefix(name, "OPENAI_")
	})
	environment = append(environment, "CODEX_HOME="+profile)
	// JSON strings are valid TOML basic strings, including Windows paths.
	client, _ := json.Marshal(installed.ClientID)
	authorize, _ := json.Marshal(installed.upstream.String() + "/api/auth/oauth2/authorize?prompt=consent")
	token, _ := json.Marshal(installed.address + "/oauth/token")
	resource, _ := json.Marshal(installed.upstream.String() + "/api/inference/v1")
	mcpURL, _ := json.Marshal(installed.upstream.String() + "/api/mcp")
	provider := fmt.Sprintf(
		`model_providers.agentz={name="AgentZ",base_url=%s,wire_api="responses",requires_openai_auth=false,supports_websockets=false,gateway_oauth={authorization_url=%s,token_url=%s,client_id=%s,resource=%s,scopes=["openid","profile","email","offline_access","inference:use"],redirect_port=8766,delivery={kind="header",name="X-AgentZ-Authorization",scheme="Bearer"}}}`,
		resource, authorize, token, client, resource,
	)
	mcp := fmt.Sprintf(
		`mcp_servers.agentz={url=%s,scopes=["mcp:use","offline_access"],oauth={client_id=%s,callback_port=8767,callback_url="http://127.0.0.1:8767/callback"}}`,
		mcpURL, client,
	)
	flags := make([]string, 0, 14+len(args))
	flags = append(flags,
		"-c", `model_provider="agentz"`, "-c", `web_search="disabled"`,
		"-c", "mcp_oauth_callback_port=8767", "-c", provider, "-c", mcp,
	)
	mcpCommand := len(args) > 1 && args[1] == "mcp"
	// MCP owns a separate OAuth grant and does not need an inference login.
	if !mcpCommand {
		cache := filepath.Join(installed.profile, "codex-catalog.json")
		_, err := os.Stat(cache)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		login := command.Name == "login" || errors.Is(err, os.ErrNotExist)
		if err := installed.codexLogin(ctx, command, flags, environment, login); err != nil {
			return err
		}
		data, err := os.ReadFile(cache)
		if err != nil {
			return fmt.Errorf("read approved models; run agentz login codex with the same --profile: %w", err)
		}
		var approved gatewayapi.DelegationCatalog
		if err := json.Unmarshal(data, &approved); err != nil {
			return fmt.Errorf("read approved models: %w", err)
		}
		modelFile := filepath.Join(profile, "models.json")
		model, err := installed.codexModels(ctx, approved, modelFile, environment)
		if err != nil {
			return err
		}
		if command.Name == "login" {
			fmt.Fprintln(command.Writer, "Codex is connected.")
			return nil
		}
		modelJSON, _ := json.Marshal(model)
		fileJSON, _ := json.Marshal(modelFile)
		flags = append(flags, "-c", "model="+string(modelJSON), "-c", "model_catalog_json="+string(fileJSON))
	}
	flags = append(flags, args[1:]...)
	child := exec.CommandContext(ctx, "codex", flags...)
	child.Env = environment
	child.Stdin, child.Stdout, child.Stderr = os.Stdin, command.Writer, command.ErrWriter
	if err := child.Run(); err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			message := "Codex exited."
			if !mcpCommand {
				message += " To grant fresh access, run agentz login codex with the same --profile."
			}
			return cli.Exit(message, exit.ExitCode())
		}
		return err
	}
	return nil
}

func (installed *installation) codexLogin(ctx context.Context, command *cli.Command, flags, environment []string, login bool) error {
	ctx, stop := signal.NotifyContext(ctx, os.Interrupt)
	defer stop()
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	args := append([]string{"app-server", "--strict-config"}, flags...)
	child := exec.CommandContext(ctx, "codex", args...)
	child.Env, child.Stderr = environment, command.ErrWriter
	input, err := child.StdinPipe()
	if err != nil {
		return err
	}
	output, err := child.StdoutPipe()
	if err != nil {
		input.Close()
		return err
	}
	if err := child.Start(); err != nil {
		input.Close()
		output.Close()
		return err
	}
	defer func() {
		input.Close()
		cancel()
		child.Wait()
	}()
	encoder := json.NewEncoder(input)
	initialize, err := json.Marshal(InitializeParams{
		ClientInfo: ClientInfo{Name: "agentz", Version: command.Root().Version},
		Capabilities: &InitializeParamsCapabilities{
			ExperimentalApi:      true,
			ExplicitGatewayOauth: new(true),
		},
	})
	if err != nil {
		return err
	}
	if err := encoder.Encode(codexRPC{ID: 1, Method: "initialize", Params: initialize}); err != nil {
		return err
	}
	scanner := bufio.NewScanner(output)
	scanner.Buffer(make([]byte, 64<<10), 2<<20)
	for scanner.Scan() {
		var message codexRPC
		if err := json.Unmarshal(scanner.Bytes(), &message); err != nil {
			return fmt.Errorf("read Codex protocol: %w", err)
		}
		if message.Error != nil {
			return fmt.Errorf("codex gateway login: %s", message.Error.Message)
		}
		if message.Method == "account/gatewayOAuth/changed" {
			var changed GatewayOAuthChangedNotification
			if err := json.Unmarshal(message.Params, &changed); err != nil {
				return err
			}
			if changed.AuthUrl != nil {
				fmt.Fprintln(command.Writer, "Complete Codex's native browser login:", *changed.AuthUrl)
				var browser []string
				switch runtime.GOOS {
				case "darwin":
					browser = []string{"open", *changed.AuthUrl}
				case "windows":
					browser = []string{"rundll32", "url.dll,FileProtocolHandler", *changed.AuthUrl}
				case "linux":
					if os.Getenv("DISPLAY") != "" || os.Getenv("WAYLAND_DISPLAY") != "" {
						browser = []string{"xdg-open", *changed.AuthUrl}
					}
				}
				if len(browser) > 0 {
					opener := exec.CommandContext(ctx, browser[0], browser[1:]...)
					if err := opener.Start(); err == nil {
						go func() { opener.Wait() }()
					}
				}
			}
			continue
		}
		switch message.ID {
		case 1:
			if err := encoder.Encode(codexRPC{Method: "initialized"}); err != nil {
				return err
			}
			if err := encoder.Encode(codexRPC{ID: 2, Method: "account/gatewayOAuth/read"}); err != nil {
				return err
			}
		case 2:
			var state GatewayOAuthReadResponse
			if err := json.Unmarshal(message.Result, &state); err != nil {
				return err
			}
			if !state.Required {
				return errors.New("codex did not select the AgentZ OAuth provider")
			}
			if !login {
				return nil
			}
			if err := encoder.Encode(codexRPC{ID: 3, Method: "account/gatewayOAuth/login"}); err != nil {
				return err
			}
		case 3:
			return nil
		}
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	return errors.New("codex stopped before gateway login completed")
}

func (installed *installation) codexModels(ctx context.Context, approved gatewayapi.DelegationCatalog, name string, environment []string) (string, error) {
	child := exec.CommandContext(ctx, "codex", "debug", "models", "--bundled")
	child.Env = environment
	data, err := child.Output()
	if err != nil {
		return "", fmt.Errorf("read Codex's version-matched model catalog: %w", err)
	}
	var bundled codexCatalog
	if err := json.Unmarshal(data, &bundled); err != nil {
		return "", err
	}
	catalog := codexCatalog{Models: []json.RawMessage{}}
	first := ""
	for _, selected := range approved.Models {
		if selected.ModelInfo == nil || selected.ApiCompatibility == nil {
			continue
		}
		supported := slices.ContainsFunc(*selected.ApiCompatibility, func(api gatewayapi.DelegationAPICompatibility) bool {
			return api.Api == gatewayapi.Responses && api.Support == gatewayapi.Native
		})
		if !supported || !selected.ModelInfo.Capabilities.ToolCall {
			continue
		}
		model := codexModel{
			Slug: selected.Id, DisplayName: selected.ModelDisplayName,
			SupportedReasoningLevels: []codexReasoningLevel{}, ShellType: "unified_exec",
			Visibility: "list", SupportedInAPI: true, Priority: len(catalog.Models),
			DefaultReasoningSummary: "none", TruncationPolicy: codexTruncation{Mode: "bytes", Limit: 10000},
			ExperimentalSupportedTools: []string{}, InputModalities: []gatewayapi.InferenceModelModality{gatewayapi.InferenceModelModalityText},
			ContextWindow: selected.ModelInfo.Limits.Context, MaxContextWindow: selected.ModelInfo.Limits.Context,
			EffectiveContextWindow: 95, ToolMode: "direct",
			BaseInstructions: "You are a coding agent. Inspect the project, use the available client tools to make the requested changes, and verify them. Provider-hosted tools and stored conversations are unavailable.",
		}
		if slices.Contains(selected.ModelInfo.Modalities.Input, gatewayapi.InferenceModelModalityImage) {
			model.InputModalities = append(model.InputModalities, gatewayapi.InferenceModelModalityImage)
		}
		entry, err := json.Marshal(model)
		if err != nil {
			return "", err
		}
		for _, raw := range bundled.Models {
			var native codexModel
			if err := json.Unmarshal(raw, &native); err != nil {
				return "", err
			}
			if native.Slug != selected.Model {
				continue
			}
			// Preserve the full native descriptor; change only alias and routing
			// metadata documented by Codex for gateway catalogs.
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(raw, &fields); err != nil {
				return "", err
			}
			fields["slug"], _ = json.Marshal(model.Slug)
			fields["display_name"], _ = json.Marshal(model.DisplayName)
			fields["priority"], _ = json.Marshal(model.Priority)
			fields["visibility"] = json.RawMessage(`"list"`)
			fields["upgrade"] = json.RawMessage("null")
			entry, err = json.Marshal(fields)
			if err != nil {
				return "", err
			}
			break
		}
		if first == "" {
			first = model.Slug
		}
		catalog.Models = append(catalog.Models, entry)
	}
	if first == "" {
		return "", errors.New(
			"no approved native Responses model supports Codex tools; run agentz login codex and select a native Responses model",
		)
	}
	data, err = json.Marshal(catalog)
	if err != nil {
		return "", err
	}
	return first, writeProfileFile(name, data)
}
