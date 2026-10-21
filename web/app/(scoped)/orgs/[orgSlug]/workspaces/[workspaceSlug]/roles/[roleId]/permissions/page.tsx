import { RememberRoute, missingRoute } from "@/data/route-memory"
import { AdministrationLoadingState } from "@/components/administration"
import { Suspense } from "react"
import { RoleEditor } from "@/app/(scoped)/orgs/[orgSlug]/(organization)/roles/role-editor"
import { getWorkspaceRoleEditorData } from "@/data/roles"

export const metadata = { title: "Permissions" }

export default function WorkspaceRolePermissionsPage(
  props: PageProps<"/orgs/[orgSlug]/workspaces/[workspaceSlug]/roles/[roleId]/permissions">
) {
  return (
    <Suspense fallback={<AdministrationLoadingState />}>
      <WorkspaceRolePermissionsContent {...props} />
    </Suspense>
  )
}

async function WorkspaceRolePermissionsContent({
  params,
}: PageProps<"/orgs/[orgSlug]/workspaces/[workspaceSlug]/roles/[roleId]/permissions">) {
  const { orgSlug, roleId: encodedRoleId, workspaceSlug } = await params
  const roleId = decodeURIComponent(encodedRoleId)
  const data = await getWorkspaceRoleEditorData(orgSlug, workspaceSlug, roleId)
  if (!data?.role) {
    return missingRoute()
  }

  return (
    <>
      <RememberRoute />
      <RoleEditor key={data.role.updatedAt} data={data} />
    </>
  )
}
