package workflowrun

import (
	"encoding/json"
	"net/http"
	"testing"

	gatewayapi "github.com/accuknox/agentz/internal/gateway/openapi"
)

type assistantFailureCase struct {
	name      string
	code      string
	status    int
	header    string
	reference string
	malformed bool
	guardrail bool
}

func TestAssistantFailureRequiresAuthenticatedGuardrailEnvelope(t *testing.T) {
	cases := []assistantFailureCase{
		{name: "denial", code: "guardrail_denied", status: 422, header: "1", reference: "ref", guardrail: true},
		{name: "outage", code: "guardrail_unavailable", status: 503, header: "1", reference: "ref", guardrail: true},
		{name: "missing marker", code: "guardrail_denied", status: 422, reference: "ref"},
		{name: "wrong status", code: "guardrail_denied", status: 503, header: "1", reference: "ref"},
		{name: "unknown code", code: "provider_error", status: 422, header: "1", reference: "ref"},
		{name: "missing reference", code: "guardrail_denied", status: 422, header: "1"},
		{name: "malformed body", code: "guardrail_denied", status: 422, header: "1", reference: "ref", malformed: true},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			var envelope gatewayapi.GuardrailErrorEnvelope
			envelope.Error.Guardrail.Code = test.code
			envelope.Error.Guardrail.ReferenceID = test.reference
			envelope.Error.Guardrail.Explanation = "Remove personal information and try again."
			data, err := json.Marshal(envelope)
			if err != nil {
				t.Fatal(err)
			}
			body := string(data)
			if test.malformed {
				body = "invalid JSON"
			}
			var failure gatewayapi.OpencodeAPIError
			failure.Data.Message = "upstream failed"
			failure.Data.StatusCode = &test.status
			failure.Data.ResponseBody = &body
			failure.Data.ResponseHeaders = &map[string]string{
				http.CanonicalHeaderKey("x-agentz-guardrail-outcome"): test.header,
			}
			assistant := gatewayapi.OpencodeAssistantMessage{Error: &gatewayapi.OpencodeAssistantMessage_Error{}}
			if err := assistant.Error.FromOpencodeAPIError(failure); err != nil {
				t.Fatal(err)
			}
			message, outcome := assistantFailure(assistant)
			if (outcome != nil) != test.guardrail {
				t.Fatalf("guardrail outcome = %+v, expected classified = %v", outcome, test.guardrail)
			}
			if test.guardrail && message != envelope.Error.Guardrail.Explanation {
				t.Fatalf("safe explanation lost: %q", message)
			}
			if !test.guardrail && message == envelope.Error.Guardrail.Explanation {
				t.Fatal("unverified provider response became a guardrail explanation")
			}
		})
	}
}
