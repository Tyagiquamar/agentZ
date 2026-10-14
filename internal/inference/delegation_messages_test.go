package inference

import (
	"testing"

	agentzv1alpha1 "github.com/accuknox/agentz/pkg/apis/agentz/v1alpha1"
)

func TestDelegatedMessages(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		body  string
		valid bool
	}{
		{"text", `{"model":"claude","messages":[{"role":"user","content":"hi"}],"max_tokens":10}`, true},
		{"local tools", `{"model":"claude","tools":[{"name":"echo","input_schema":{"type":"object"}}]}`, true},
		{"custom tools", `{"model":"claude","tools":[{"type":"custom","name":"echo"}]}`, true},
		{"future optional fields", `{"model":"claude","safeguards":{"mode":"auto"},"future":{"enabled":true}}`, true},
		{"inline image", `{"model":"claude","messages":[{"content":[{"type":"image","source":{"type":"base64","data":"YQ=="}}]}]}`, true},
		{"missing model", `{"messages":[]}`, false},
		{"null", `null`, false},
		{"wrong model type", `{"model":123}`, false},
		{"duplicate model", `{"model":"allowed","model":"other"}`, false},
		{"nested duplicate", `{"model":"claude","messages":[{"content":[{"source":{"type":"file","type":"base64"}}]}]}`, false},
		{"stored file", `{"model":"claude","messages":[{"content":[{"type":"document","source":{"type":"file","file_id":"secret"}}]}]}`, false},
		{"stored tool result", `{"model":"claude","messages":[{"content":[{"type":"tool_result","content":[{"source":{"file_id":"secret"}}]}]}]}`, false},
		{"container", `{"model":"claude","container":"account-container"}`, false},
		{"hosted MCP", `{"model":"claude","mcp_servers":[]}`, false},
		{"hosted search", `{"model":"claude","tools":[{"type":"web_search_20250305"}]}`, false},
		{"hosted execution", `{"model":"claude","tools":[{"type":"code_execution_20250825"}]}`, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			input, err := ValidateDelegatedMessages([]byte(tt.body), false)
			if (err == nil) != tt.valid {
				t.Fatalf("valid = %v, error = %v", tt.valid, err)
			}
			if err == nil && input.ValidateProvider(agentzv1alpha1.InferenceProviderKindAnthropic) != nil {
				t.Fatal("Anthropic must accept Messages")
			}
			if err == nil && input.ValidateProvider(agentzv1alpha1.InferenceProviderKindOpenAICodex) == nil {
				t.Fatal("Codex must reject Messages")
			}
		})
	}
}
