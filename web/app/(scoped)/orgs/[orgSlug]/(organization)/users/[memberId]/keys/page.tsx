import { Suspense } from "react"
import { AdministrationLoadingState } from "@/components/administration"
import { UserDetail } from "../user-detail"

export default function UserKeysPage({
  params,
}: PageProps<"/orgs/[orgSlug]/users/[memberId]/keys">) {
  return (
    <Suspense fallback={<AdministrationLoadingState />}>
      <UserDetail params={params} tab="keys" />
    </Suspense>
  )
}
