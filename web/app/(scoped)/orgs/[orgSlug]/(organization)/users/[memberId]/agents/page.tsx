import { Suspense } from "react"
import { AdministrationLoadingState } from "@/components/administration"
import { UserDetail } from "../user-detail"

export default function UserAgentsPage({
  params,
}: PageProps<"/orgs/[orgSlug]/users/[memberId]/agents">) {
  return (
    <Suspense fallback={<AdministrationLoadingState />}>
      <UserDetail params={params} tab="agents" />
    </Suspense>
  )
}
