import { Suspense } from "react"
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { AdministrationLoadingState, AdministrationPageHeader } from "@/components/administration"
import { getAuthSession } from "@/lib/auth"
import { getDB, schema } from "@/db"
import { ConnectedApplications, type ConnectedApplication } from "./connected-applications"

export const metadata = { title: "Connected applications" }

export default function ConnectedApplicationsPage() {
  return (
    <main className="flex min-w-0 flex-1 flex-col gap-6">
      <AdministrationPageHeader title="Connected applications" />
      <Suspense fallback={<AdministrationLoadingState />}>
        <ConnectedApplicationsContent />
      </Suspense>
    </main>
  )
}

async function ConnectedApplicationsContent() {
  const session = await getAuthSession()
  if (!session) return null
  const resourceOrganizations = alias(schema.organizations, "resource_organizations")
  const rows = await getDB()
    .select({
      clientId: schema.oauthClients.clientId,
      name: schema.oauthClients.name,
      owner: schema.organizations.name,
      organization: resourceOrganizations.name,
      organizationId: schema.delegationGrants.organizationId,
      scopes: schema.delegationGrants.scopes,
      selection: schema.delegationGrants.selection,
      createdAt: schema.delegationGrants.createdAt,
    })
    .from(schema.delegationGrants)
    .innerJoin(
      schema.oauthClients,
      eq(schema.oauthClients.clientId, schema.delegationGrants.clientId)
    )
    .leftJoin(schema.organizations, eq(schema.organizations.id, schema.oauthClients.referenceId))
    .leftJoin(
      resourceOrganizations,
      eq(resourceOrganizations.id, schema.delegationGrants.organizationId)
    )
    .where(
      and(
        eq(schema.delegationGrants.userId, session.session.user.id),
        isNull(schema.delegationGrants.revokedAt),
        isNotNull(schema.delegationGrants.approvedAt)
      )
    )
    .orderBy(desc(schema.delegationGrants.createdAt))
  const grouped = new Map<string, ConnectedApplication>()
  for (const row of rows) {
    const current: ConnectedApplication = grouped.get(row.clientId) ?? {
      clientId: row.clientId,
      name: row.name ?? "Application",
      owner: row.owner,
      scopes: [],
      access: [],
      createdAt: row.createdAt.toISOString(),
    }
    current.scopes = [...new Set([...current.scopes, ...row.scopes])]
    current.createdAt = row.createdAt.toISOString()
    grouped.set(row.clientId, current)
    if (!row.selection.models.length && !row.selection.mcp.length) continue
    let access = current.access.find((item) => item.organizationId === row.organizationId)
    if (!access) {
      access = {
        organizationId: row.organizationId,
        organization: row.organization,
        selection: { models: [], mcp: [] },
      }
      current.access.push(access)
    }
    // Combine the display only. Tokens remain bound to their immutable grant.
    for (const model of row.selection.models) {
      if (!access.selection.models.some((item) => item.id === model.id)) {
        access.selection.models.push(model)
      }
    }
    for (const connection of row.selection.mcp) {
      const existing = access.selection.mcp.find((item) => item.id === connection.id)
      if (!existing) {
        access.selection.mcp.push({ ...connection })
        continue
      }
      for (const capability of ["tools", "prompts", "resources"] as const) {
        existing[capability] = [...new Set([...existing[capability], ...connection[capability]])]
      }
    }
  }
  const workspaceIds = [
    ...new Set(
      rows.flatMap((row) =>
        [...row.selection.models, ...row.selection.mcp].map((item) => item.workspace_id)
      )
    ),
  ]
  const workspaces = workspaceIds.length
    ? await getDB()
        .select({ id: schema.workspaces.id, name: schema.workspaces.name })
        .from(schema.workspaces)
        .where(inArray(schema.workspaces.id, workspaceIds))
    : []
  return (
    <ConnectedApplications
      applications={[...grouped.values()]}
      workspaces={Object.fromEntries(workspaces.map((workspace) => [workspace.id, workspace.name]))}
    />
  )
}
