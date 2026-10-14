-- +goose Up

CREATE TABLE observer_app_operations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  app_name TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  resource_kind TEXT NOT NULL,
  resource_namespace TEXT NOT NULL,
  resource_name TEXT NOT NULL,
  resource_uid TEXT NOT NULL,
  target_id TEXT NOT NULL,
  trace_id BYTEA NOT NULL,
  span_id BYTEA NOT NULL,
  parent_span_id BYTEA NOT NULL DEFAULT ''::BYTEA,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  duration_ns BIGINT NOT NULL,
  name TEXT NOT NULL,
  span_class TEXT NOT NULL,
  operation_name TEXT NOT NULL,
  status_code TEXT NOT NULL,
  error_type TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  tool_name TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL DEFAULT '',
  input_tokens BIGINT,
  output_tokens BIGINT,
  reasoning_tokens BIGINT,
  cached_input_tokens BIGINT,
  cached_write_tokens BIGINT,
  cost_usd DOUBLE PRECISION,
  resource_attributes JSONB NOT NULL DEFAULT '{}'::JSONB,
  span_attributes JSONB NOT NULL DEFAULT '{}'::JSONB,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, workspace_id, client_id, trace_id, span_id, start_time)
);

CREATE INDEX observer_app_operations_subject_time_idx
  ON observer_app_operations (organization_id, workspace_id, client_id, start_time DESC, id DESC);
CREATE INDEX observer_app_operations_subject_trace_idx
  ON observer_app_operations (organization_id, workspace_id, client_id, trace_id, start_time, id);

CREATE TABLE observer_app_operation_payloads (
  operation_id BIGINT PRIMARY KEY REFERENCES observer_app_operations(id) ON DELETE CASCADE,
  input_messages JSONB NOT NULL DEFAULT 'null'::JSONB,
  output_messages JSONB NOT NULL DEFAULT 'null'::JSONB,
  tool_arguments JSONB NOT NULL DEFAULT 'null'::JSONB,
  tool_result JSONB NOT NULL DEFAULT 'null'::JSONB,
  tool_error JSONB NOT NULL DEFAULT 'null'::JSONB
);

-- +goose Down
DROP TABLE observer_app_operation_payloads;
DROP TABLE observer_app_operations;
