import { Suspense } from "react"
import type { Metadata, Route } from "next"
import { missingRoute } from "@/data/route-memory"
import { AdministrationLoadingState, AdministrationState } from "@/components/administration"
import { RouteTabs, type RouteTab } from "@/components/route-tabs"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { getMemberAdministration } from "@/data/members"

export async function generateMetadata({
  params,
}: LayoutProps<"/orgs/[orgSlug]/users/[memberId]">): Promise<Metadata> {
  const { memberId, orgSlug } = await params
  const data = await getMemberAdministration(orgSlug, memberId)
  return {
    title: {
      absolute: data ? `${data.member.name} - User | AgentZ` : "User | AgentZ",
    },
  }
}

export default function UserLayout(props: LayoutProps<"/orgs/[orgSlug]/users/[memberId]">) {
  return (
    <Suspense fallback={<AdministrationLoadingState />}>
      <UserContent {...props} />
    </Suspense>
  )
}

async function UserContent({ children, params }: LayoutProps<"/orgs/[orgSlug]/users/[memberId]">) {
  const { memberId, orgSlug } = await params
  const data = await getMemberAdministration(orgSlug, memberId)
  if (data === undefined) return <AdministrationState kind="forbidden" />
  if (data === null) return missingRoute()
  const root = `/orgs/${orgSlug}/users/${memberId}`
  const tabs = [
    { href: root as Route, label: "Summary" },
    { href: `${root}/access` as Route, label: "Roles and access" },
    { href: `${root}/agents` as Route, label: `Owned Agents (${data.agents.length})` },
    { href: `${root}/keys` as Route, label: `API keys (${data.apiKeys.length})` },
    { href: `${root}/activity` as Route, label: "Activity" },
  ] satisfies RouteTab[]
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex min-w-0 flex-col gap-4 px-4 pt-4 md:px-6 md:pt-6">
        <div className="flex flex-wrap items-start gap-2">
          <SidebarTrigger className="mt-0.5 shrink-0" />
          <div className="flex min-w-0 items-center gap-3">
            <Avatar>
              <AvatarImage alt="" src={data.member.image ?? undefined} />
              <AvatarFallback>{data.member.name.slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1
                  className="truncate text-2xl font-semibold tracking-normal"
                  title={data.member.name}
                >
                  {data.member.name}
                </h1>
                <Badge variant={data.member.disabledAt ? "destructivePlain" : "successPlain"}>
                  {data.member.disabledAt ? "Disabled" : "Active"}
                </Badge>
                {data.member.superadmin ? <Badge variant="plain">Superadmin</Badge> : null}
              </div>
              <p className="mt-1 truncate text-sm text-muted-foreground" title={data.member.email}>
                {data.member.email}
              </p>
            </div>
          </div>
        </div>
        <RouteTabs label="User details" tabs={tabs} />
      </header>
      <Suspense fallback={<AdministrationLoadingState />}>{children}</Suspense>
    </div>
  )
}
