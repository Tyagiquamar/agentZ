import { Suspense } from "react"
import type { Route } from "next"
import {
  AdministrationLoadingState,
  AdministrationPageHeader,
  AdministrationState,
} from "@/components/administration"
import { RouteTabs, type RouteTab } from "@/components/route-tabs"
import { getMemberInvitationOptions } from "@/data/members"
import { CreateInvitationDialog } from "../member-actions"

export default function UserStatesLayout(props: LayoutProps<"/orgs/[orgSlug]/users/status">) {
  return (
    <Suspense fallback={<AdministrationLoadingState />}>
      <UserStates {...props} />
    </Suspense>
  )
}

async function UserStates({ children, params }: LayoutProps<"/orgs/[orgSlug]/users/status">) {
  const { orgSlug } = await params
  const options = await getMemberInvitationOptions(orgSlug)
  if (!options) return <AdministrationState kind="forbidden" />
  const root = `/orgs/${orgSlug}/users/status`
  const tabs = [
    { href: `${root}/active` as Route, label: "Active" },
    { href: `${root}/invited` as Route, label: "Invited" },
    { href: `${root}/disabled` as Route, label: "Disabled" },
  ] satisfies RouteTab[]
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <AdministrationPageHeader
        title="Users"
        actions={
          <CreateInvitationDialog orgSlug={orgSlug} roles={options.roles} teams={options.teams} />
        }
      />
      <div className="px-4 md:px-6">
        <RouteTabs label="User states" tabs={tabs} />
      </div>
      <Suspense fallback={<AdministrationLoadingState />}>{children}</Suspense>
    </div>
  )
}
