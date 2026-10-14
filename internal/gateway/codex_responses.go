package gateway

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// This throwaway bridge buffers one Chat Completions result. It does not claim
// full Responses compatibility: unsupported input fails before reaching a model.
type codexResponsesBridge struct {
	model  string
	stream bool
	tools  []codexBridgeTool
}

type codexBridgeTool struct {
	Type        string            `json:"type"`
	Name        string            `json:"name"`
	Namespace   string            `json:"namespace,omitempty"`
	Description string            `json:"description"`
	Parameters  json.RawMessage   `json:"parameters"`
	Tools       []codexBridgeTool `json:"tools"`
}

type codexBridgeItem struct {
	Type      string          `json:"type"`
	Role      string          `json:"role"`
	Content   json.RawMessage `json:"content"`
	CallID    string          `json:"call_id"`
	Name      string          `json:"name"`
	Namespace string          `json:"namespace"`
	Arguments string          `json:"arguments"`
	Input     string          `json:"input"`
	Output    json.RawMessage `json:"output"`
}

func newCodexResponsesBridge(body []byte) (*codexResponsesBridge, []byte, error) {
	var input struct {
		Model           string            `json:"model"`
		Stream          bool              `json:"stream"`
		Instructions    string            `json:"instructions"`
		Input           json.RawMessage   `json:"input"`
		Tools           []codexBridgeTool `json:"tools"`
		MaxOutputTokens int               `json:"max_output_tokens"`
		ToolChoice      json.RawMessage   `json:"tool_choice"`
	}
	if err := json.Unmarshal(body, &input); err != nil {
		return nil, nil, err
	}
	b := &codexResponsesBridge{model: input.Model, stream: input.Stream}
	tools := []map[string]any{}
	var addTools func([]codexBridgeTool, string, int) error
	addTools = func(items []codexBridgeTool, namespace string, depth int) error {
		if depth > 8 {
			return errors.New("tool namespace nesting exceeds the PoC limit")
		}
		for _, tool := range items {
			if tool.Type == "namespace" {
				if namespace != "" {
					return errors.New("nested tool namespaces are unavailable in the Anthropic PoC")
				}
				if err := addTools(tool.Tools, tool.Name, depth+1); err != nil {
					return err
				}
				continue
			}
			if tool.Type != "function" && tool.Type != "custom" {
				return errors.New("unsupported Anthropic PoC tool")
			}
			tool.Namespace = namespace
			for _, existing := range b.tools {
				if existing.Name == tool.Name && existing.Namespace == namespace {
					return errors.New("duplicate tool name")
				}
			}
			alias := fmt.Sprintf("tool_%d", len(b.tools))
			b.tools = append(b.tools, tool)
			parameters := tool.Parameters
			if tool.Type == "custom" {
				parameters = json.RawMessage(`{"type":"object","properties":{"input":{"type":"string"}},"required":["input"],"additionalProperties":false}`)
			}
			if len(parameters) == 0 {
				return errors.New("function tools require parameters")
			}
			tools = append(tools, map[string]any{"type": "function", "function": map[string]any{"name": alias, "description": tool.Description, "parameters": parameters}})
		}
		return nil
	}
	if err := addTools(input.Tools, "", 0); err != nil {
		return nil, nil, err
	}
	messages := []map[string]any{}
	if input.Instructions != "" {
		messages = append(messages, map[string]any{"role": "system", "content": input.Instructions})
	}
	var items []codexBridgeItem
	if len(input.Input) > 0 && input.Input[0] == '"' {
		var text string
		if err := json.Unmarshal(input.Input, &text); err != nil {
			return nil, nil, err
		}
		messages = append(messages, map[string]any{"role": "user", "content": text})
	} else if err := json.Unmarshal(input.Input, &items); err != nil {
		return nil, nil, errors.New("provide explicit response input")
	}
	for _, item := range items {
		switch item.Type {
		case "", "message":
			role := item.Role
			if role == "developer" {
				role = "system"
			}
			if role != "system" && role != "user" && role != "assistant" {
				return nil, nil, errors.New("unsupported message role")
			}
			text, err := codexBridgeText(item.Content)
			if err != nil {
				return nil, nil, err
			}
			messages = append(messages, map[string]any{"role": role, "content": text})
		case "function_call", "custom_tool_call":
			alias, err := b.alias(item.Namespace, item.Name)
			if err != nil {
				return nil, nil, err
			}
			arguments := item.Arguments
			if item.Type == "custom_tool_call" {
				encoded, _ := json.Marshal(map[string]string{"input": item.Input})
				arguments = string(encoded)
			}
			call := map[string]any{"id": item.CallID, "type": "function", "function": map[string]any{"name": alias, "arguments": arguments}}
			// Consecutive parallel calls belong to one assistant message.
			if len(messages) > 0 && messages[len(messages)-1]["tool_calls"] != nil {
				last := messages[len(messages)-1]
				last["tool_calls"] = append(last["tool_calls"].([]any), call)
			} else {
				messages = append(messages, map[string]any{"role": "assistant", "tool_calls": []any{call}})
			}
		case "function_call_output", "custom_tool_call_output":
			text, err := codexBridgeText(item.Output)
			if err != nil {
				return nil, nil, err
			}
			messages = append(messages, map[string]any{"role": "tool", "tool_call_id": item.CallID, "content": text})
		default:
			return nil, nil, fmt.Errorf("input type %q is unavailable in the Anthropic PoC", item.Type)
		}
	}
	request := map[string]any{"model": input.Model, "stream": false, "messages": messages, "max_tokens": 4096}
	if input.MaxOutputTokens > 0 {
		request["max_tokens"] = input.MaxOutputTokens
	}
	if len(tools) > 0 {
		request["tools"] = tools
	}
	if len(input.ToolChoice) > 0 && string(input.ToolChoice) != "null" {
		var choice string
		if json.Unmarshal(input.ToolChoice, &choice) != nil || (choice != "auto" && choice != "none" && choice != "required") {
			return nil, nil, errors.New("use auto, none or required tool_choice in the Anthropic PoC")
		}
		request["tool_choice"] = choice
	}
	encoded, err := json.Marshal(request)
	return b, encoded, err
}

func codexBridgeText(raw json.RawMessage) (string, error) {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text, nil
	}
	var parts []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &parts) != nil {
		return "", errors.New("the Anthropic PoC supports text input and text tool output")
	}
	var result strings.Builder
	for _, part := range parts {
		if part.Type != "input_text" && part.Type != "output_text" && part.Type != "text" {
			return "", errors.New("the Anthropic PoC supports text input and text tool output")
		}
		result.WriteString(part.Text)
	}
	return result.String(), nil
}

func (b *codexResponsesBridge) alias(namespace, name string) (string, error) {
	for i, tool := range b.tools {
		if tool.Namespace == namespace && tool.Name == name {
			return fmt.Sprintf("tool_%d", i), nil
		}
	}
	return "", errors.New("conversation references a tool missing from this request")
}

func (b *codexResponsesBridge) modifyResponse(response *http.Response) error {
	defer response.Body.Close()
	// Bound buffering independently of the client's admission limit.
	body, err := io.ReadAll(io.LimitReader(response.Body, (16<<20)+1))
	if err != nil {
		return err
	}
	if len(body) > 16<<20 {
		return errors.New("upstream response exceeds the PoC limit")
	}
	var completion struct {
		ID      string `json:"id"`
		Choices []struct {
			FinishReason string `json:"finish_reason"`
			Message      struct {
				Content   string `json:"content"`
				ToolCalls []struct {
					ID       string `json:"id"`
					Function struct {
						Name      string `json:"name"`
						Arguments string `json:"arguments"`
					} `json:"function"`
				} `json:"tool_calls"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			Prompt     int `json:"prompt_tokens"`
			Completion int `json:"completion_tokens"`
			Total      int `json:"total_tokens"`
		} `json:"usage"`
	}
	if json.Unmarshal(body, &completion) != nil || len(completion.Choices) != 1 {
		return errors.New("invalid upstream Chat Completions response")
	}
	output := []map[string]any{}
	choice := completion.Choices[0]
	if choice.Message.Content != "" {
		output = append(output, map[string]any{"type": "message", "id": "msg_" + completion.ID, "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": choice.Message.Content, "annotations": []any{}}}})
	}
	for _, call := range choice.Message.ToolCalls {
		index := -1
		for i := range b.tools {
			if call.Function.Name == fmt.Sprintf("tool_%d", i) {
				index = i
				break
			}
		}
		if index < 0 {
			return errors.New("upstream returned an unknown tool")
		}
		tool := b.tools[index]
		item := map[string]any{"type": "function_call", "id": "fc_" + call.ID, "call_id": call.ID, "name": tool.Name, "arguments": call.Function.Arguments, "status": "completed"}
		if tool.Namespace != "" {
			item["namespace"] = tool.Namespace
		}
		if tool.Type == "custom" {
			var arguments struct {
				Input string `json:"input"`
			}
			if json.Unmarshal([]byte(call.Function.Arguments), &arguments) != nil {
				return errors.New("invalid custom tool arguments")
			}
			item["type"] = "custom_tool_call"
			item["input"] = arguments.Input
			delete(item, "arguments")
		}
		output = append(output, item)
	}
	result := map[string]any{"id": "resp_" + completion.ID, "object": "response", "created_at": time.Now().Unix(), "status": "completed", "model": b.model, "output": output, "usage": map[string]any{"input_tokens": completion.Usage.Prompt, "output_tokens": completion.Usage.Completion, "total_tokens": completion.Usage.Total, "input_tokens_details": map[string]int{"cached_tokens": 0}, "output_tokens_details": map[string]int{"reasoning_tokens": 0}}}
	eventType := "response.completed"
	if choice.FinishReason == "length" {
		result["status"] = "incomplete"
		result["incomplete_details"] = map[string]string{"reason": "max_output_tokens"}
		eventType = "response.incomplete"
	}
	var encoded []byte
	if b.stream {
		var events bytes.Buffer
		sequence := 0
		emit := func(kind string, fields map[string]any) error {
			fields["type"] = kind
			fields["sequence_number"] = sequence
			sequence++
			data, err := json.Marshal(fields)
			if err != nil {
				return err
			}
			fmt.Fprintf(&events, "event: %s\ndata: %s\n\n", kind, data)
			return nil
		}
		created := map[string]any{"id": result["id"], "object": "response", "status": "in_progress", "output": []any{}}
		if err := emit("response.created", map[string]any{"response": created}); err != nil {
			return err
		}
		for index, item := range output {
			if err := emit("response.output_item.added", map[string]any{"output_index": index, "item": item}); err != nil {
				return err
			}
			if item["type"] == "message" {
				if err := emit("response.output_text.delta", map[string]any{"output_index": index, "content_index": 0, "item_id": item["id"], "delta": choice.Message.Content}); err != nil {
					return err
				}
			}
			if err := emit("response.output_item.done", map[string]any{"output_index": index, "item": item}); err != nil {
				return err
			}
		}
		if err := emit(eventType, map[string]any{"response": result}); err != nil {
			return err
		}
		encoded = events.Bytes()
		response.Header.Set("Content-Type", "text/event-stream")
	} else {
		encoded, err = json.Marshal(result)
		if err != nil {
			return err
		}
		response.Header.Set("Content-Type", "application/json")
	}
	response.Header.Del("Content-Encoding")
	response.Header.Del("Content-Length")
	response.Body = io.NopCloser(bytes.NewReader(encoded))
	response.ContentLength = int64(len(encoded))
	return nil
}
