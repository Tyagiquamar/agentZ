package inference

import (
	"errors"
	"strings"

	kjson "sigs.k8s.io/json"
)

// ValidateDelegatedMessages admits inline Anthropic input and local tools. A
// model grant does not authorize the provider's files, containers or hosted MCP.
func ValidateDelegatedMessages(body []byte, countTokens bool) (*DelegatedRequest, error) {
	var fields map[string]any
	strictErrors, err := kjson.UnmarshalStrict(body, &fields, kjson.DisallowDuplicateFields)
	if err != nil || len(strictErrors) != 0 || fields == nil {
		return nil, errors.New("provide a valid Messages request with no duplicate fields")
	}
	model, ok := fields["model"].(string)
	if !ok || model == "" {
		return nil, errors.New("provide a model")
	}
	if fields["container"] != nil || fields["mcp_servers"] != nil {
		return nil, errors.New("provider containers and hosted MCP servers are unavailable")
	}
	if tools, ok := fields["tools"].([]any); ok {
		for _, value := range tools {
			tool, ok := value.(map[string]any)
			if !ok {
				return nil, errors.New("invalid Messages tool")
			}
			kind, _ := tool["type"].(string)
			if kind != "" && kind != "custom" &&
				!strings.HasPrefix(kind, "computer_") &&
				!strings.HasPrefix(kind, "bash_") &&
				!strings.HasPrefix(kind, "text_editor_") {
				return nil, errors.New("use client-side tools; provider hosted tools are unavailable")
			}
		}
	}
	if hasStoredAnthropicContent(fields["messages"]) || hasStoredAnthropicContent(fields["system"]) {
		return nil, errors.New("provider files are unavailable; provide inline content or a URL")
	}
	endpoint := "/messages"
	if countTokens {
		endpoint += "/count_tokens"
	}
	stream, _ := fields["stream"].(bool)
	return &DelegatedRequest{Model: model, Stream: stream, endpoint: endpoint}, nil
}

func hasStoredAnthropicContent(value any) bool {
	switch value := value.(type) {
	case map[string]any:
		if value["file_id"] != nil || value["type"] == "file" {
			return true
		}
		for _, child := range value {
			if hasStoredAnthropicContent(child) {
				return true
			}
		}
	case []any:
		for _, child := range value {
			if hasStoredAnthropicContent(child) {
				return true
			}
		}
	}
	return false
}
