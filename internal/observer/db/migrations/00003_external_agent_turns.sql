-- +goose Up
ALTER TABLE observer_app_operations
  ADD COLUMN agent_kind TEXT NOT NULL DEFAULT '' CHECK (agent_kind IN ('', 'claude', 'codex')),
  ADD COLUMN turn_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN tool_call_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN run_id BIGINT REFERENCES observer_app_operations(id) ON DELETE SET NULL,
  ADD COLUMN source_operation_id BIGINT REFERENCES observer_app_operations(id) ON DELETE SET NULL,
  ADD COLUMN result_id BIGINT,
  ADD COLUMN membership_inferred BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX observer_app_operations_turn_idx
  ON observer_app_operations (organization_id, workspace_id, client_id, user_id, session_id, turn_id)
  WHERE resource_kind = 'turn';
CREATE UNIQUE INDEX observer_app_operations_tool_idx
  ON observer_app_operations (organization_id, workspace_id, client_id, user_id, session_id, turn_id, tool_call_id)
  WHERE resource_kind = 'tool';
CREATE INDEX observer_app_operations_call_idx
  ON observer_app_operations (organization_id, workspace_id, client_id, user_id, tool_call_id)
  WHERE tool_call_id <> '';
CREATE INDEX observer_app_operations_run_idx
  ON observer_app_operations (organization_id, workspace_id, client_id, run_id, start_time, id);
CREATE INDEX observer_app_operations_roots_idx
  ON observer_app_operations (organization_id, workspace_id, client_id, resource_kind, start_time DESC, trace_id DESC)
  INCLUDE (id, session_id, end_time) WHERE run_id IS NULL;
CREATE INDEX observer_app_operations_source_idx
  ON observer_app_operations (source_operation_id) WHERE source_operation_id IS NOT NULL;
CREATE INDEX observer_app_operations_session_idx
  ON observer_app_operations (organization_id, workspace_id, client_id, session_id, start_time DESC, id DESC)
  WHERE session_id <> '';

-- Results reference the existing request payload. Replayed history adds only
-- source positions, preserving conflicting evidence without copying tool bodies.
CREATE TABLE observer_app_tool_results (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  source_turn_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  source_operation_id BIGINT NOT NULL REFERENCES observer_app_operations(id) ON DELETE CASCADE,
  source_start_time TIMESTAMPTZ NOT NULL,
  source_ordinal BIGINT NOT NULL,
  protocol TEXT NOT NULL CHECK (protocol IN ('messages', 'responses', 'chat')),
  is_error BOOLEAN NOT NULL,
  UNIQUE (source_operation_id, protocol, source_ordinal)
);
CREATE INDEX observer_app_tool_results_call_idx
  ON observer_app_tool_results (organization_id, workspace_id, client_id, user_id, tool_call_id, session_id);
ALTER TABLE observer_app_operations ADD CONSTRAINT observer_app_operations_result_fk
  FOREIGN KEY (result_id) REFERENCES observer_app_tool_results(id) ON DELETE SET NULL;

-- This projection keeps transport IDs on observations and exposes logical
-- parentage without reparsing payloads or raw telemetry attribute bags.
CREATE VIEW observer_app_spans AS
SELECT op.id, op.organization_id, op.workspace_id, op.client_id, op.app_name, op.grant_id, op.user_id,
  op.resource_kind, op.resource_namespace, op.resource_name, op.resource_uid, op.target_id,
  COALESCE(run.trace_id, op.trace_id)::bytea AS trace_id, op.span_id,
  CASE WHEN op.resource_kind = 'turn' THEN ''::bytea
    ELSE COALESCE(run.span_id, op.parent_span_id) END::bytea AS parent_span_id,
  op.start_time, op.end_time, op.duration_ns, op.name, op.span_class, op.operation_name,
  CASE WHEN op.resource_kind <> 'tool' THEN op.status_code
    WHEN result.is_error THEN 'ERROR' WHEN result.id IS NOT NULL THEN 'OK' ELSE 'UNSET' END::text AS status_code,
  op.error_type, op.error_message, op.model, op.tool_name,
  COALESCE(NULLIF(op.session_id, ''), run.session_id, '')::text AS session_id,
  op.input_tokens, op.output_tokens, op.reasoning_tokens, op.cached_input_tokens, op.cached_write_tokens, op.cost_usd,
  op.ingested_at, op.agent_kind, COALESCE(NULLIF(op.turn_id, ''), run.turn_id, '')::text AS turn_id,
  op.tool_call_id, op.run_id, op.source_operation_id, op.result_id,
  (op.resource_kind <> 'tool' OR NOT EXISTS (
    SELECT 1 FROM observer_app_operations mcp
    WHERE mcp.organization_id = op.organization_id AND mcp.workspace_id = op.workspace_id
      AND mcp.client_id = op.client_id AND mcp.user_id = op.user_id
      AND mcp.resource_kind = 'mcp' AND mcp.tool_call_id = op.tool_call_id AND mcp.run_id = op.run_id
      AND mcp.agent_kind = op.agent_kind
  )) AS visible
FROM observer_app_operations op
LEFT JOIN observer_app_operations run ON run.id = op.run_id
LEFT JOIN observer_app_tool_results result ON result.id = op.result_id;

-- +goose Down
DROP VIEW observer_app_spans;
DROP INDEX observer_app_operations_run_idx;
DROP INDEX observer_app_operations_source_idx;
DROP INDEX observer_app_operations_roots_idx;
-- Removing derived membership must preserve every captured gateway observation.
ALTER TABLE observer_app_operations DROP COLUMN run_id, DROP COLUMN source_operation_id, DROP COLUMN result_id;
DROP TABLE observer_app_tool_results;
DROP INDEX observer_app_operations_turn_idx;
DROP INDEX observer_app_operations_tool_idx;
DROP INDEX observer_app_operations_call_idx;
DROP INDEX observer_app_operations_session_idx;
DELETE FROM observer_app_operations WHERE resource_kind IN ('turn', 'tool');
ALTER TABLE observer_app_operations DROP COLUMN agent_kind, DROP COLUMN turn_id, DROP COLUMN tool_call_id,
  DROP COLUMN membership_inferred;
