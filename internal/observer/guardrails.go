package observer

import (
	"cmp"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	gatewayapi "github.com/accuknox/agentz/internal/gateway/openapi"
	observerdb "github.com/accuknox/agentz/internal/observer/db"
	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
)

const attrGuardrailEvaluations = "agentz.guardrails"

type guardrailEvent struct {
	row       observerdb.InsertGuardrailEventParams
	namespace string
}

// guardrailEventsFromSpan accepts only the typed, versioned runtime contract.
// Its caller restricts these evaluations to the gateway-only OTLP listener.
func guardrailEventsFromSpan(sp *tracepb.Span, resourceAttrs map[string]*commonpb.AnyValue) ([]guardrailEvent, error) {
	if sp.GetKind() != tracepb.Span_SPAN_KIND_SERVER {
		return nil, nil
	}
	attrs := attrsMap(sp.GetAttributes())
	raw := attrs[attrGuardrailEvaluations].GetStringValue()
	if raw == "" {
		return nil, nil
	}
	if len(sp.GetTraceId()) != 16 {
		return nil, errors.New("guardrail evaluation has an invalid trace ID")
	}
	var evaluations []gatewayapi.GuardrailRuntimeEvaluation
	if err := json.Unmarshal([]byte(raw), &evaluations); err != nil {
		return nil, fmt.Errorf("decode guardrail evaluations: %w", err)
	}
	namespace := cmp.Or(attrs[attrAgentZTenantNamespace].GetStringValue(), resourceAttrs[attrServiceNamespace].GetStringValue())
	events := make([]guardrailEvent, 0, len(evaluations))
	for _, evaluation := range evaluations {
		detail := evaluation.Agentz
		if detail == nil {
			continue
		}
		validIdentity := detail.Version == 1 && detail.EventId != "" && detail.ReferenceId != "" && detail.PolicyId != "" && detail.CheckId != ""
		validRetention := detail.RetentionDays >= 1 && detail.RetentionDays <= 3650
		if !validIdentity || !validRetention || detail.StartedAt <= 0 {
			return nil, errors.New("guardrail evaluation has incomplete provenance or retention")
		}
		// Provider-authored reason strings are not a safe metadata contract.
		// The configured explanation is retained separately; inspected content is opt-in.
		evaluation.ActionReason = nil
		encoded, err := json.Marshal(evaluation)
		if err != nil {
			return nil, fmt.Errorf("encode guardrail evaluation: %w", err)
		}
		occurredAt := time.UnixMilli(detail.StartedAt)
		row := observerdb.InsertGuardrailEventParams{
			ID:             detail.EventId,
			OrganizationID: attrs["agentz.organization_id"].GetStringValue(),
			WorkspaceID:    attrs["agentz.workspace_id"].GetStringValue(),
			OccurredAt:     occurredAt,
			ExpiresAt:      occurredAt.AddDate(0, 0, detail.RetentionDays),
			SandboxName:    attrs["agentz.sandbox_name"].GetStringValue(),
			AgentName:      attrs[attrAgentZAgentName].GetStringValue(),
			ClientID:       attrs["agentz.client_id"].GetStringValue(),
			SessionID:      attrs[attrSessionID].GetStringValue(),
			Model:          cmp.Or(attrs[attrGenAIResponseModel].GetStringValue(), attrs[attrGenAIRequestModel].GetStringValue()),
			TraceID:        slices.Clone(sp.GetTraceId()),
			Phase:          string(evaluation.Phase),
			Action:         string(evaluation.Action),
			PolicyID:       detail.PolicyId,
			ReferenceID:    detail.ReferenceId,
			Evaluation:     encoded,
		}
		if row.OrganizationID == "" && namespace == "" {
			return nil, errors.New("guardrail evaluation has no authenticated scope")
		}
		events = append(events, guardrailEvent{row: row, namespace: namespace})
	}
	return events, nil
}
