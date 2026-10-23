package v1alpha1

import metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

// GuardrailConnectionFinalizer protects projected credentials until all copies are removed.
const GuardrailConnectionFinalizer = "agentz.accuknox.com/guardrail-connection"

// GuardrailProvider identifies the detector protocol.
// +kubebuilder:validation:Enum=OpenAI;Bedrock;ModelArmor;Webhook
type GuardrailProvider string

// GuardrailCaptureMode controls exact inspected-content audit storage.
// +kubebuilder:validation:Enum=off;findings;all
type GuardrailCaptureMode string

// GuardrailAssignment selects additions after the mandatory organization baseline.
type GuardrailAssignment struct {
	// Policies is the ordered set of optional policy references.
	// +optional
	Policies []ResourceReference `json:"policies,omitempty"`
	// CaptureMode defaults to off and requires organization permission.
	// +kubebuilder:default=off
	// +optional
	CaptureMode GuardrailCaptureMode `json:"captureMode,omitempty"`
}

// GuardrailSettings is owned exclusively by organization administrators.
type GuardrailSettings struct {
	// MandatoryPolicies is the ordered organization policy baseline.
	// +optional
	MandatoryPolicies []string `json:"mandatoryPolicies,omitempty"`
	// AllowContentCapture permits resource owners to opt into inspected-content storage.
	// +optional
	AllowContentCapture bool `json:"allowContentCapture,omitempty"`
	// RetentionDays expires metadata and captured content together.
	// +kubebuilder:validation:Minimum=1
	// +kubebuilder:validation:Maximum=3650
	// +kubebuilder:default=30
	// +optional
	RetentionDays int32 `json:"retentionDays,omitempty"`
}

// GuardrailConnectionSpec defines a reusable detector connection, never its secret values.
type GuardrailConnectionSpec struct {
	ResourceAudit `json:",inline"`
	// DisplayName is the human-readable connection label.
	// +kubebuilder:validation:MinLength=1
	DisplayName string `json:"displayName"`
	// Description explains the connection's intended use.
	// +optional
	Description string `json:"description,omitempty"`
	// Provider selects the supported detector protocol.
	// +kubebuilder:validation:XValidation:rule="self == oldSelf",message="provider is immutable"
	Provider GuardrailProvider `json:"provider"`
	// Endpoint overrides the detector base URL; required for custom webhooks.
	// +optional
	Endpoint string `json:"endpoint,omitempty"`
	// Region selects the AWS or Google location.
	// +optional
	Region string `json:"region,omitempty"`
	// SecretName identifies the materialized Kubernetes credentials secret.
	// +optional
	SecretName string `json:"secretName,omitempty"`
}

// GuardrailResourceStatus reports the desired revision and reconciliation state.
type GuardrailResourceStatus struct {
	// ObservedGeneration is the latest reconciled desired generation.
	// +optional
	ObservedGeneration int64 `json:"observedGeneration,omitempty"`
	// Revision identifies the effective configuration.
	// +optional
	Revision string `json:"revision,omitempty"`
	// State is Pending, Ready, or Error.
	// +optional
	State string `json:"state,omitempty"`
	// Message is a safe readiness explanation.
	// +optional
	Message string `json:"message,omitempty"`
	// Conditions records current reconciliation results.
	// +listType=map
	// +listMapKey=type
	// +optional
	Conditions []metav1.Condition `json:"conditions,omitempty"`
}

// GuardrailRegex configures a deterministic text detector.
type GuardrailRegex struct {
	// Patterns are RE2 regular expressions.
	// +kubebuilder:validation:MinItems=1
	Patterns []string `json:"patterns"`
	// Replacement is the text substituted for matches when action is mask.
	// +optional
	Replacement string `json:"replacement,omitempty"`
}

// GuardrailCheck is one ordered input or output evaluation.
type GuardrailCheck struct {
	// ID remains stable across edits for audit correlation.
	// +kubebuilder:validation:MinLength=1
	ID string `json:"id"`
	// Name is a safe administrator-defined label.
	Name string `json:"name"`
	// Phase selects input or output evaluation.
	// +kubebuilder:validation:Enum=input;output
	Phase string `json:"phase"`
	// Scopes selects supported textual content classes.
	// +kubebuilder:validation:MinItems=1
	Scopes []string `json:"scopes"`
	// Mode controls enforcement independently of operational failure handling.
	// +kubebuilder:validation:Enum=enforce;audit
	Mode string `json:"mode"`
	// FailureMode controls checker outages and invalid verdicts.
	// +kubebuilder:validation:Enum=closed;open
	FailureMode string `json:"failureMode"`
	// Action selects denial or supported masking.
	// +kubebuilder:validation:Enum=deny;mask
	Action string `json:"action"`
	// Connection selects a reusable detector; absent for regex checks.
	// +optional
	Connection *ResourceReference `json:"connection,omitempty"`
	// Regex configures a local regex check.
	// +optional
	Regex *GuardrailRegex `json:"regex,omitempty"`
	// GuardrailID references an existing AWS guardrail.
	// +optional
	GuardrailID string `json:"guardrailId,omitempty"`
	// GuardrailVersion is the explicitly selected AWS guardrail version.
	// +optional
	GuardrailVersion string `json:"guardrailVersion,omitempty"`
	// Template references an existing Google Model Armor template.
	// +optional
	Template string `json:"template,omitempty"`
	// SafeExplanation is displayed without exposing detector evidence.
	// +optional
	SafeExplanation string `json:"safeExplanation,omitempty"`
}

// GuardrailPolicySpec defines reusable ordered detector checks.
type GuardrailPolicySpec struct {
	ResourceAudit `json:",inline"`
	// DisplayName is the human-readable policy label.
	// +kubebuilder:validation:MinLength=1
	DisplayName string `json:"displayName"`
	// Description explains policy intent.
	// +optional
	Description string `json:"description,omitempty"`
	// Checks is evaluated in authored order within each phase.
	// +kubebuilder:validation:MinItems=1
	Checks []GuardrailCheck `json:"checks"`
}

// +genclient
// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:path=guardrailconnections

// GuardrailConnection is a reusable scoped detector transport.
type GuardrailConnection struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitzero"`
	Spec              GuardrailConnectionSpec `json:"spec"`
	// +optional
	Status GuardrailResourceStatus `json:"status,omitzero"`
}

// +kubebuilder:object:root=true

// GuardrailConnectionList contains scoped detector connections.
type GuardrailConnectionList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitzero"`
	Items           []GuardrailConnection `json:"items"`
}

// +genclient
// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:path=guardrailpolicies

// GuardrailPolicy is a reusable ordered set of prompt checks.
type GuardrailPolicy struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitzero"`
	Spec              GuardrailPolicySpec `json:"spec"`
	// +optional
	Status GuardrailResourceStatus `json:"status,omitzero"`
}

// +kubebuilder:object:root=true

// GuardrailPolicyList contains scoped policies.
type GuardrailPolicyList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitzero"`
	Items           []GuardrailPolicy `json:"items"`
}

func init() {
	SchemeBuilder.Register(&GuardrailConnection{}, &GuardrailConnectionList{}, &GuardrailPolicy{}, &GuardrailPolicyList{})
}

// GuardrailOutcome is safe feedback shared by chat, workflows, and external clients.
type GuardrailOutcome struct {
	// Code distinguishes a content denial from unavailable safeguards.
	Code string `json:"code"`
	// Phase identifies input or output evaluation.
	Phase string `json:"phase"`
	// SafeLabel identifies a policy without exposing detector evidence.
	SafeLabel string `json:"safeLabel"`
	// Explanation gives the user an actionable next step.
	Explanation string `json:"explanation"`
	// ReferenceID correlates the outcome with scoped audit evidence.
	ReferenceID string `json:"referenceId"`
	// PartialOutput marks delivered content as incomplete.
	PartialOutput bool `json:"partialOutput"`
}
