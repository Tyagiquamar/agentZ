package gateway

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestCodexBridgeNamespacedToolRoundTrip(t *testing.T) {
	body := []byte(`{"model":"claude-haiku-4-5-20251001","stream":true,"instructions":"Be concise","tools":[{"type":"namespace","name":"mcp__agentz","tools":[{"type":"function","name":"echo","parameters":{"type":"object","properties":{"text":{"type":"string"}}}}]}],"input":[{"role":"user","content":[{"type":"input_text","text":"echo hello"}]},{"type":"function_call","namespace":"mcp__agentz","name":"echo","arguments":"{\"text\":\"hello\"}","call_id":"call_1"},{"type":"function_call_output","call_id":"call_1","output":"hello"}]}`)
	bridge, request, err := newCodexResponsesBridge(body)
	if err != nil {
		t.Fatal(err)
	}
	var chat map[string]any
	if err := json.Unmarshal(request, &chat); err != nil {
		t.Fatal(err)
	}
	if chat["stream"] != false {
		t.Fatal("upstream must be buffered")
	}
	messages := chat["messages"].([]any)
	if len(messages) != 4 || messages[3].(map[string]any)["tool_call_id"] != "call_1" {
		t.Fatalf("tool history lost: %s", request)
	}
	response := &http.Response{Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"id":"chat_1","choices":[{"finish_reason":"tool_calls","message":{"content":"","tool_calls":[{"id":"call_2","function":{"name":"tool_0","arguments":"{\"text\":\"hi\"}"}}]}}],"usage":{"prompt_tokens":4,"completion_tokens":7,"total_tokens":11}}`))}
	if err := bridge.modifyResponse(response); err != nil {
		t.Fatal(err)
	}
	output, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{`"namespace":"mcp__agentz"`, `"name":"echo"`, `"call_id":"call_2"`, `response.completed`, `"input_tokens":4`} {
		if !strings.Contains(string(output), expected) {
			t.Fatalf("missing %s in %s", expected, output)
		}
	}
}

func TestCodexBridgeRejectsUnsupportedInput(t *testing.T) {
	cases := []string{
		`{"tools":[{"type":"web_search"}],"input":[]}`,
		`{"tools":[{"type":"namespace","name":"a","tools":[{"type":"namespace","name":"b","tools":[]}]}],"input":[]}`,
		`{"input":[{"role":"user","content":[{"type":"input_image","image_url":"https://example.com/image"}]}]}`,
		`{"input":[{"type":"reasoning","summary":[]}]}`,
		`{"input":[{"type":"function_call","name":"missing","call_id":"a"}]}`,
		`{"tools":[{"type":"function","name":"a","parameters":{}},{"type":"function","name":"a","parameters":{}}],"input":[]}`,
		`{"tool_choice":{"type":"function","name":"a"},"input":[]}`,
	}
	for _, body := range cases {
		t.Run(body, func(t *testing.T) {
			if _, _, err := newCodexResponsesBridge([]byte(body)); err == nil {
				t.Fatal("unsupported input accepted")
			}
		})
	}
}

func TestCodexBridgePlainTextAndIncomplete(t *testing.T) {
	for _, stream := range []bool{false, true} {
		body, _ := json.Marshal(map[string]any{"model": "claude", "input": "hi", "stream": stream})
		bridge, _, err := newCodexResponsesBridge(body)
		if err != nil {
			t.Fatal(err)
		}
		response := &http.Response{Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"id":"chat_2","choices":[{"finish_reason":"length","message":{"content":"hello"}}]}`))}
		if err := bridge.modifyResponse(response); err != nil {
			t.Fatal(err)
		}
		output, _ := io.ReadAll(response.Body)
		for _, expected := range []string{`"text":"hello"`, `"reason":"max_output_tokens"`, `"status":"incomplete"`} {
			if !strings.Contains(string(output), expected) {
				t.Fatalf("missing %s", expected)
			}
		}
		if stream && !strings.Contains(string(output), "event: response.incomplete") {
			t.Fatal("truncation must not look complete")
		}
	}
}

func TestCodexBridgeRejectsMalformedUpstream(t *testing.T) {
	bridge, _, err := newCodexResponsesBridge([]byte(`{"input":"hi"}`))
	if err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{`{}`, `{"choices":[]}`, `{"choices":[{"message":{"tool_calls":[{"id":"c","function":{"name":"unknown"}}]}}]}`} {
		response := &http.Response{Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}
		if err := bridge.modifyResponse(response); err == nil {
			t.Fatal("malformed response accepted")
		}
	}
}
