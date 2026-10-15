import { Suspense } from "react"
import { connection } from "next/server"
import {
  AdministrationLoadingState,
  AdministrationPageHeader,
  AdministrationState,
} from "@/components/administration"
import { listExternalAgents } from "@/data/external-agents"
import { ExternalAgents } from "./external-agents"

export const metadata = { title: "External agents" }

export default function ExternalAgentsPage({
  params,
}: {
  params: Promise<{ orgSlug: string; workspaceSlug: string }>
}) {
  return (
    <Suspense fallback={<AdministrationLoadingState />}>
      <ExternalAgentsContent params={params} />
    </Suspense>
  )
}

async function ExternalAgentsContent({
  params,
}: {
  params: Promise<{ orgSlug: string; workspaceSlug: string }>
}) {
  await connection()
  const { orgSlug, workspaceSlug } = await params
  const result = await listExternalAgents(orgSlug, workspaceSlug)
  if (!result)
    return (
      <main className="flex flex-1 flex-col gap-6">
        <AdministrationPageHeader title="External agents" />
        <AdministrationState kind="forbidden" />
      </main>
    )
  return <ExternalAgents orgSlug={orgSlug} workspaceSlug={workspaceSlug} {...result} />
}
