import { Suspense } from "react"
import type { Route } from "next"
import { redirect } from "next/navigation"
import { AdministrationLoadingState } from "@/components/administration"
import { searchParamStringSchema } from "@/lib/search-params"
import { UserDetail } from "./user-detail"

export default function UserSummaryPage(props: PageProps<"/orgs/[orgSlug]/users/[memberId]">) {
  return (
    <Suspense fallback={<AdministrationLoadingState />}>
      <Summary {...props} />
    </Suspense>
  )
}

async function Summary({ params, searchParams }: PageProps<"/orgs/[orgSlug]/users/[memberId]">) {
  const [{ orgSlug, memberId }, search] = await Promise.all([params, searchParams])
  const tab = searchParamStringSchema.parse(search.tab)
  if (tab === "access" || tab === "agents" || tab === "keys" || tab === "activity") {
    redirect(`/orgs/${orgSlug}/users/${memberId}/${tab}` as Route)
  }
  return <UserDetail params={params} />
}
