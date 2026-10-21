import { Suspense } from "react"
import { AdministrationLoadingState, AdministrationPageHeader } from "@/components/administration"
import { TelemetryTabs } from "./telemetry-tabs"

export default function RuntimeTelemetryLayout(
  props: LayoutProps<"/orgs/[orgSlug]/workspaces/[workspaceSlug]/lens/runtime-telemetry">
) {
  return (
    <Suspense fallback={<AdministrationLoadingState />}>
      <RuntimeTelemetry {...props} />
    </Suspense>
  )
}

async function RuntimeTelemetry({
  children,
  params,
}: LayoutProps<"/orgs/[orgSlug]/workspaces/[workspaceSlug]/lens/runtime-telemetry">) {
  const { orgSlug, workspaceSlug } = await params
  const basePath = `/orgs/${orgSlug}/workspaces/${workspaceSlug}/lens/runtime-telemetry`
  return (
    <main className="flex min-w-0 flex-1 flex-col gap-6 p-0">
      <AdministrationPageHeader title="Runtime Telemetry" />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b px-4 py-2 sm:px-6">
          <TelemetryTabs basePath={basePath} />
        </div>
        <Suspense fallback={<AdministrationLoadingState />}>{children}</Suspense>
      </div>
    </main>
  )
}
