package launcher

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

type installationTest struct {
	name     string
	config   string
	profile  string
	provider string
	wantName string
	wantURL  string
	wantID   string
	wantErr  string
}

func TestLoadInstallation(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("isolated XDG configuration directory requires Linux")
	}
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	const config = `serverURL: https://agentz.example.com
externalAgents:
  - myCodex:
      provider: codex
      clientID: codex-client
  - myClaude:
      provider: claude
      clientID: claude-client
  - workClaude:
      provider: claude
      serverUrl: https://work.example.com/
      clientID: work-client
`
	tests := []installationTest{
		{
			name:     "first entry",
			config:   config,
			wantName: "myCodex",
			wantURL:  "https://agentz.example.com",
			wantID:   "codex-client",
		},
		{
			name:     "first Claude",
			config:   config,
			provider: "claude",
			wantName: "myClaude",
			wantURL:  "https://agentz.example.com",
			wantID:   "claude-client",
		},
		{
			name:     "first Codex",
			config:   config,
			provider: "codex",
			wantName: "myCodex",
			wantURL:  "https://agentz.example.com",
			wantID:   "codex-client",
		},
		{
			name:     "named override",
			config:   config,
			profile:  "workClaude",
			provider: "claude",
			wantName: "workClaude",
			wantURL:  "https://work.example.com",
			wantID:   "work-client",
		},
		{
			name:     "infer provider",
			config:   config,
			profile:  "myClaude",
			wantName: "myClaude",
			wantURL:  "https://agentz.example.com",
			wantID:   "claude-client",
		},
		{
			name:    "unknown profile",
			config:  config,
			profile: "missing",
			wantErr: `profile "missing" was not found`,
		},
		{
			name:     "provider mismatch",
			config:   config,
			profile:  "myCodex",
			provider: "claude",
			wantErr:  "uses codex, not claude",
		},
		{
			name:     "missing provider",
			config:   strings.ReplaceAll(config, "provider: claude", "provider: codex"),
			provider: "claude",
			wantErr:  "no external agent profile is configured for claude",
		},
		{
			name:    "duplicate profile",
			config:  strings.ReplaceAll(config, "workClaude:", "myClaude:"),
			wantErr: "duplicate external agent profile",
		},
		{
			name:    "unsupported provider",
			config:  strings.ReplaceAll(config, "provider: codex", "provider: other"),
			wantErr: "provider must be claude or codex",
		},
		{
			name:    "empty name",
			config:  strings.ReplaceAll(config, "myCodex:", `"":`),
			wantErr: "names must not be empty",
		},
		{
			name:    "empty list",
			config:  "externalAgents: []\n",
			wantErr: "at least one named agent",
		},
		{
			name:    "empty entry",
			config:  "externalAgents:\n  - {}\n",
			wantErr: "exactly one named agent",
		},
		{
			name:    "multiple names per entry",
			config:  "externalAgents:\n  - a: {provider: codex}\n    b: {provider: claude}\n",
			wantErr: "exactly one named agent",
		},
		{
			name:    "unknown field",
			config:  config + "unknown: true\n",
			wantErr: "field unknown not found",
		},
		{
			name:    "unknown agent field",
			config:  strings.Replace(config, "clientID: codex-client", "clientId: codex-client", 1),
			wantErr: "field clientId not found",
		},
		{
			name:    "multiple documents",
			config:  config + "---\nserverURL: https://other.example.com\n",
			wantErr: "one YAML document",
		},
		{
			name:    "missing server",
			config:  strings.ReplaceAll(config, "serverURL: https://agentz.example.com\n", ""),
			wantErr: "HTTPS origin",
		},
		{
			name:     "override without shared server",
			config:   strings.ReplaceAll(config, "serverURL: https://agentz.example.com\n", ""),
			profile:  "workClaude",
			wantName: "workClaude",
			wantURL:  "https://work.example.com",
			wantID:   "work-client",
		},
		{
			name:    "public HTTP",
			config:  strings.ReplaceAll(config, "https://agentz.example.com", "http://agentz.example.com"),
			wantErr: "HTTPS origin",
		},
		{
			name:    "override public HTTP",
			config:  strings.ReplaceAll(config, "https://work.example.com/", "http://work.example.com"),
			profile: "workClaude",
			wantErr: "HTTPS origin",
		},
		{
			name:    "URL path",
			config:  strings.ReplaceAll(config, "https://agentz.example.com", "https://agentz.example.com/api"),
			wantErr: "HTTPS origin",
		},
		{
			name:    "URL credentials",
			config:  strings.ReplaceAll(config, "https://agentz.example.com", "https://user:pass@agentz.example.com"),
			wantErr: "HTTPS origin",
		},
		{
			name:    "URL query",
			config:  strings.ReplaceAll(config, "https://agentz.example.com", "https://agentz.example.com/?foo=bar"),
			wantErr: "HTTPS origin",
		},
		{
			name:    "missing client ID",
			config:  strings.ReplaceAll(config, "clientID: codex-client", `clientID: ""`),
			wantErr: "clientID must be",
		},
		{
			name:    "invalid client ID",
			config:  strings.ReplaceAll(config, "clientID: codex-client", "clientID: contains spaces"),
			wantErr: "clientID must be",
		},
		{
			name:     "loopback HTTP",
			config:   strings.ReplaceAll(config, "https://agentz.example.com", "http://127.0.0.1:3000"),
			wantName: "myCodex",
			wantURL:  "http://127.0.0.1:3000",
			wantID:   "codex-client",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			configPath := filepath.Join(t.TempDir(), "config.yaml")
			if err := os.WriteFile(configPath, []byte(tt.config), 0600); err != nil {
				t.Fatal(err)
			}
			installed, err := loadInstallation(context.Background(), configPath, tt.profile, tt.provider)
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("error = %v, want %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if installed.name != tt.wantName || installed.upstream.String() != tt.wantURL || installed.ClientID != tt.wantID {
				t.Fatalf("selected %s at %s with client %s", installed.name, installed.upstream, installed.ClientID)
			}
			data, err := os.ReadFile(configPath)
			if err != nil {
				t.Fatal(err)
			}
			if string(data) != tt.config {
				t.Fatal("loading a profile changed the configuration file")
			}
		})
	}
}

func TestProfileIdentity(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("isolated XDG configuration directory requires Linux")
	}
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	configPath := filepath.Join(t.TempDir(), "config.yaml")
	const first = `serverURL: https://agentz.example.com
externalAgents:
  - personal: {provider: claude, clientID: personal-client}
  - work: {provider: claude, clientID: work-client}
`
	if err := os.WriteFile(configPath, []byte(first), 0600); err != nil {
		t.Fatal(err)
	}
	personal, err := loadInstallation(context.Background(), configPath, "personal", "claude")
	if err != nil {
		t.Fatal(err)
	}
	work, err := loadInstallation(context.Background(), configPath, "work", "claude")
	if err != nil {
		t.Fatal(err)
	}
	if personal.profile == work.profile || personal.ownerKey == work.ownerKey {
		t.Fatal("different clients share a profile or relay key")
	}
	const reordered = `serverURL: https://unused.example.com
externalAgents:
  - work: {provider: claude, clientID: work-client}
  - renamed: {provider: claude, serverUrl: https://agentz.example.com/, clientID: personal-client}
`
	if err := os.WriteFile(configPath, []byte(reordered), 0600); err != nil {
		t.Fatal(err)
	}
	renamed, err := loadInstallation(context.Background(), configPath, "renamed", "claude")
	if err != nil {
		t.Fatal(err)
	}
	if renamed.profile != personal.profile || renamed.ownerKey != personal.ownerKey || renamed.address != personal.address {
		t.Fatal("renaming, reordering, or explicitly setting the same server changed the profile identity")
	}
}
