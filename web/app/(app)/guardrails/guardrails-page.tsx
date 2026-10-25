import type { ReactNode } from "react"
import { notFound } from "next/navigation"
import { z } from "zod"
import { AdministrationState } from "@/components/administration"
import {
  listGuardrailConnectionsQuery,
  listGuardrailPoliciesQuery,
  getGuardrailSettingsQuery,
} from "@/data/guardrail.queries"
import {
  getGuardrailEvent,
  listGuardrailEvents,
  type ResourceCapabilities,
} from "@/lib/gateway/client"
import { getGatewayServerClient } from "@/lib/gateway/server-client"
import { zGuardrailRuntimeEvaluation } from "@/lib/gateway/client/zod.gen"
import {
  GuardrailPolicyList,
  GuardrailConnectionList,
  GuardrailRolloutRefresh,
} from "./resource-list"
import { PolicyEditor } from "./policy-editor"
import { GuardrailOrganizationSettings } from "./settings"
import { GuardrailEvents, GuardrailEventDetail } from "./events"

export async function GuardrailsPage({
  basePath,
  canAdminister,
  connectionCapabilities,
  eventCapabilities,
  policyCapabilities,
  view,
  searchParams,
  workspaceId,
}: {
  basePath: `/orgs/${string}/guardrails`
  canAdminister: boolean
  connectionCapabilities: ResourceCapabilities
  eventCapabilities: ResourceCapabilities
  policyCapabilities: ResourceCapabilities
  view: string[]
  searchParams: Record<string, string | string[] | undefined>
  workspaceId?: string
}) {
  const section =
    view[0] ??
    (policyCapabilities.read ? "policies" : connectionCapabilities.read ? "connections" : "events")
  if (!["policies", "connections", "events", "settings"].includes(section) || view.length > 2)
    notFound()
  if (section !== "policies" && section !== "events" && view.length > 1) notFound()
  const scope = { workspaceId }
  let content: ReactNode

  if (section === "events") {
    if (!eventCapabilities.read) return <AdministrationState kind="forbidden" />
    const client = getGatewayServerClient(workspaceId)
    const headers = workspaceId ? { "X-AgentZ-Workspace-ID": workspaceId } : undefined
    if (view[1]) {
      const result = await getGuardrailEvent({ client, headers, path: { eventId: view[1] } })
      content = result.error ? (
        <AdministrationState
          description={result.error.message}
          kind="not-found"
          title="Event unavailable"
        />
      ) : (
        <GuardrailEventDetail basePath={basePath} event={result.data} />
      )
    } else {
      const action = zGuardrailRuntimeEvaluation.shape.action.safeParse(searchParams.action)
      const referenceId = z.string().optional().safeParse(searchParams.reference_id)
      const cursor = z.string().optional().safeParse(searchParams.cursor)
      const result = await listGuardrailEvents({
        client,
        headers,
        query: {
          limit: 25,
          action: action.success ? action.data : undefined,
          reference_id: referenceId.success ? referenceId.data || undefined : undefined,
          cursor: cursor.success ? cursor.data : undefined,
        },
      })
      content = result.error ? (
        <AdministrationState
          description={result.error.message}
          kind="failed"
          title="Could not load guardrail events"
        />
      ) : (
        <GuardrailEvents
          action={action.success ? action.data : undefined}
          basePath={basePath}
          data={result.data}
          referenceId={referenceId.success ? referenceId.data : undefined}
        />
      )
    }
  } else {
    if (
      (section === "connections" && !connectionCapabilities.read) ||
      (section !== "connections" && !policyCapabilities.read) ||
      (section === "settings" && (workspaceId || !canAdminister))
    )
      return <AdministrationState kind="forbidden" />
    const needsConnections =
      connectionCapabilities.read &&
      (section === "connections" || (section === "policies" && view[1] !== undefined))
    const needsPolicies = section !== "connections"
    const needsSettings =
      section === "settings" ||
      (workspaceId !== undefined && section === "policies" && view[1] === undefined)
    const [connectionResult, policyResult, settingsResult] = await Promise.all([
      needsConnections ? listGuardrailConnectionsQuery(workspaceId) : Promise.resolve(undefined),
      needsPolicies ? listGuardrailPoliciesQuery(workspaceId) : Promise.resolve(undefined),
      needsSettings ? getGuardrailSettingsQuery(workspaceId) : Promise.resolve(undefined),
    ])
    const error = connectionResult?.error ?? policyResult?.error ?? settingsResult?.error
    if (
      error ||
      (needsConnections && !connectionResult?.data) ||
      (needsPolicies && !policyResult?.data) ||
      (needsSettings && !settingsResult?.data)
    )
      return (
        <AdministrationState
          description={error?.message ?? "Guardrail configuration is unavailable."}
          kind="failed"
          title="Could not load guardrails"
        />
      )
    const connections = connectionResult?.data?.items ?? []
    const policies = policyResult?.data?.items ?? []
    const settings = settingsResult?.data
    if (section === "connections")
      content = <GuardrailConnectionList connections={connections} scope={scope} />
    if (section === "policies") {
      if (view[1]) {
        const selectedScope = searchParams.scope
        const policy = policies.find(
          (item) => item.name === view[1] && (!selectedScope || item.scope === selectedScope)
        )
        if (view[1] === "new" && !policyCapabilities.create)
          return <AdministrationState kind="forbidden" />
        if (view[1] !== "new" && !policy) notFound()
        content = (
          <>
            <GuardrailPolicyList basePath={basePath} policies={policies} scope={scope} />
            <PolicyEditor
              basePath={basePath}
              canCreateConnection={connectionCapabilities.create}
              connections={connections}
              key={`${view[1]}/${policy?.scope ?? "new"}`}
              policy={policy}
              scope={scope}
            />
          </>
        )
      } else content = <GuardrailPolicyList basePath={basePath} policies={policies} scope={scope} />
    }
    if (section === "settings" && settings)
      content = (
        <GuardrailOrganizationSettings
          canModify={canAdminister}
          initial={settings}
          policies={policies}
        />
      )

    content = (
      <>
        {workspaceId && settings && settings.mandatoryPolicies.length > 0 ? (
          <div className="px-4 md:px-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>
                {settings.mandatoryPolicies.length} required organization{" "}
                {settings.mandatoryPolicies.length === 1
                  ? "policy applies automatically."
                  : "policies apply automatically."}
              </span>
            </div>
          </div>
        ) : null}
        <GuardrailRolloutRefresh
          pending={
            connections.some((item) => item.status.state === "Pending") ||
            policies.some((item) => item.status.state === "Pending")
          }
        />
        {content}
      </>
    )
  }

  return content
}
