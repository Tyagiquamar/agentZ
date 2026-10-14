package inference

import "testing"

func TestDelegatedResponsesTools(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		body  string
		valid bool
	}{
		{"function", `{"tools":[{"type":"function","name":"echo"}]}`, true},
		{"custom client tool", `{"tools":[{"type":"custom","name":"apply_patch"}]}`, true},
		{"namespace", `{"tools":[{"type":"namespace","name":"functions","tools":[{"type":"function"},{"type":"custom"}]}]}`, true},
		{"nested namespace", `{"tools":[{"type":"namespace","tools":[{"type":"namespace","tools":[{"type":"function"}]}]}]}`, true},
		{"hosted search", `{"tools":[{"type":"web_search"}]}`, false},
		{"wrapped hosted search", `{"tools":[{"type":"namespace","tools":[{"type":"web_search"}]}]}`, false},
		{"wrapped hosted MCP", `{"tools":[{"type":"namespace","tools":[{"type":"mcp"}]}]}`, false},
		{"unknown tool", `{"tools":[{"type":"new_hosted_tool"}]}`, false},
		{"duplicate nested tool type", `{"tools":[{"type":"namespace","tools":[{"type":"function","type":"mcp"}]}]}`, false},
		{"custom inline output", `{"input":[{"type":"custom_tool_call_output","output":[{"type":"input_text","text":"ok"}]}]}`, true},
		{"custom stored file output", `{"input":[{"type":"custom_tool_call_output","output":[{"file_id":"secret"}]}]}`, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ValidateDelegatedRequest(
				[]byte(`{"model":"gpt-4.1-mini","store":false,`+tt.body[1:]), true,
			)
			if (err == nil) != tt.valid {
				t.Fatalf("valid=%v, error=%v", tt.valid, err)
			}
		})
	}
	for _, kind := range []string{"custom", "namespace"} {
		t.Run("chat completions rejects "+kind, func(t *testing.T) {
			_, err := ValidateDelegatedRequest([]byte(`{"model":"gpt","tools":[{"type":"`+kind+`"}]}`), false)
			if err == nil {
				t.Fatal("unexpectedly accepted Responses tool in Chat Completions")
			}
		})
	}
}
