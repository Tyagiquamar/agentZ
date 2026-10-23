package gateway

import (
	"bytes"
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	agw "github.com/agentgateway/agentgateway/controller/api/v1alpha1/agentgateway"
	ciliumv2 "github.com/cilium/cilium/pkg/k8s/apis/cilium.io/v2"
	ciliumlabels "github.com/cilium/cilium/pkg/labels"
	ciliumapi "github.com/cilium/cilium/pkg/policy/api"
	"github.com/google/uuid"
	corev1 "k8s.io/api/core/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	ctrlclient "sigs.k8s.io/controller-runtime/pkg/client"
	gwv1 "sigs.k8s.io/gateway-api/apis/v1"

	"github.com/accuknox/agentz/internal/authorization"
	"github.com/accuknox/agentz/internal/gateway/apiutil"
	gatewayapi "github.com/accuknox/agentz/internal/gateway/openapi"
	"github.com/accuknox/agentz/internal/guardrails"
	"github.com/accuknox/agentz/internal/inference"
	"github.com/accuknox/agentz/internal/networkpolicy"
	"github.com/accuknox/agentz/internal/scope"
	api "github.com/accuknox/agentz/pkg/apis/agentz/v1alpha1"
)

//go:embed cel/guardrail_playground_response.cel
var playgroundResponseExpression string

const playgroundGateway = "guardrail-playground"
const playgroundExpiry = "agentz.accuknox.com/playground-expires"

// The callback token grants one deterministic model response, not inference access.
// Per-process state ensures another replica cannot replay a consumed callback.
var guardrailPlaygroundCallbacks = playgroundCallbacks{values: make(map[string]playgroundCallback)}

type playgroundCallbacks struct {
	sync.Mutex
	values map[string]playgroundCallback
}

type playgroundCallback struct {
	Content string
	Phase   string
	Expires time.Time
}
type playgroundRequest struct {
	Model    string              `json:"model"`
	Stream   bool                `json:"stream"`
	Messages []playgroundMessage `json:"messages"`
}
type playgroundCompletion struct {
	ID      string             `json:"id"`
	Object  string             `json:"object"`
	Created int64              `json:"created"`
	Model   string             `json:"model"`
	Choices []playgroundChoice `json:"choices"`
	Usage   playgroundUsage    `json:"usage"`
}
type playgroundUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}
type playgroundChoice struct {
	Index        int               `json:"index"`
	Message      playgroundMessage `json:"message"`
	FinishReason string            `json:"finish_reason"`
}
type playgroundMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// TestGuardrails evaluates saved, draft, or effective checks through AgentGateway.
func (s *Service) TestGuardrails(w http.ResponseWriter, r *http.Request, _ gatewayapi.TestGuardrailsParams) {
	access, apiErr := s.resolveResourceAccess(r.Context(), resourceAccessRequest{
		resource:    "Guardrail Policy",
		workspaceID: r.Header.Get("X-AgentZ-Workspace-ID"),
		operation:   authorization.OperationTestGuardrails,
	})
	if apiErr != nil {
		apiutil.WriteError(w, r, apiErr)
		return
	}
	var input gatewayapi.GuardrailTestInput
	if !decodeJSONBody(w, r, &input, false) {
		return
	}
	selectors := 0
	if input.Policy != nil {
		selectors++
	}
	if input.InlinePolicy != nil {
		selectors++
	}
	if input.Assignment != nil {
		selectors++
	}
	if input.Sandbox != nil {
		selectors++
	}
	if input.ClientId != nil {
		selectors++
	}
	if selectors > 1 {
		apiutil.WriteError(w, r, apiutil.NewError(http.StatusBadRequest, "invalid_request", "select one policy, draft policy, assignment, Sandbox, or client context", errBadRequest))
		return
	}
	var bundle *guardrails.Bundle
	var err error
	switch {
	case input.Policy != nil:
		ns, resolveErr := scope.SelectedNamespace(r.Context(), s.k8sClient, access.namespace, scope.Selection{
			Scope: api.ResourceScope(input.Policy.Scope),
			Kind:  api.OrganizationResourceKindGuardrailPolicy,
			Name:  input.Policy.Name,
		})
		if resolveErr != nil {
			err = resolveErr
			break
		}
		policy := &api.GuardrailPolicy{}
		err = s.k8sClient.Get(r.Context(), ctrlclient.ObjectKey{Namespace: ns, Name: input.Policy.Name}, policy)
		if err == nil {
			bundle, err = guardrails.CompilePolicy(r.Context(), s.k8sClient, ns, policy)
		}
	case input.InlinePolicy != nil:
		draft := input.InlinePolicy
		policy := &api.GuardrailPolicy{
			ObjectMeta: metav1.ObjectMeta{Name: draft.Name, Namespace: access.namespace},
			Spec:       api.GuardrailPolicySpec{DisplayName: draft.DisplayName, Checks: draft.Checks},
		}
		bundle, err = guardrails.CompilePolicy(r.Context(), s.k8sClient, access.namespace, policy)
	default:
		assignment := api.GuardrailAssignment{}
		if input.Assignment != nil {
			assignment = *input.Assignment
		}
		if input.Sandbox != nil {
			selectedScope := api.ResourceScope(resourceScope(access.workspaceID))
			if input.SandboxScope != nil {
				selectedScope = api.ResourceScope(*input.SandboxScope)
			}
			ns, resolveErr := scope.SelectedNamespace(r.Context(), s.k8sClient, access.namespace, scope.Selection{
				Scope: selectedScope,
				Kind:  api.OrganizationResourceKindSandbox,
				Name:  *input.Sandbox,
			})
			if resolveErr != nil {
				err = resolveErr
				break
			}
			sandbox := &api.Sandbox{}
			err = s.k8sClient.Get(r.Context(), ctrlclient.ObjectKey{Namespace: ns, Name: *input.Sandbox}, sandbox)
			if err != nil {
				break
			}
			assignment = sandbox.Spec.Guardrails
			bundle, err = guardrails.Resolve(r.Context(), s.k8sClient, ns, "sandbox/"+sandbox.Name, assignment)
			break
		}
		if input.ClientId != nil {
			assignment, err = s.resolveGuardrailAssignment(r.Context(), access.claims.OrganizationID, access.workspaceID, *input.ClientId)
			if err != nil {
				break
			}
		}
		bundle, err = guardrails.Resolve(r.Context(), s.k8sClient, access.namespace, "playground", assignment)
	}
	if err != nil {
		apiutil.WriteError(w, r, apiutil.NewError(http.StatusBadRequest, "invalid_request", err.Error(), err))
		return
	}
	if bundle.Guard == nil {
		apiutil.WriteError(w, r, apiutil.NewError(http.StatusBadRequest, "invalid_request", "the selected context has no guardrail checks", errBadRequest))
		return
	}
	if input.Phase == "input" {
		bundle.Guard.Response = nil
		bundle.Context.Response = []guardrails.CheckContext{}
	} else {
		bundle.Guard.Request = nil
		bundle.Context.Request = []guardrails.CheckContext{}
	}
	if len(bundle.Guard.Request)+len(bundle.Guard.Response) == 0 {
		apiutil.WriteError(w, r, apiutil.NewError(http.StatusBadRequest, "invalid_request", "the selected context has no checks in this phase", errBadRequest))
		return
	}
	bundle.Context.Capture = "off"
	bundle.Rebind(access.namespace)
	result, err := s.evaluateGuardrailPlayground(r.Context(), access, bundle, string(input.Phase), input.Content)
	if err != nil {
		outcome := api.GuardrailOutcome{
			Code:        "guardrail_unavailable",
			Phase:       string(input.Phase),
			SafeLabel:   "Guardrail test",
			Explanation: "The guardrail test could not complete. Check detector and gateway readiness, then retry.",
			ReferenceID: uuid.NewString(),
		}
		var envelope gatewayapi.GuardrailErrorEnvelope
		envelope.Error.Guardrail = outcome
		envelope.Error.Type, envelope.Error.Code, envelope.Error.Message = outcome.Code, outcome.Code, outcome.Explanation
		apiutil.WriteJSON(w, http.StatusServiceUnavailable, envelope)
		return
	}
	apiutil.WriteJSON(w, http.StatusOK, result)
}

func (s *Service) evaluateGuardrailPlayground(ctx context.Context, access resourceAccess, bundle *guardrails.Bundle, phase, content string) (gatewayapi.GuardrailTestResult, error) {
	result := gatewayapi.GuardrailTestResult{
		Action:  "allow",
		Content: content,
		Checks:  []gatewayapi.GuardrailTestCheckResult{},
	}
	callbackURL, err := url.Parse(s.cfg.GuardrailCallbackURL)
	if err != nil || callbackURL.Hostname() == "" {
		return result, errors.New("the internal playground callback URL is not configured")
	}
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		return result, err
	}
	token := hex.EncodeToString(random)
	name := "test-" + token[:20]
	callbackContent := content
	if phase == "input" {
		callbackContent = "Request accepted."
	}
	guardrailPlaygroundCallbacks.Lock()
	guardrailPlaygroundCallbacks.values[token] = playgroundCallback{
		Content: callbackContent,
		Phase:   phase,
		Expires: time.Now().Add(3 * time.Minute),
	}
	guardrailPlaygroundCallbacks.Unlock()
	defer func() {
		guardrailPlaygroundCallbacks.Lock()
		delete(guardrailPlaygroundCallbacks.values, token)
		guardrailPlaygroundCallbacks.Unlock()
	}()
	expiry := time.Now().Add(3 * time.Minute).UTC().Format(time.RFC3339)
	labels := map[string]string{"agentz.accuknox.com/playground": "true"}
	annotations := map[string]string{playgroundExpiry: expiry}
	params := &agw.AgentgatewayParameters{
		TypeMeta: metav1.TypeMeta{
			APIVersion: agw.GroupVersion.String(),
			Kind:       "AgentgatewayParameters",
		},
		ObjectMeta: metav1.ObjectMeta{Name: playgroundGateway, Namespace: access.namespace},
		Spec: agw.AgentgatewayParametersSpec{
			AgentgatewayParametersOverlays: agw.AgentgatewayParametersOverlays{
				Service: &agw.KubernetesResourceOverlay{
					Spec: &apiextensionsv1.JSON{Raw: []byte(`{"type":"ClusterIP"}`)},
				},
			},
		},
	}
	gateway := inference.Gateway(access.namespace)
	gateway.Name = playgroundGateway
	gateway.Spec.Infrastructure.ParametersRef.Name = playgroundGateway
	gateway.TypeMeta = metav1.TypeMeta{APIVersion: gwv1.GroupVersion.String(), Kind: "Gateway"}
	gateway.Labels = labels
	gateway.Annotations = annotations
	gateway.OwnerReferences = []metav1.OwnerReference{access.owner}
	params.Labels = labels
	params.Annotations = annotations
	params.OwnerReferences = []metav1.OwnerReference{access.owner}
	port := int32(80)
	if callbackURL.Scheme == "https" {
		port = 443
	}
	if callbackURL.Port() != "" {
		value, err := strconv.ParseInt(callbackURL.Port(), 10, 32)
		if err != nil {
			return result, err
		}
		port = int32(value)
	}
	backend := &agw.AgentgatewayBackend{
		TypeMeta: metav1.TypeMeta{
			APIVersion: agw.GroupVersion.String(),
			Kind:       "AgentgatewayBackend",
		},
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: access.namespace},
		Spec: agw.AgentgatewayBackendSpec{
			AI: &agw.AIBackend{
				LLM: &agw.LLMProvider{
					OpenAI: &agw.OpenAIConfig{},
					Host:   callbackURL.Hostname(),
					Port:   port,
					Path:   "/internal/guardrails/model",
				},
			},
			Policies: &agw.BackendFull{
				BackendSimple: agw.BackendSimple{
					Auth: &agw.BackendAuth{
						SecretRef: &agw.LocalSecretKeyRef{Name: gwv1.ObjectName(name), Key: new("token")},
					},
				},
			},
		},
	}
	if callbackURL.Scheme == "https" {
		backend.Spec.Policies.TLS = &agw.BackendTLS{}
	}
	secret := &corev1.Secret{
		TypeMeta:   metav1.TypeMeta{APIVersion: "v1", Kind: "Secret"},
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: access.namespace},
		StringData: map[string]string{"token": token},
	}
	runtime := inference.RenderSandboxTarget(access.namespace, name, inference.SandboxTarget{
		Name:    "playground",
		Backend: name,
		Path:    "/tests/" + token,
		Models:  []string{"guardrail-test"},
	})
	target := "http://" + playgroundGateway + "." + access.namespace + ".svc.cluster.local"
	if s.cfg.GuardrailGatewayURL != "" {
		target = strings.TrimRight(s.cfg.GuardrailGatewayURL, "/")
	}
	targetURL, err := url.Parse(target)
	if err != nil || targetURL.Hostname() == "" || (targetURL.Scheme != "http" && targetURL.Scheme != "https") {
		return result, errors.New("the isolated AgentGateway test URL is invalid")
	}
	readyPath := "/tests/" + token + "/ready"
	proofPath := readyPath + "/" + bundle.Revision
	runtime.Route.Spec.Rules = append(runtime.Route.Spec.Rules, gwv1.HTTPRouteRule{
		Matches: []gwv1.HTTPRouteMatch{{
			Method: new(gwv1.HTTPMethodGet),
			Path:   &gwv1.HTTPPathMatch{Type: new(gwv1.PathMatchExact), Value: &readyPath},
		}},
		Filters: []gwv1.HTTPRouteFilter{{
			Type: gwv1.HTTPRouteFilterRequestRedirect,
			RequestRedirect: &gwv1.HTTPRequestRedirectFilter{
				Scheme:     &targetURL.Scheme,
				StatusCode: new(302),
				Path: &gwv1.HTTPPathModifier{
					Type:            gwv1.FullPathHTTPPathModifier,
					ReplaceFullPath: &proofPath,
				},
			},
		}},
	})
	runtime.Route.Spec.ParentRefs[0].Name = playgroundGateway
	runtime.Route.TypeMeta = metav1.TypeMeta{APIVersion: gwv1.GroupVersion.String(), Kind: "HTTPRoute"}
	runtime.Policy.TypeMeta = metav1.TypeMeta{
		APIVersion: agw.GroupVersion.String(),
		Kind:       "AgentgatewayPolicy",
	}
	runtime.Policy.Spec.Traffic.Authorization = &agw.Authorization{
		Action: agw.AuthorizationPolicyActionRequire,
		Policy: agw.AuthorizationPolicy{
			MatchExpressions: []agw.CELExpression{
				agw.CELExpression(fmt.Sprintf("request.headers[\"x-agentz-playground-token\"] == %q", token)),
			},
		},
	}
	if err := bundle.Apply(runtime.Policy); err != nil {
		return result, err
	}
	runtime.Policy.Spec.Traffic.Transformation.Response = &agw.Transform{
		Set: []agw.HeaderTransformation{
			{Name: "x-agentz-guardrail-test", Value: agw.CELExpression(playgroundResponseExpression)},
		},
	}
	detectorTargets, err := bundle.ProjectConnections(ctx, s.k8sClient, access.namespace, "agentz-inference")
	if err != nil {
		return result, err
	}
	targets := append(detectorTargets, networkpolicy.Target{Host: callbackURL.Hostname(), Port: port})
	policy := &ciliumv2.CiliumNetworkPolicy{
		TypeMeta:   metav1.TypeMeta{APIVersion: "cilium.io/v2", Kind: "CiliumNetworkPolicy"},
		ObjectMeta: metav1.ObjectMeta{Name: playgroundGateway, Namespace: access.namespace},
		Spec: &ciliumapi.Rule{
			EndpointSelector: ciliumapi.NewESFromLabels(ciliumlabels.NewLabel("gateway.networking.k8s.io/gateway-name", playgroundGateway, ciliumlabels.LabelSourceK8s)),
			Ingress: []ciliumapi.IngressRule{
				{
					IngressCommonRule: ciliumapi.IngressCommonRule{
						FromEndpoints: []ciliumapi.EndpointSelector{
							ciliumapi.NewESFromLabels(ciliumlabels.NewLabel("io.kubernetes.pod.namespace", s.cfg.GatewayServiceAccountNamespace, ciliumlabels.LabelSourceK8s)),
						},
					},
				},
			},
			Egress: networkpolicy.ExternalEgress(targets),
		},
	}
	policy.Spec.Egress = append(policy.Spec.Egress, networkpolicy.ServiceEgress("agentgateway-system", "agentgateway", 9978)...)
	common := []ctrlclient.Object{params, gateway, policy}
	ephemeral := []ctrlclient.Object{secret, backend, runtime.Route, runtime.Policy}
	defer func() {
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
		defer cancel()
		for _, object := range ephemeral {
			_ = s.k8sClient.Delete(cleanupCtx, object)
		}
	}()
	for _, object := range append(common, ephemeral...) {
		object.SetLabels(labels)
		object.SetAnnotations(annotations)
		if object != gateway && object != params && object != policy {
			object.SetOwnerReferences([]metav1.OwnerReference{access.owner})
		}
		data, err := json.Marshal(object)
		if err != nil {
			return result, err
		}
		err = s.k8sClient.Patch(ctx, object, ctrlclient.RawPatch(types.ApplyPatchType, data), ctrlclient.FieldOwner("agentz-guardrail-playground"))
		if err != nil {
			return result, err
		}
	}
	payload := playgroundRequest{
		Model:    "guardrail-test",
		Messages: []playgroundMessage{{Role: "user", Content: content}},
	}
	if phase == "output" {
		payload.Messages[0].Content = "Evaluate the supplied test response."
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return result, err
	}
	deadline := time.Now().Add(90 * time.Second)
	for {
		ready, err := s.guardrailPlaygroundReady(ctx, access.namespace, name)
		if err != nil {
			return result, err
		}
		if ready {
			break
		}
		if time.Now().After(deadline) {
			return result, errors.New("the isolated AgentGateway test policy did not become ready")
		}
		select {
		case <-ctx.Done():
			return result, ctx.Err()
		case <-time.After(time.Second):
		}
	}
	requestCtx, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()
	httpClient := *s.outboundHTTP
	// The shared ten-second timeout races the checker's own deadline.
	// The evaluation context bounds readiness, every check, and response reads.
	httpClient.Timeout = 0
	httpClient.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}
	// Observe this exact route revision in the data plane without a backend or
	// any submitted content. Redirects terminate before native guard execution.
	for {
		probe, err := http.NewRequestWithContext(requestCtx, http.MethodGet, target+readyPath, nil)
		if err != nil {
			return result, err
		}
		probe.Header.Set("x-agentz-playground-token", token)
		response, err := httpClient.Do(probe)
		if err == nil {
			_ = response.Body.Close()
			if response.StatusCode == http.StatusFound && response.Header.Get("Location") == target+proofPath {
				break
			}
		}
		select {
		case <-requestCtx.Done():
			return result, errors.New("the isolated AgentGateway test route did not become ready")
		case <-time.After(time.Second):
		}
	}
	request, err := http.NewRequestWithContext(requestCtx, http.MethodPost, target+"/tests/"+token+"/v1/chat/completions", bytes.NewReader(data))
	if err != nil {
		return result, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("x-agentz-playground-token", token)
	// An error response may follow a completed check. Never replay evaluation.
	response, err := httpClient.Do(request)
	if err != nil {
		return result, err
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return result, err
	}
	checkerErrors := false
	details := response.Header.Get("x-agentz-guardrail-test")
	if details == "" && response.StatusCode < http.StatusBadRequest {
		return result, errors.New("gateway test returned no proof that its configured checks ran")
	}
	if details != "" {
		var evaluations []gatewayapi.GuardrailRuntimeEvaluation
		if err := json.Unmarshal([]byte(details), &evaluations); err != nil {
			return result, errors.New("gateway test returned invalid evaluation details")
		}
		for _, evaluation := range evaluations {
			if evaluation.Agentz == nil {
				return result, errors.New("gateway test returned an evaluation without guardrail provenance")
			}
			if result.ReferenceId == "" {
				result.ReferenceId = evaluation.Agentz.ReferenceId
			}
			explanation := evaluation.Agentz.Explanation
			if evaluation.Action == "allow" {
				explanation = "The check allowed this fixture."
			}
			if evaluation.Agentz.ErrorCode != nil {
				checkerErrors = true
				explanation = "The checker could not complete. Traffic continued under the configured audit or failure handling."
				if evaluation.Action == "reject" {
					explanation = "The checker could not complete. Traffic stopped under the configured failure handling."
				}
			}
			if evaluation.Agentz.ValidationPass != nil {
				explanation = "The mandatory check was repeated after masking. " + explanation
			}
			result.Checks = append(result.Checks, gatewayapi.GuardrailTestCheckResult{
				CheckId:     evaluation.Agentz.CheckId,
				Action:      string(evaluation.Action),
				Explanation: explanation,
			})
		}
		if response.StatusCode < http.StatusBadRequest {
			expected := bundle.Context.Request
			if phase == "output" {
				expected = bundle.Context.Response
			}
			if len(evaluations) < len(expected) {
				return result, errors.New("gateway test did not evaluate every configured check")
			}
			for i, check := range expected {
				observed := evaluations[i].Agentz
				if observed.ValidationPass != nil || observed.PolicyId != check.PolicyID || observed.CheckId != check.CheckID || observed.Revision != check.Revision {
					return result, errors.New("gateway test evaluated a different guardrail configuration")
				}
			}
			mandatoryIndex := 0
			for _, evaluation := range evaluations[len(expected):] {
				for mandatoryIndex < len(expected) && !expected[mandatoryIndex].Mandatory {
					mandatoryIndex++
				}
				if mandatoryIndex == len(expected) {
					return result, errors.New("gateway test returned an unexpected repeated evaluation")
				}
				check := expected[mandatoryIndex]
				observed := evaluation.Agentz
				final := observed.ValidationPass != nil && *observed.ValidationPass == gatewayapi.MandatoryFinal
				matching := observed.PolicyId == check.PolicyID && observed.CheckId == check.CheckID && observed.Revision == check.Revision
				if !final || !observed.Mandatory || !matching {
					return result, errors.New("gateway test returned an unverified mandatory recheck")
				}
				mandatoryIndex++
			}
			if len(evaluations) > len(expected) {
				for _, check := range expected[mandatoryIndex:] {
					if check.Mandatory {
						return result, errors.New("gateway test did not complete every mandatory recheck")
					}
				}
			}
		}
	}
	if response.StatusCode >= 400 {
		var envelope gatewayapi.GuardrailErrorEnvelope
		if err := json.Unmarshal(responseBody, &envelope); err != nil {
			return result, fmt.Errorf("gateway test returned HTTP %d", response.StatusCode)
		}
		outcome := envelope.Error.Guardrail
		validCode := outcome.Code == "guardrail_denied" || outcome.Code == "guardrail_unavailable"
		if response.Header.Get("x-agentz-guardrail-outcome") != "1" || !validCode || outcome.Phase != phase || outcome.ReferenceID == "" {
			return result, errors.New("gateway test returned an unverified failure response")
		}
		result.Outcome = &outcome
		result.ReferenceId = outcome.ReferenceID
		result.Explanation = outcome.Explanation
		result.Action = "deny"
		if outcome.Code == "guardrail_unavailable" {
			result.Action = "error"
		}
		return result, nil
	}
	var completion playgroundCompletion
	if err := json.Unmarshal(responseBody, &completion); err != nil {
		return result, errors.New("gateway test returned an invalid model response")
	}
	if len(completion.Choices) == 0 {
		return result, errors.New("gateway test returned no response content")
	}
	result.Content = completion.Choices[0].Message.Content
	if result.Content != content {
		result.Action = "mask"
	}
	result.Explanation = "The configured checks completed through AgentGateway."
	if checkerErrors {
		result.Explanation = "Checker errors were recorded; the configured handling allowed this fixture."
	}
	return result, nil
}

// guardrailPlaygroundReady checks the route, backend, and its policy together.
// Route acceptance alone does not establish that the guardrail policy is attached.
func (s *Service) guardrailPlaygroundReady(ctx context.Context, namespace, name string) (bool, error) {
	key := ctrlclient.ObjectKey{
		Namespace: namespace,
		Name:      inference.SandboxProviderRuntimeName(name, "playground"),
	}
	route := &gwv1.HTTPRoute{}
	if err := s.k8sClient.Get(ctx, key, route); err != nil {
		return false, ctrlclient.IgnoreNotFound(err)
	}
	routeReady := false
	for _, parent := range route.Status.Parents {
		if parent.ParentRef.Name != playgroundGateway || parent.ControllerName != "agentgateway.dev/agentgateway" {
			continue
		}
		accepted := meta.FindStatusCondition(parent.Conditions, string(gwv1.RouteConditionAccepted))
		resolved := meta.FindStatusCondition(parent.Conditions, string(gwv1.RouteConditionResolvedRefs))
		routeReady = accepted != nil && accepted.Status == metav1.ConditionTrue && accepted.ObservedGeneration == route.Generation &&
			resolved != nil && resolved.Status == metav1.ConditionTrue && resolved.ObservedGeneration == route.Generation
		if routeReady {
			break
		}
	}
	if !routeReady {
		return false, nil
	}
	backend := &agw.AgentgatewayBackend{}
	err := s.k8sClient.Get(ctx, ctrlclient.ObjectKey{Namespace: namespace, Name: name}, backend)
	if err != nil {
		return false, ctrlclient.IgnoreNotFound(err)
	}
	accepted := meta.FindStatusCondition(backend.Status.Conditions, "Accepted")
	backendReady := accepted != nil && accepted.Status == metav1.ConditionTrue && accepted.ObservedGeneration == backend.Generation
	if !backendReady {
		return false, nil
	}
	policy := &agw.AgentgatewayPolicy{}
	if err := s.k8sClient.Get(ctx, key, policy); err != nil {
		return false, ctrlclient.IgnoreNotFound(err)
	}
	for _, ancestor := range policy.Status.Ancestors {
		if ancestor.AncestorRef.Name != playgroundGateway || ancestor.ControllerName != "agentgateway.dev/agentgateway" {
			continue
		}
		accepted := meta.FindStatusCondition(ancestor.Conditions, "Accepted")
		attached := meta.FindStatusCondition(ancestor.Conditions, "Attached")
		ready := accepted != nil && accepted.Status == metav1.ConditionTrue && accepted.ObservedGeneration == policy.Generation &&
			attached != nil && attached.Status == metav1.ConditionTrue && attached.ObservedGeneration == policy.Generation
		if ready {
			return true, nil
		}
	}
	return false, nil
}

func (s *Service) handleGuardrailPlaygroundModel(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	guardrailPlaygroundCallbacks.Lock()
	callback, ok := guardrailPlaygroundCallbacks.values[token]
	delete(guardrailPlaygroundCallbacks.values, token)
	guardrailPlaygroundCallbacks.Unlock()
	if !ok {
		http.Error(w, "test callback unavailable", http.StatusForbidden)
		return
	}
	if time.Now().After(callback.Expires) {
		http.Error(w, "test callback expired", http.StatusForbidden)
		return
	}
	if callback.Phase == "input" {
		var input playgroundRequest
		if err := json.NewDecoder(io.LimitReader(r.Body, 128<<10)).Decode(&input); err != nil {
			http.Error(w, "invalid test model request", http.StatusBadRequest)
			return
		}
		for _, message := range input.Messages {
			if message.Role == "user" {
				callback.Content = message.Content
			}
		}
	}
	apiutil.WriteJSON(w, http.StatusOK, playgroundCompletion{
		ID: "guardrail-test", Object: "chat.completion", Created: time.Now().Unix(), Model: "guardrail-test",
		Choices: []playgroundChoice{
			{
				Message:      playgroundMessage{Role: "assistant", Content: callback.Content},
				FinishReason: "stop",
			},
		},
	})
}

func (s *Service) runGuardrailPlaygroundCleanup(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			lists := []ctrlclient.ObjectList{
				&agw.AgentgatewayBackendList{},
				&agw.AgentgatewayPolicyList{},
				&agw.AgentgatewayParametersList{},
				&gwv1.HTTPRouteList{},
				&gwv1.GatewayList{},
				&corev1.SecretList{},
				&ciliumv2.CiliumNetworkPolicyList{},
			}
			for _, list := range lists {
				err := s.k8sClient.List(ctx, list, ctrlclient.MatchingLabels{"agentz.accuknox.com/playground": "true"})
				if err != nil {
					continue
				}
				objects, err := meta.ExtractList(list)
				if err != nil {
					continue
				}
				for _, item := range objects {
					object, ok := item.(ctrlclient.Object)
					if !ok {
						continue
					}
					expiry, err := time.Parse(time.RFC3339, object.GetAnnotations()[playgroundExpiry])
					if err == nil && time.Now().After(expiry) {
						_ = s.k8sClient.Delete(ctx, object)
					}
				}
			}
			guardrailPlaygroundCallbacks.Lock()
			for key, value := range guardrailPlaygroundCallbacks.values {
				if time.Now().After(value.Expires) {
					delete(guardrailPlaygroundCallbacks.values, key)
				}
			}
			guardrailPlaygroundCallbacks.Unlock()
		}
	}
}
