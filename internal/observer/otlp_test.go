package observer

import (
	"bytes"
	"strings"
	"testing"
	"time"

	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
)

func appSpanFixture(payloadSize int) *tracepb.Span {
	attributes := map[string]string{
		"agentz.organization_id": "telemetry-test-org", "agentz.workspace_id": "telemetry-test-workspace",
		"agentz.client_id": "telemetry-test-client", "agentz.app_name": "Telemetry test",
		"agentz.grant_id": "telemetry-test-grant", "agentz.user_id": "telemetry-test-user",
		"agentz.resource_kind": "inference", "agentz.resource_namespace": "telemetry-test-namespace",
		"agentz.resource_name": "provider", "agentz.resource_uid": "provider-uid", "agentz.target_id": "model",
		attrGenAIResponseModel: "fixture-model", "agw.ai.usage.cost.total": "0.00125",
		attrLLMInputMessages:  `{"messages":[{"role":"user","content":"` + strings.Repeat("x", payloadSize) + `"}]}`,
		attrLLMOutputMessages: `{"completion":["answer"],"tool_calls":[{"id":"call-1","name":"lookup","arguments":"{\"n\":9007199254740993}"}]}`,
	}
	span := &tracepb.Span{
		TraceId: bytes.Repeat([]byte{1}, 16), SpanId: bytes.Repeat([]byte{2}, 8),
		Name: "inference", Kind: tracepb.Span_SPAN_KIND_SERVER,
		StartTimeUnixNano: uint64(time.Second),
	}
	span.EndTimeUnixNano = span.StartTimeUnixNano + uint64(time.Millisecond)
	for name, value := range attributes {
		span.Attributes = append(span.Attributes, &commonpb.KeyValue{
			Key: name, Value: &commonpb.AnyValue{Value: &commonpb.AnyValue_StringValue{StringValue: value}},
		})
	}
	span.Attributes = append(span.Attributes, &commonpb.KeyValue{
		Key: attrGenAIInputTokens, Value: &commonpb.AnyValue{Value: &commonpb.AnyValue_IntValue{IntValue: 0}},
	})
	return span
}

func TestAppOperationContentAndUsage(t *testing.T) {
	span := appSpanFixture(1 << 20)
	op, err := appOperationFromOTLPSpan(span, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !op.InputTokens.Valid || op.InputTokens.Int64 != 0 || op.OutputTokens.Valid {
		t.Fatalf("known zero and unknown usage lost: input=%+v output=%+v", op.InputTokens, op.OutputTokens)
	}
	if !op.CostUsd.Valid || op.CostUsd.Float64 != 0.00125 || op.DurationNs != int64(time.Millisecond) {
		t.Fatalf("cost or duration lost: %+v", op)
	}
	if len(op.InputMessages) < 1<<20 || !bytes.Contains(op.OutputMessages, []byte("9007199254740993")) {
		t.Fatal("full input or tool call output lost")
	}
	if bytes.Contains(op.SpanAttributes, []byte(attrLLMInputMessages)) || bytes.Contains(op.SpanAttributes, []byte(attrLLMOutputMessages)) {
		t.Fatal("payload duplicated in metadata")
	}
	span.Kind = tracepb.Span_SPAN_KIND_CLIENT
	if _, err := appOperationFromOTLPSpan(span, nil); err == nil {
		t.Fatal("child span accepted as a second app operation")
	}
}

func TestAppMCPFailureAndAttribution(t *testing.T) {
	span := appSpanFixture(0)
	for _, attr := range span.Attributes {
		if attr.Key == "agentz.resource_kind" {
			attr.Value = &commonpb.AnyValue{Value: &commonpb.AnyValue_StringValue{StringValue: "mcp"}}
		}
	}
	for name, value := range map[string]string{
		attrMCPMethodName: "tools/call", attrGenAIToolName: "lookup",
		attrToolParameters: `{"n":9007199254740993}`, attrOutputValue: `{"isError":true,"structuredContent":{"reason":"denied"}}`,
		attrToolError: `{"code":-32001,"message":"denied","data":{"n":9007199254740993}}`,
	} {
		span.Attributes = append(span.Attributes, &commonpb.KeyValue{
			Key: name, Value: &commonpb.AnyValue{Value: &commonpb.AnyValue_StringValue{StringValue: value}},
		})
	}
	op, err := appOperationFromOTLPSpan(span, nil)
	if err != nil {
		t.Fatal(err)
	}
	if op.StatusCode != statusError || !bytes.Contains(op.ToolError, []byte("9007199254740993")) {
		t.Fatal("MCP failure or error data lost")
	}
	span.Attributes = append(span.Attributes, &commonpb.KeyValue{
		Key: "agentz.workspace_id", Value: &commonpb.AnyValue{Value: &commonpb.AnyValue_StringValue{}},
	})
	if _, err := appOperationFromOTLPSpan(span, nil); err == nil {
		t.Fatal("unattributed app operation accepted")
	}
}

func BenchmarkAppOperationCapture(b *testing.B) {
	for name, size := range map[string]int{"small": 1024, "large": 1 << 20} {
		b.Run(name, func(b *testing.B) {
			span := appSpanFixture(size)
			b.ReportAllocs()
			b.SetBytes(int64(size))
			for b.Loop() {
				if _, err := appOperationFromOTLPSpan(span, nil); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
