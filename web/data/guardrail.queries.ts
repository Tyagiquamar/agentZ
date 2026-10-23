import "server-only"

import {
  listGuardrailConnections,
  listGuardrailPolicies,
  getGuardrailSettings,
} from "@/lib/gateway/client"
import { getGatewayServerClient } from "@/lib/gateway/server-client"

export async function listGuardrailConnectionsQuery(workspaceId?: string) {
  const { data, error } = await listGuardrailConnections({
    client: getGatewayServerClient(workspaceId),
    headers: workspaceId ? { "X-AgentZ-Workspace-ID": workspaceId } : undefined,
  })
  return { data, error }
}

export async function listGuardrailPoliciesQuery(workspaceId?: string) {
  const { data, error } = await listGuardrailPolicies({
    client: getGatewayServerClient(workspaceId),
    headers: workspaceId ? { "X-AgentZ-Workspace-ID": workspaceId } : undefined,
  })
  return { data, error }
}

export async function getGuardrailSettingsQuery(workspaceId?: string) {
  const { data, error } = await getGuardrailSettings({
    client: getGatewayServerClient(workspaceId),
    headers: workspaceId ? { "X-AgentZ-Workspace-ID": workspaceId } : undefined,
  })
  return { data, error }
}
