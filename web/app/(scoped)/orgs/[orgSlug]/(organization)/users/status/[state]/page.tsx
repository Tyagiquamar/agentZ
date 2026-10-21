import { searchParamStringSchema } from "@/lib/search-params"
import { Suspense } from "react"
import { RememberRoute, missingRoute } from "@/data/route-memory"
import { AdministrationLoadingState, AdministrationState } from "@/components/administration"
import { getMemberDirectory } from "@/data/members"
import { UserDirectoryTable } from "../../user-directory-table"

export const metadata = { title: "Users" }

export default function UserStatePage(props: PageProps<"/orgs/[orgSlug]/users/status/[state]">) {
  return (
    <Suspense fallback={<AdministrationLoadingState />}>
      <UserStateContent {...props} />
    </Suspense>
  )
}

async function UserStateContent({
  params,
  searchParams,
}: PageProps<"/orgs/[orgSlug]/users/status/[state]">) {
  const [{ orgSlug, state }, { page_token }] = await Promise.all([params, searchParams])
  if (state !== "active" && state !== "invited" && state !== "disabled") {
    return missingRoute()
  }

  const data = await getMemberDirectory(orgSlug, {
    pageToken: searchParamStringSchema.parse(page_token),
    tab: state,
  })
  if (!data) return <AdministrationState kind="forbidden" />

  return (
    <>
      <RememberRoute />
      <UserDirectoryTable data={data} orgSlug={orgSlug} tab={state} />
    </>
  )
}
