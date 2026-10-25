-- +goose Up
-- Existing patched events retain their original payload, identity and expiry.
ALTER TABLE observer_guardrail_events
  ADD COLUMN span_id BYTEA NOT NULL DEFAULT ''::bytea,
  ADD COLUMN evaluation_index INTEGER NOT NULL DEFAULT -1,
  ADD COLUMN revision TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX observer_guardrail_events_span_evaluation_idx
  ON observer_guardrail_events (trace_id, span_id, evaluation_index)
  WHERE octet_length(span_id) = 8;

-- +goose Down
DROP INDEX observer_guardrail_events_span_evaluation_idx;
ALTER TABLE observer_guardrail_events
  DROP COLUMN span_id,
  DROP COLUMN evaluation_index,
  DROP COLUMN revision;
