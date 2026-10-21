import { Suspense } from "react"
import { AdministrationLoadingState } from "@/components/administration"
import { UserDetail } from "../user-detail"

export default function UserAccessPage({
  params,
}: PageProps<"/orgs/[orgSlug]/users/[memberId]/access">) {
  return (
    <Suspense fallback={<AdministrationLoadingState />}>
      <UserDetail params={params} tab="access" />
    </Suspense>
  )
}
