import { Suspense } from "react"
import { connection } from "next/server"
import { AdministrationLoadingState, AdministrationState } from "@/components/administration"
import { GuardrailsPage } from "@/app/(app)/guardrails/guardrails-page"
import { RememberRoute } from "@/data/route-memory"
import { getWorkspaceScope } from "@/data/workspaces"

export const metadata = { title: "Guardrails" }

export default function WorkspaceGuardrailsPage(
  props: PageProps<"/orgs/[orgSlug]/workspaces/[workspaceSlug]/guardrails/[[...view]]">
) {
  return (
    <Suspense fallback={<AdministrationLoadingState />}>
      <WorkspaceGuardrails {...props} />
    </Suspense>
  )
}

async function WorkspaceGuardrails({
  params,
  searchParams,
}: PageProps<"/orgs/[orgSlug]/workspaces/[workspaceSlug]/guardrails/[[...view]]">) {
  await connection()
  const { orgSlug, workspaceSlug, view } = await params
  const result = await getWorkspaceScope(orgSlug, workspaceSlug)
  if (result.kind !== "ready") return <AdministrationState kind="forbidden" />
  const capabilities = result.workspace.capabilities
  return (
    <>
      <RememberRoute />
      <GuardrailsPage
        basePath={`/orgs/${orgSlug}/workspaces/${workspaceSlug}/guardrails`}
        canAdminister={result.scope.organization.superadmin || capabilities.administer}
        connectionCapabilities={capabilities.guardrail_connections}
        eventCapabilities={capabilities.guardrail_events}
        pageScope={{
          kind: "workspace",
          organizationName: result.scope.organization.name,
          workspaceName: result.workspace.name,
        }}
        policyCapabilities={capabilities.guardrail_policies}
        searchParams={await searchParams}
        view={view ?? []}
        workspaceId={result.workspace.id}
      />
    </>
  )
}
