import { Suspense } from "react"
import { AdministrationLoadingState } from "@/components/administration"
import { UserDetail } from "../user-detail"

export default function UserActivityPage({
  params,
}: PageProps<"/orgs/[orgSlug]/users/[memberId]/activity">) {
  return (
    <Suspense fallback={<AdministrationLoadingState />}>
      <UserDetail params={params} tab="activity" />
    </Suspense>
  )
}
