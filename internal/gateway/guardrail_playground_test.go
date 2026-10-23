package gateway

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	agw "github.com/agentgateway/agentgateway/controller/api/v1alpha1/agentgateway"
	ciliumv2 "github.com/cilium/cilium/pkg/k8s/apis/cilium.io/v2"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	ctrlclient "sigs.k8s.io/controller-runtime/pkg/client"
	gwv1 "sigs.k8s.io/gateway-api/apis/v1"

	gatewayapi "github.com/accuknox/agentz/internal/gateway/openapi"
	"github.com/accuknox/agentz/internal/guardrails"
	"github.com/accuknox/agentz/internal/inference"
	api "github.com/accuknox/agentz/pkg/apis/agentz/v1alpha1"
)

type readyPlaygroundClient struct {
	*guardrailProjectionClient
	probeScheme string
}

func (c *readyPlaygroundClient) Patch(ctx context.Context, object ctrlclient.Object, patch ctrlclient.Patch, options ...ctrlclient.PatchOption) error {
	object.SetGeneration(1)
	conditions := []metav1.Condition{
		{Type: "Accepted", Status: metav1.ConditionTrue, ObservedGeneration: 1},
		{Type: "Attached", Status: metav1.ConditionTrue, ObservedGeneration: 1},
		{Type: "ResolvedRefs", Status: metav1.ConditionTrue, ObservedGeneration: 1},
	}
	switch value := object.(type) {
	case *gwv1.HTTPRoute:
		for _, rule := range value.Spec.Rules {
			for _, filter := range rule.Filters {
				if filter.RequestRedirect != nil && filter.RequestRedirect.Scheme != nil {
					c.probeScheme = *filter.RequestRedirect.Scheme
				}
			}
		}
		value.Status.Parents = []gwv1.RouteParentStatus{
			{
				ParentRef:      gwv1.ParentReference{Name: playgroundGateway},
				ControllerName: "agentgateway.dev/agentgateway",
				Conditions:     conditions,
			},
		}
	case *agw.AgentgatewayBackend:
		value.Status.Conditions = conditions
	case *agw.AgentgatewayPolicy:
		value.Status.Ancestors = []gwv1.PolicyAncestorStatus{
			{
				AncestorRef:    gwv1.ParentReference{Name: playgroundGateway},
				ControllerName: "agentgateway.dev/agentgateway",
				Conditions:     conditions,
			},
		}
	}
	return c.guardrailProjectionClient.Patch(ctx, object, patch, options...)
}

func TestPlaygroundRequiresCurrentAttachedPolicyBeforeSending(t *testing.T) {
	service := sandboxTestService(t, &sandboxQueries{})
	scheme := service.k8sClient.Scheme()
	if err := agw.Install(scheme); err != nil {
		t.Fatal(err)
	}
	if err := gwv1.Install(scheme); err != nil {
		t.Fatal(err)
	}
	name := "test-ready"
	namespace := api.ScopeNamespace(api.ResourceScopeOrganisation, testOrganizationID)
	conditions := []metav1.Condition{
		{Type: "Accepted", Status: metav1.ConditionTrue, ObservedGeneration: 2},
		{Type: "ResolvedRefs", Status: metav1.ConditionTrue, ObservedGeneration: 2},
	}
	route := &gwv1.HTTPRoute{
		ObjectMeta: metav1.ObjectMeta{
			Name:       inference.SandboxProviderRuntimeName(name, "playground"),
			Namespace:  namespace,
			Generation: 2,
		},
		Status: gwv1.HTTPRouteStatus{
			Parents: []gwv1.RouteParentStatus{
				{
					ParentRef:      gwv1.ParentReference{Name: playgroundGateway},
					ControllerName: "agentgateway.dev/agentgateway",
					Conditions:     conditions,
				},
			},
		},
	}
	backend := &agw.AgentgatewayBackend{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: namespace, Generation: 2},
	}
	backend.Status.Conditions = conditions
	policy := &agw.AgentgatewayPolicy{
		ObjectMeta: metav1.ObjectMeta{Name: route.Name, Namespace: namespace, Generation: 2},
	}
	policy.Status.Ancestors = []gwv1.PolicyAncestorStatus{
		{
			AncestorRef:    gwv1.ParentReference{Name: playgroundGateway},
			ControllerName: "agentgateway.dev/agentgateway",
			Conditions:     conditions[:1],
		},
	}
	for _, object := range []ctrlclient.Object{route, backend, policy} {
		if err := service.k8sClient.Create(t.Context(), object); err != nil {
			t.Fatal(err)
		}
	}
	ready, err := service.guardrailPlaygroundReady(t.Context(), namespace, name)
	if err != nil || ready {
		t.Fatalf("route/backend acceptance admitted unattached checks: ready=%v, error=%v", ready, err)
	}
	policy.Status.Ancestors[0].Conditions = append(policy.Status.Ancestors[0].Conditions, metav1.Condition{
		Type:               "Attached",
		Status:             metav1.ConditionTrue,
		ObservedGeneration: 1,
	})
	if err := service.k8sClient.Update(t.Context(), policy); err != nil {
		t.Fatal(err)
	}
	ready, err = service.guardrailPlaygroundReady(t.Context(), namespace, name)
	if err != nil || ready {
		t.Fatalf("stale policy attachment admitted current checks: ready=%v, error=%v", ready, err)
	}
	policy.Status.Ancestors[0].Conditions[1].ObservedGeneration = 2
	if err := service.k8sClient.Update(t.Context(), policy); err != nil {
		t.Fatal(err)
	}
	ready, err = service.guardrailPlaygroundReady(t.Context(), namespace, name)
	if err != nil || !ready {
		t.Fatalf("current fully attached checks stayed unavailable: ready=%v, error=%v", ready, err)
	}
}

type playgroundProofCase struct {
	name, proof     string
	wantAction      gatewayapi.GuardrailTestResultAction
	wantExplanation string
	wantError       bool
	wantErrorText   string
	clientTimeout   time.Duration
	responseDelay   time.Duration
	wantNoPost      bool
}

func TestPlaygroundNeverReportsUncheckedSuccess(t *testing.T) {
	cases := []playgroundProofCase{
		{name: "route reached before response proof", wantError: true},
		{name: "empty evaluation report", proof: "[]", wantError: true},
		{name: "different revision", proof: "stale", wantError: true},
		{name: "all configured checks evaluated", proof: "complete"},
		{
			name:  "TLS data plane readiness preserves target scheme",
			proof: "secure-route",
		},
		{
			name:  "data plane readiness can be retried without evaluation",
			proof: "readiness-delayed",
		},
		{
			name:       "wrong data plane proof never evaluates",
			proof:      "readiness-wrong",
			wantError:  true,
			wantNoPost: true,
		},
		{
			name:            "checker deadline can outlast shared client timeout",
			proof:           "checker-open",
			clientTimeout:   time.Millisecond,
			responseDelay:   20 * time.Millisecond,
			wantExplanation: "Traffic continued",
		},
		{
			name:      "redirect never repeats evaluation",
			proof:     "redirect",
			wantError: true,
		},
		{
			name:          "checker unavailable without trusted marker is never replayed",
			proof:         "checker-unmarked",
			wantError:     true,
			wantErrorText: "gateway test returned an unverified failure response",
		},
		{
			name:          "upstream not found after evaluation is never replayed",
			proof:         "evaluated-not-found",
			wantError:     true,
			wantErrorText: "gateway test returned an unverified failure response",
		},
		{
			name:          "proofless not found is never replayed",
			proof:         "route-first",
			wantError:     true,
			wantErrorText: "gateway test returned HTTP 404",
		},
		{
			name:            "mandatory recheck after masking",
			proof:           "mandatory-final",
			wantExplanation: "The check allowed",
		},
		{
			name:      "unmarked duplicate evaluation",
			proof:     "unexpected-repeat",
			wantError: true,
		},
		{
			name:            "closed checker failure stops traffic",
			proof:           "checker-closed",
			wantAction:      "error",
			wantExplanation: "Traffic stopped",
		},
		{
			name:            "open checker failure continues traffic",
			proof:           "checker-open",
			wantExplanation: "Traffic continued",
		},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			service := sandboxTestService(t, &sandboxQueries{})
			scheme := service.k8sClient.Scheme()
			if err := agw.Install(scheme); err != nil {
				t.Fatal(err)
			}
			if err := gwv1.Install(scheme); err != nil {
				t.Fatal(err)
			}
			if err := ciliumv2.AddToScheme(scheme); err != nil {
				t.Fatal(err)
			}
			readyClient := &readyPlaygroundClient{
				guardrailProjectionClient: &guardrailProjectionClient{Client: service.k8sClient},
			}
			service.k8sClient = readyClient
			namespace := api.ScopeNamespace(api.ResourceScopeOrganisation, testOrganizationID)
			policy := &api.GuardrailPolicy{
				ObjectMeta: metav1.ObjectMeta{Name: "proof", Namespace: namespace, UID: "proof-policy"},
				Spec: api.GuardrailPolicySpec{
					DisplayName: "Proof",
					Checks: []api.GuardrailCheck{
						{
							ID:          "proof-check",
							Name:        "Proof check",
							Phase:       "input",
							Scopes:      []string{"conversation"},
							Mode:        "enforce",
							FailureMode: "closed",
							Action:      "deny",
							Regex:       &api.GuardrailRegex{Patterns: []string{"forbidden"}},
						},
					},
				},
			}
			bundle, err := guardrails.CompilePolicy(t.Context(), service.k8sClient, namespace, policy)
			if err != nil {
				t.Fatal(err)
			}
			proof := test.proof
			if proof == "mandatory-final" {
				bundle.Context.Request[0].Mandatory = true
			}
			if proof != "" && proof != "[]" {
				expected := bundle.Context.Request[0]
				revision := expected.Revision
				if proof == "stale" {
					revision = "previous-revision"
				}
				evaluations := []gatewayapi.GuardrailRuntimeEvaluation{
					{
						Phase:  "request",
						Guard:  "regex",
						Action: "allow",
						Agentz: &gatewayapi.GuardrailEvaluationContext{
							PolicyId:    expected.PolicyID,
							CheckId:     expected.CheckID,
							Revision:    revision,
							ReferenceId: "reference",
							Mandatory:   expected.Mandatory,
						},
					},
				}
				if proof == "mandatory-final" || proof == "unexpected-repeat" {
					final := evaluations[0]
					context := *final.Agentz
					final.Agentz = &context
					if proof == "mandatory-final" {
						final.Agentz.ValidationPass = new(gatewayapi.MandatoryFinal)
					}
					evaluations = append(evaluations, final)
				}
				if strings.HasPrefix(proof, "checker-") {
					evaluations[0].Agentz.ErrorCode = new("checker_error")
					evaluations[0].Action = "failOpen"
					if proof == "checker-closed" {
						evaluations[0].Action = "reject"
					}
				}
				encoded, err := json.Marshal(evaluations)
				if err != nil {
					t.Fatal(err)
				}
				proof = string(encoded)
			}
			var requests atomic.Int32
			var probes atomic.Int32
			server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodGet {
					attempt := probes.Add(1)
					if test.proof == "readiness-delayed" && attempt == 1 {
						w.WriteHeader(http.StatusNotFound)
						return
					}
					scheme := "http"
					if r.TLS != nil {
						scheme = "https"
					}
					location := scheme + "://" + r.Host + r.URL.Path + "/" + bundle.Revision
					if test.proof == "readiness-wrong" {
						location += "-previous"
					}
					w.Header().Set("Location", location)
					w.WriteHeader(http.StatusFound)
					return
				}
				attempt := requests.Add(1)
				if test.responseDelay != 0 {
					time.Sleep(test.responseDelay)
				}
				if test.proof == "redirect" && attempt == 1 {
					w.Header().Set("Location", r.URL.Path)
					w.WriteHeader(http.StatusFound)
					return
				}
				if test.proof == "route-first" && attempt == 1 {
					w.WriteHeader(http.StatusNotFound)
					return
				}
				if proof != "" {
					w.Header().Set("x-agentz-guardrail-test", proof)
				}
				w.Header().Set("Content-Type", "application/json")
				if test.proof == "checker-closed" || test.proof == "checker-unmarked" || test.proof == "evaluated-not-found" {
					if test.proof == "checker-closed" {
						w.Header().Set("x-agentz-guardrail-outcome", "1")
					}
					status := http.StatusServiceUnavailable
					if test.proof == "evaluated-not-found" {
						status = http.StatusNotFound
					}
					w.WriteHeader(status)
					_, _ = w.Write([]byte(`{"error":{"type":"guardrail_unavailable","code":"guardrail_unavailable","message":"unavailable","guardrail":{"code":"guardrail_unavailable","phase":"input","safeLabel":"Check","explanation":"unavailable","referenceId":"reference","partialOutput":false}}}`))
					return
				}
				_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"safe"}}]}`))
			}))
			if test.proof == "secure-route" {
				server.StartTLS()
			} else {
				server.Start()
			}
			defer server.Close()
			service.outboundHTTP = server.Client()
			service.outboundHTTP.Timeout = test.clientTimeout
			service.cfg.GuardrailGatewayURL = server.URL
			service.cfg.GuardrailCallbackURL = "http://callback.example"
			ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
			defer cancel()
			result, err := service.evaluateGuardrailPlayground(ctx, resourceAccess{namespace: namespace}, bundle, "input", "safe")
			wantPosts := int32(1)
			if test.wantNoPost {
				wantPosts = 0
			}
			if requests.Load() != wantPosts {
				t.Fatalf("readiness replayed or admitted evaluation: got %d POSTs, want %d", requests.Load(), wantPosts)
			}
			if test.proof == "readiness-delayed" && probes.Load() < 2 {
				t.Fatal("data plane readiness was not checked before evaluating")
			}
			if test.wantErrorText != "" && (err == nil || err.Error() != test.wantErrorText) {
				t.Fatalf("checker failure was retried as readiness: got %v, want %s", err, test.wantErrorText)
			}
			if test.proof == "secure-route" && readyClient.probeScheme != "https" {
				t.Fatalf("TLS override received an incompatible native readiness redirect: %s", readyClient.probeScheme)
			}
			if (err != nil) != test.wantError {
				t.Fatalf("unchecked response result=%#v, error=%v, want error=%v", result, err, test.wantError)
			}
			wantAction := test.wantAction
			if wantAction == "" {
				wantAction = "allow"
			}
			wantChecks := 1
			if test.proof == "mandatory-final" {
				wantChecks = 2
			}
			if err == nil && (result.Action != wantAction || len(result.Checks) != wantChecks) {
				t.Fatalf("complete proof lost evaluated check: %#v", result)
			}
			if err == nil && test.wantExplanation != "" && !strings.Contains(result.Checks[0].Explanation, test.wantExplanation) {
				t.Fatalf("checker failure misrepresented whether traffic continued: %#v", result)
			}
			if err == nil && test.proof == "mandatory-final" && !strings.Contains(result.Checks[1].Explanation, "repeated after masking") {
				t.Fatal("mandatory recheck was hidden from the test result")
			}
		})
	}
}
