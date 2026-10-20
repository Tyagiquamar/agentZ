-- +goose Up

-- Drain existing writers before installing the guards and purging old identities.
LOCK TABLE external_agents, observer_app_operations IN SHARE ROW EXCLUSIVE MODE;

-- +goose StatementBegin
CREATE FUNCTION observer_guard_external_agent() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Hold the registration until ingestion commits. Deletion then either purges
  -- this operation or finishes first and makes this insert a no-op.
  PERFORM 1 FROM external_agents
  WHERE client_id = NEW.client_id
    AND organization_id = NEW.organization_id
    AND workspace_id = NEW.workspace_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER observer_guard_external_agent
BEFORE INSERT ON observer_app_operations
FOR EACH ROW WHEN (NEW.agent_kind IN ('claude', 'codex'))
EXECUTE FUNCTION observer_guard_external_agent();

-- +goose StatementBegin
CREATE FUNCTION observer_delete_external_agent() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Payloads and tool results cascade from their source operations.
  DELETE FROM observer_app_operations
  WHERE organization_id = OLD.organization_id
    AND workspace_id = OLD.workspace_id
    AND client_id = OLD.client_id;
  RETURN OLD;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER observer_delete_external_agent
AFTER DELETE ON external_agents
FOR EACH ROW EXECUTE FUNCTION observer_delete_external_agent();

-- A deleted identity may have both native-agent and ordinary operation rows.
WITH deleted AS (
  SELECT DISTINCT op.organization_id, op.workspace_id, op.client_id
  FROM observer_app_operations op
  WHERE op.agent_kind IN ('claude', 'codex') AND NOT EXISTS (
    SELECT 1 FROM external_agents e
    WHERE e.organization_id = op.organization_id
      AND e.workspace_id = op.workspace_id AND e.client_id = op.client_id
  )
)
DELETE FROM observer_app_operations op USING deleted d
WHERE op.organization_id = d.organization_id
  AND op.workspace_id = d.workspace_id AND op.client_id = d.client_id;

-- +goose Down
DROP TRIGGER observer_delete_external_agent ON external_agents;
DROP FUNCTION observer_delete_external_agent();
DROP TRIGGER observer_guard_external_agent ON observer_app_operations;
DROP FUNCTION observer_guard_external_agent();
