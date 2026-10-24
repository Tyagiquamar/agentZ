package extauth

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	corev3 "github.com/envoyproxy/go-control-plane/envoy/config/core/v3"
	authv3 "github.com/envoyproxy/go-control-plane/envoy/service/auth/v3"
	typev3 "github.com/envoyproxy/go-control-plane/envoy/type/v3"
	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"sigs.k8s.io/controller-runtime/pkg/client"

	"github.com/accuknox/agentz/internal/guardrails"
	api "github.com/accuknox/agentz/pkg/apis/agentz/v1alpha1"
)

func (s *Service) evaluateGuardrailRevision(ctx context.Context, attrs *authv3.AttributeContext, request requestAttrs) (checkDecision, requestAttrs) {
	extensions := attrs.GetContextExtensions()
	namespace := extensions["agentz.guardrail_namespace"]
	sandboxName := extensions["agentz.guardrail_sandbox"]
	request.sandboxNamespace = namespace
	request.sandbox = sandboxName
	sandbox := &api.Sandbox{}
	err := s.kube.Get(ctx, client.ObjectKey{Namespace: namespace, Name: sandboxName}, sandbox)
	if err == nil && !sandbox.DeletionTimestamp.IsZero() {
		err = errors.New("sandbox is terminating")
	}
	if err == nil {
		var bundle *guardrails.Bundle
		bundle, err = guardrails.Resolve(ctx, s.kube, namespace, "sandbox/"+sandboxName, sandbox.Spec.Guardrails)
		if err == nil {
			err = bundle.ConfigureManagedDelivery()
		}
		if err == nil && bundle.Revision == extensions["agentz.guardrail_revision"] {
			return allowDecision(injectedRequest{}), request
		}
	}
	outcome := api.GuardrailOutcome{
		Code:          "guardrail_unavailable",
		Phase:         "input",
		SafeLabel:     "Guardrail rollout",
		Explanation:   "Safeguards are being updated or are temporarily unavailable. Retry shortly.",
		ReferenceID:   uuid.NewString(),
		PartialOutput: false,
	}
	var envelope api.GuardrailErrorEnvelope
	envelope.Error.Guardrail = outcome
	envelope.Error.Type, envelope.Error.Code, envelope.Error.Message = outcome.Code, outcome.Code, outcome.Explanation
	body, marshalErr := json.Marshal(envelope)
	if marshalErr != nil {
		return denyDecision(
			codes.Unavailable, typev3.StatusCode_ServiceUnavailable,
			"Safeguards are temporarily unavailable.", "guardrail_rollout_pending", slog.LevelWarn,
		), request
	}
	decision := denyDecision(
		codes.Unavailable, typev3.StatusCode_ServiceUnavailable, string(body), "guardrail_rollout_pending", slog.LevelWarn,
	)
	denied := decision.response.GetDeniedResponse()
	denied.Headers = []*corev3.HeaderValueOption{
		{Header: &corev3.HeaderValue{Key: "content-type", Value: "application/json"}},
		{Header: &corev3.HeaderValue{Key: "x-agentz-guardrail-outcome", Value: "1"}},
	}
	return decision, request
}
