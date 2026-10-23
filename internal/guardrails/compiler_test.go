package guardrails

import (
	"strings"
	"testing"

	agw "github.com/agentgateway/agentgateway/controller/api/v1alpha1/agentgateway"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	api "github.com/accuknox/agentz/pkg/apis/agentz/v1alpha1"
)

func guardrailFixture(t *testing.T) (client.Client, string, string) {
	t.Helper()
	scheme := runtime.NewScheme()
	if err := corev1.AddToScheme(scheme); err != nil {
		t.Fatal(err)
	}
	if err := api.AddToScheme(scheme); err != nil {
		t.Fatal(err)
	}
	org := api.ScopeNamespace(api.ResourceScopeOrganisation, "organization")
	workspace := api.ScopeNamespace(api.ResourceScopeWorkspace, "workspace")
	objects := []client.Object{
		&corev1.Namespace{
			ObjectMeta: metav1.ObjectMeta{
				Name:   org,
				Labels: map[string]string{api.TenantNameLabel: org},
			},
		},
		&corev1.Namespace{
			ObjectMeta: metav1.ObjectMeta{
				Name: workspace,
				Labels: map[string]string{
					api.WorkspaceNameLabel:        workspace,
					api.TenantOrganizationIDLabel: org,
				},
			},
		},
		&api.Workspace{
			ObjectMeta: metav1.ObjectMeta{Name: workspace},
			Spec:       api.WorkspaceSpec{WorkspaceID: "workspace", OrganizationID: "organization"},
		},
		&api.Tenant{
			ObjectMeta: metav1.ObjectMeta{Name: org},
			Spec: api.TenantSpec{
				OrganizationID: "organization",
				Guardrails: api.GuardrailSettings{
					MandatoryPolicies: []string{"baseline"},
					RetentionDays:     30,
				},
			},
		},
		&api.GuardrailPolicy{
			ObjectMeta: metav1.ObjectMeta{
				Name:       "baseline",
				Namespace:  org,
				UID:        "baseline-id",
				Generation: 1,
			},
			Spec: api.GuardrailPolicySpec{
				DisplayName: "Organization baseline",
				Checks: []api.GuardrailCheck{
					{
						ID:          "mandatory",
						Name:        "Mandatory detector",
						Phase:       "input",
						Scopes:      []string{"instructions", "conversation"},
						Mode:        "enforce",
						FailureMode: "closed",
						Action:      "deny",
						Regex:       &api.GuardrailRegex{Patterns: []string{"forbidden"}},
					},
				},
			},
		},
		&api.GuardrailPolicy{
			ObjectMeta: metav1.ObjectMeta{
				Name:       "addition",
				Namespace:  workspace,
				UID:        "addition-id",
				Generation: 1,
			},
			Spec: api.GuardrailPolicySpec{
				DisplayName: "Workspace addition",
				Checks: []api.GuardrailCheck{
					{
						ID:          "optional",
						Name:        "Optional detector",
						Phase:       "input",
						Scopes:      []string{"conversation"},
						Mode:        "audit",
						FailureMode: "open",
						Action:      "deny",
						Regex:       &api.GuardrailRegex{Patterns: []string{"sensitive"}},
					},
				},
			},
		},
	}
	return fake.NewClientBuilder().WithScheme(scheme).WithObjects(objects...).Build(), org, workspace
}

func TestMandatoryPolicyCannotBeReorderedOrWeakenedByAssignments(t *testing.T) {
	reader, _, workspace := guardrailFixture(t)
	assignment := api.GuardrailAssignment{
		Policies: []api.ResourceReference{
			{Scope: api.ResourceScopeWorkspace, Name: "addition"},
			{Scope: api.ResourceScopeOrganisation, Name: "baseline"},
		},
	}
	bundle, err := Resolve(t.Context(), reader, workspace, "sandbox/test", assignment)
	if err != nil {
		t.Fatal(err)
	}
	if len(bundle.Checks) != 2 || bundle.Checks[0].Check.ID != "mandatory" || !bundle.Checks[0].Mandatory {
		t.Fatalf("mandatory baseline lost precedence after optional policy promotion: %#v", bundle.Context.Request)
	}
	if bundle.Checks[0].Check.Mode != "enforce" || bundle.Checks[0].Check.FailureMode != "closed" {
		t.Fatal("workspace policy weakened organization enforcement")
	}
	if *bundle.Guard.Request[0].Regex.Action != agw.REJECT || *bundle.Guard.Request[1].Regex.Action != agw.AUDIT {
		t.Fatal("baseline and workspace enforcement modes were combined incorrectly")
	}
	if bundle.Context.Request[0].PolicyID != "baseline-id" || bundle.Context.Request[1].Mandatory {
		t.Fatal("runtime provenance lost the mandatory policy identity")
	}
}

func TestOptionalOrganizationPoliciesRequireExplicitSelection(t *testing.T) {
	reader, org, workspace := guardrailFixture(t)
	policy := &api.GuardrailPolicy{}
	if err := reader.Get(t.Context(), client.ObjectKey{Namespace: org, Name: "baseline"}, policy); err != nil {
		t.Fatal(err)
	}
	policy.ResourceVersion = ""
	policy.Name = "unselected"
	policy.UID = "unselected-id"
	if err := reader.Create(t.Context(), policy); err != nil {
		t.Fatal(err)
	}
	assignment := api.GuardrailAssignment{
		Policies: []api.ResourceReference{
			{Scope: api.ResourceScopeOrganisation, Name: "unselected"},
		},
	}
	if _, err := Resolve(t.Context(), reader, workspace, "sandbox/test", assignment); err == nil || !strings.Contains(err.Error(), "not selected") {
		t.Fatalf("unselected organization policy was available: %v", err)
	}
	if _, err := Resolve(t.Context(), reader, workspace, "sandbox/test", api.GuardrailAssignment{}); err != nil {
		t.Fatalf("mandatory baseline incorrectly required optional selection: %v", err)
	}
}

func TestRevisionExcludesStatusAndPreservesInflightSnapshot(t *testing.T) {
	reader, org, workspace := guardrailFixture(t)
	first, err := Resolve(t.Context(), reader, workspace, "sandbox/test", api.GuardrailAssignment{})
	if err != nil {
		t.Fatal(err)
	}
	policy := &api.GuardrailPolicy{}
	key := client.ObjectKey{Namespace: org, Name: "baseline"}
	if err := reader.Get(t.Context(), key, policy); err != nil {
		t.Fatal(err)
	}
	policy.Status.Message = "Reconciliation updated status"
	if err := reader.Update(t.Context(), policy); err != nil {
		t.Fatal(err)
	}
	statusOnly, err := Resolve(t.Context(), reader, workspace, "sandbox/test", api.GuardrailAssignment{})
	if err != nil || statusOnly.Revision != first.Revision {
		t.Fatalf("observed status changed desired policy revision: %v", err)
	}
	policy.Spec.Checks[0].Regex.Patterns = []string{"stricter"}
	policy.Generation++
	if err := reader.Update(t.Context(), policy); err != nil {
		t.Fatal(err)
	}
	updated, err := Resolve(t.Context(), reader, workspace, "sandbox/test", api.GuardrailAssignment{})
	if err != nil || updated.Revision == first.Revision {
		t.Fatalf("policy edit failed to change effective revision: %v", err)
	}
	if first.Guard.Request[0].Regex.Matches[0] != "forbidden" || first.Context.Request[0].Revision != first.Revision {
		t.Fatal("resolving a later request mutated an inflight policy snapshot")
	}
}

func TestCapturePermissionCannotBeEnabledByWorkspaceAssignment(t *testing.T) {
	reader, org, workspace := guardrailFixture(t)
	assignment := api.GuardrailAssignment{CaptureMode: "all"}
	bundle, err := Resolve(t.Context(), reader, workspace, "sandbox/test", assignment)
	if err != nil || bundle.Context.Capture != "off" {
		t.Fatalf("workspace bypassed organization capture permission: %v", err)
	}
	tenant := &api.Tenant{}
	if err := reader.Get(t.Context(), client.ObjectKey{Name: org}, tenant); err != nil {
		t.Fatal(err)
	}
	tenant.Spec.Guardrails.AllowContentCapture = true
	if err := reader.Update(t.Context(), tenant); err != nil {
		t.Fatal(err)
	}
	bundle, err = Resolve(t.Context(), reader, workspace, "sandbox/test", assignment)
	if err != nil || bundle.Context.Capture != "all" || bundle.Context.RetentionDays != 30 {
		t.Fatalf("authorized capture or shared retention was lost: %v", err)
	}
}

func TestCombinedPolicyLimitFailsWithoutDroppingMandatoryChecks(t *testing.T) {
	reader, _, workspace := guardrailFixture(t)
	policy := &api.GuardrailPolicy{}
	if err := reader.Get(t.Context(), client.ObjectKey{Namespace: workspace, Name: "addition"}, policy); err != nil {
		t.Fatal(err)
	}
	first := policy.Spec.Checks[0]
	policy.Spec.Checks = nil
	for _, id := range []string{"one", "two", "three", "four", "five", "six", "seven", "eight"} {
		check := first
		check.ID = id
		policy.Spec.Checks = append(policy.Spec.Checks, check)
	}
	if err := reader.Update(t.Context(), policy); err != nil {
		t.Fatal(err)
	}
	assignment := api.GuardrailAssignment{
		Policies: []api.ResourceReference{{Scope: api.ResourceScopeWorkspace, Name: "addition"}},
	}
	if _, err := Resolve(t.Context(), reader, workspace, "sandbox/test", assignment); err == nil || !strings.Contains(err.Error(), "eight checks") {
		t.Fatalf("over-limit composition silently omitted safeguards: %v", err)
	}
}

func TestStreamingDeliveryRejectsUnsupportedGuarantees(t *testing.T) {
	reader, _, workspace := guardrailFixture(t)
	policy := &api.GuardrailPolicy{
		ObjectMeta: metav1.ObjectMeta{Name: "output", Namespace: workspace},
		Spec: api.GuardrailPolicySpec{
			DisplayName: "Output",
			Checks: []api.GuardrailCheck{
				{
					ID:          "output",
					Name:        "Output",
					Phase:       "output",
					Scopes:      []string{"conversation"},
					Mode:        "enforce",
					FailureMode: "closed",
					Action:      "deny",
					Regex:       &api.GuardrailRegex{Patterns: []string{"forbidden"}},
				},
			},
		},
	}
	bundle, err := CompilePolicy(t.Context(), reader, workspace, policy)
	if err != nil || bundle.Context.Delivery != "checkedStreaming" {
		t.Fatalf("bounded literal could not use checked streaming: %v", err)
	}
	originalRevision := bundle.Revision
	if err := bundle.ConfigureManagedDelivery(); err != nil {
		t.Fatal(err)
	}
	managedRevision := bundle.Revision
	if bundle.Context.Delivery != "wholeOutput" || managedRevision == originalRevision {
		t.Fatal("managed enforced output must hold content and use a distinct effective revision")
	}
	if len(bundle.Context.Response) != 1 || bundle.Context.Response[0].Revision != managedRevision {
		t.Fatal("runtime audit context did not receive the managed delivery revision")
	}
	if err := bundle.ConfigureManagedDelivery(); err != nil || bundle.Revision != managedRevision {
		t.Fatal("managed delivery configuration must be stable across readiness checks")
	}
	policy.Spec.Checks[0].Regex.Patterns = []string{"forbidden.*later"}
	bundle, err = CompilePolicy(t.Context(), reader, workspace, policy)
	if err != nil || bundle.Context.Delivery != "wholeOutput" {
		t.Fatalf("unbounded check was incorrectly treated as a window check: %v", err)
	}
	policy.Spec.Checks[0].Action = "mask"
	bundle, err = CompilePolicy(t.Context(), reader, workspace, policy)
	if err != nil {
		t.Fatalf("non-streaming masking policy was rejected: %v", err)
	}
	if err := bundle.ConfigureManagedDelivery(); err == nil {
		t.Fatal("unsupported managed streaming transformation was accepted")
	}
	policy.Spec.Checks[0].Mode = "audit"
	bundle, err = CompilePolicy(t.Context(), reader, workspace, policy)
	if err != nil {
		t.Fatal(err)
	}
	if err := bundle.ConfigureManagedDelivery(); err != nil {
		t.Fatalf("non-mutating audit-only evaluation was rejected: %v", err)
	}
}

func TestRemoteProviderMaskingCannotBeOverriddenByAnUnusedAction(t *testing.T) {
	policy := api.GuardrailPolicySpec{
		DisplayName: "Remote detector",
		Checks: []api.GuardrailCheck{{
			ID: "remote", Name: "Remote detector", Phase: "input",
			Scopes: []string{"instructions", "conversation"}, Mode: "enforce",
			FailureMode: "closed", Action: "mask",
			Connection: &api.ResourceReference{Scope: api.ResourceScopeWorkspace, Name: "detector"},
		}},
	}
	if err := ValidatePolicy(policy); err == nil {
		t.Fatal("a remote mask override was silently accepted even though native providers own the resulting action")
	}
	policy.Checks[0].Action = "deny"
	if err := ValidatePolicy(policy); err != nil {
		t.Fatalf("normal native-provider enforcement was rejected: %v", err)
	}
}

func TestInputChecksDoNotChangeOutputDelivery(t *testing.T) {
	for _, provider := range []api.GuardrailProvider{"Regex", "Webhook", "Bedrock", "ModelArmor"} {
		for _, phase := range []string{"input", "output"} {
			for _, mode := range []string{"enforce", "audit"} {
				t.Run(string(provider)+"/"+phase+"/"+mode, func(t *testing.T) {
					policy := &api.GuardrailPolicy{
						ObjectMeta: metav1.ObjectMeta{Name: "delivery", Namespace: "test", UID: "delivery"},
					}
					check := api.GuardrailCheck{
						ID: "detector", Name: "Detector", Phase: phase,
						Scopes: []string{"instructions", "conversation"}, Mode: mode,
						FailureMode: "closed", Action: "deny",
						GuardrailID: "guardrail", GuardrailVersion: "1",
						Template: "projects/project/locations/region/templates/template",
					}
					if phase == "output" {
						check.Scopes = []string{"conversation"}
					}
					resolved := ResolvedCheck{Policy: policy, Check: check}
					if provider == "Regex" {
						resolved.Check.Action = "mask"
						resolved.Check.Regex = &api.GuardrailRegex{Patterns: []string{"bounded"}}
					} else {
						resolved.Connection = &api.GuardrailConnection{
							ObjectMeta: metav1.ObjectMeta{Name: "connection", Namespace: "test"},
							Spec:       api.GuardrailConnectionSpec{Provider: provider, Region: "region"},
						}
					}
					output := ResolvedCheck{Policy: policy, Check: api.GuardrailCheck{
						ID: "output", Name: "Output", Phase: "output", Scopes: []string{"conversation"},
						Mode: "audit", FailureMode: "closed", Action: "deny",
						Regex: &api.GuardrailRegex{Patterns: []string{"bounded"}},
					}}
					bundle := &Bundle{
						Context: RuntimeContext{Delivery: "checkedStreaming"},
						Checks:  []ResolvedCheck{resolved, output},
					}
					if err := bundle.compile("test", "test"); err != nil {
						t.Fatal(err)
					}
					want := "checkedStreaming"
					if phase == "output" && (provider != "Regex" || mode == "enforce") {
						want = "wholeOutput"
					}
					if bundle.Context.Delivery != want {
						t.Fatalf("input requirements or audit-only masking changed output delivery: got %s, want %s", bundle.Context.Delivery, want)
					}
				})
			}
		}
	}
}

func TestCompilePolicySharesConnectionsAndRejectsTermination(t *testing.T) {
	reader, _, namespace := guardrailFixture(t)
	connection := &api.GuardrailConnection{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: namespace, Name: "detector",
			Finalizers: []string{api.GuardrailConnectionFinalizer},
		},
		Spec: api.GuardrailConnectionSpec{
			DisplayName: "Detector", Provider: "Webhook", Endpoint: "https://detector.example",
		},
	}
	if err := reader.Create(t.Context(), connection); err != nil {
		t.Fatal(err)
	}
	policy := &api.GuardrailPolicy{
		ObjectMeta: metav1.ObjectMeta{Namespace: namespace, Name: "shared"},
		Spec:       api.GuardrailPolicySpec{DisplayName: "Shared detector"},
	}
	for _, id := range []string{"first", "second"} {
		policy.Spec.Checks = append(policy.Spec.Checks, api.GuardrailCheck{
			ID: id, Name: id, Phase: "input", Mode: "enforce", Action: "deny", FailureMode: "closed",
			Scopes:     []string{"instructions", "conversation"},
			Connection: &api.ResourceReference{Scope: api.ResourceScopeWorkspace, Name: connection.Name},
		})
	}
	bundle, err := CompilePolicy(t.Context(), reader, namespace, policy)
	if err != nil {
		t.Fatal(err)
	}
	if len(bundle.Connections) != 1 || len(bundle.Guard.Request) != 2 {
		t.Fatal("shared connections must project once without dropping ordered checks")
	}
	if err := reader.Delete(t.Context(), connection); err != nil {
		t.Fatal(err)
	}
	_, err = CompilePolicy(t.Context(), reader, namespace, policy)
	if err == nil || !strings.Contains(err.Error(), "terminating") {
		t.Fatalf("terminating detector was accepted: %v", err)
	}
}
