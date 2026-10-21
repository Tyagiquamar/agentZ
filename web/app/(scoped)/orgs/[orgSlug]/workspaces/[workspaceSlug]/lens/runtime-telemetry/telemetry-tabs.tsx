"use client"

import type { Route } from "next"
import { useSearchParams } from "next/navigation"
import { RouteTabs, type RouteTab } from "@/components/route-tabs"

export function TelemetryTabs({ basePath }: { basePath: string }) {
  const searchParams = useSearchParams()

  const href = (tab: "process" | "file" | "network"): Route => {
    const next = new URLSearchParams(searchParams.toString())
    next.delete("agent_name")
    next.delete("telemetry_page_token")
    next.delete("telemetry_token_stack")
    const query = next.toString()
    const path = tab === "process" ? basePath : `${basePath}/${tab}`

    if (!query) {
      return path as Route
    }

    return `${path}?${query}` as Route
  }

  const tabs = [
    { href: href("process"), activePath: basePath as Route, label: "Process" },
    { href: href("file"), activePath: `${basePath}/file` as Route, label: "File" },
    { href: href("network"), activePath: `${basePath}/network` as Route, label: "Network" },
  ] satisfies RouteTab[]

  return <RouteTabs label="Runtime telemetry" tabs={tabs} />
}
