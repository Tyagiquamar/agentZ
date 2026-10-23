-- +goose Up

CREATE TABLE observer_guardrail_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT '',
  occurred_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  sandbox_name TEXT NOT NULL DEFAULT '',
  agent_name TEXT NOT NULL DEFAULT '',
  client_id TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  trace_id BYTEA NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('request', 'response')),
  action TEXT NOT NULL CHECK (action IN ('allow', 'failOpen', 'audit', 'mask', 'reject')),
  policy_id TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  evaluation JSONB NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX observer_guardrail_events_scope_time_idx
  ON observer_guardrail_events (organization_id, workspace_id, occurred_at DESC, id DESC);
CREATE INDEX observer_guardrail_events_reference_idx
  ON observer_guardrail_events (organization_id, reference_id);
CREATE INDEX observer_guardrail_events_expiry_idx ON observer_guardrail_events (expires_at);

-- This Go-owned phase runs after the web migration has committed the new enum values.
-- Existing Sandbox authors need the same policy-read dependency as newly saved roles.
INSERT INTO permission_grants (
    role_id, organization_id, workspace_id, resource, action, locked
)
SELECT DISTINCT role_id, organization_id, workspace_id,
    'guardrail_policy'::permission_resource, 'read'::permission_action, true
FROM permission_grants
WHERE resource = 'sandbox' AND action IN ('create', 'modify')
ON CONFLICT ON CONSTRAINT permission_grants_scope_uidx DO NOTHING;

-- +goose Down
-- Keep additive policy-read grants: later administrator grants are indistinguishable.
DROP TABLE observer_guardrail_events;
