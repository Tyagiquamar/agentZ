"use client"

import * as React from "react"
import { useSelectResource } from "@/components/page-selection"
import { BotIcon, AppWindowIcon, MessageSquareQuote } from "lucide-react"
import { useRouter } from "@bprogress/next/app"
import { usePathname, useSearchParams } from "next/navigation"
import { DateRangePicker } from "@/components/ui/calendar"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { TraceSessionFilterItem } from "@/data/types"
import { dayjs, formatDateParam } from "@/lib/format"
import type { Agent, LensApp } from "@/lib/gateway/client"

type LensFiltersProps = {
  agents: Agent[]
  apps?: LensApp[]
  selectedAppClientID?: string
  from: string
  selectedAgentName?: string
  selectedSessionId?: string
  sessions?: TraceSessionFilterItem[]
  to: string
}

export function LensFilters({
  agents,
  apps = [],
  selectedAppClientID,
  from,
  selectedAgentName,
  selectedSessionId,
  sessions,
  to,
}: LensFiltersProps) {
  const { select, pending: selectionPending } = useSelectResource(true)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = React.useTransition()
  let selectedSubject = selectedAgentName ? `agent:${selectedAgentName}` : ""
  if (selectedAppClientID) selectedSubject = "external-apps"

  function update(values: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams)
    params.delete("page_token")
    params.delete("token_stack")
    for (const [key, value] of Object.entries(values)) {
      if (value) {
        params.set(key, value)
      } else {
        params.delete(key)
      }
    }

    startTransition(() => {
      const query = params.toString()
      router.replace(query === "" ? pathname : `${pathname}?${query}`)
    })
  }

  return (
    <div
      data-pending={pending || selectionPending}
      className="flex min-h-14 flex-col gap-3 border-b bg-background px-4 py-2 data-[pending=true]:opacity-70 sm:flex-row sm:items-center sm:justify-between sm:px-6"
    >
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
        <Select
          value={selectedSubject}
          onValueChange={(value) => {
            if (value === "external-apps") {
              const app = apps[0]
              if (app) select({ app_client_id: app.client_id })
              return
            }
            const agent = agents.find((agent) => `agent:${agent.name}` === value)
            if (agent) select({ agent_name: agent.name })
          }}
          disabled={agents.length + apps.length === 0 || pending || selectionPending}
        >
          <SelectTrigger
            aria-label="Agent or external apps"
            className="h-8 w-full min-w-0 rounded-md sm:w-64 sm:min-w-52"
          >
            <SelectValue placeholder="Agent or external apps" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {agents.map((agent) => (
                <SelectItem key={agent.name} value={`agent:${agent.name}`}>
                  <BotIcon aria-label="Agent" />
                  {agent.name}
                </SelectItem>
              ))}
              {apps.length > 0 ? (
                <SelectItem value="external-apps">
                  <AppWindowIcon aria-hidden="true" />
                  External apps
                </SelectItem>
              ) : null}
            </SelectGroup>
          </SelectContent>
        </Select>
        {selectedAppClientID ? (
          <Select
            value={selectedAppClientID}
            onValueChange={(app_client_id) => select({ app_client_id })}
            disabled={pending || selectionPending}
          >
            <SelectTrigger
              aria-label="External app"
              className="h-8 w-full min-w-0 rounded-md sm:w-72 sm:min-w-52"
            >
              <SelectValue placeholder="External app" className="truncate" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {apps.map((app) => (
                  <SelectItem key={app.client_id} value={app.client_id}>
                    <AppWindowIcon aria-hidden="true" />
                    {app.name}
                    {apps.some(
                      (other) => other.name === app.name && other.client_id !== app.client_id
                    ) ? (
                      <span
                        className="max-w-28 truncate text-xs text-muted-foreground"
                        title={app.client_id}
                      >
                        {app.client_id}
                      </span>
                    ) : null}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : null}
        {sessions && !selectedAppClientID ? (
          <Select
            value={selectedSessionId ?? ""}
            onValueChange={(session_id) => select({ agent_name: selectedAgentName, session_id })}
            disabled={sessions.length === 0 || pending || selectionPending}
          >
            <SelectTrigger
              aria-label="Session"
              className="h-8 w-full min-w-0 rounded-md sm:w-72 sm:min-w-52"
            >
              <SelectValue placeholder="Session" className="truncate" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {sessions.map((session) => (
                  <SelectItem key={session.sessionId} value={session.sessionId}>
                    <MessageSquareQuote className="inline-block" />
                    <span className="block min-w-0 flex-1 truncate">{session.title}</span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : null}
        <DateRangePicker
          className="w-full sm:w-auto"
          onSelect={(range) =>
            update({
              from: formatDateParam(range.from),
              to: formatDateParam(range.to),
            })
          }
          range={{ from: dayjs(from).toDate(), to: dayjs(to).toDate() }}
        />
      </div>
    </div>
  )
}
