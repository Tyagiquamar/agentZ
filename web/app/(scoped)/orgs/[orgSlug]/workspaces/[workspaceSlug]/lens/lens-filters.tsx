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
import type { LensSubject, TraceSessionFilterItem } from "@/data/types"
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

  const subjects: LensSubject[] = [
    ...agents.map((agent): LensSubject => ({ kind: "agent", name: agent.name })),
    ...apps.map((app): LensSubject => ({ kind: "app", name: app.name, clientID: app.client_id })),
  ]

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
          value={
            selectedAppClientID
              ? `app:${selectedAppClientID}`
              : selectedAgentName
                ? `agent:${selectedAgentName}`
                : ""
          }
          onValueChange={(value) => {
            const subject = subjects.find(
              (subject) =>
                (subject.kind === "app" ? `app:${subject.clientID}` : `agent:${subject.name}`) ===
                value
            )
            if (!subject) return
            select(
              subject.kind === "app"
                ? { app_client_id: subject.clientID }
                : { agent_name: subject.name }
            )
          }}
          disabled={subjects.length === 0 || pending || selectionPending}
        >
          <SelectTrigger
            aria-label="Agent or app"
            className="h-8 w-full min-w-0 rounded-md sm:w-64 sm:min-w-52"
          >
            <SelectValue placeholder="Agent or app" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {subjects.map((subject) => {
                const id =
                  subject.kind === "app" ? `app:${subject.clientID}` : `agent:${subject.name}`
                return (
                  <SelectItem key={id} value={id}>
                    {subject.kind === "app" ? (
                      <AppWindowIcon aria-label="App" />
                    ) : (
                      <BotIcon aria-label="Agent" />
                    )}
                    {subject.name}
                    {subject.kind === "app" &&
                    apps.some(
                      (app) => app.name === subject.name && app.client_id !== subject.clientID
                    ) ? (
                      <span
                        className="max-w-28 truncate text-xs text-muted-foreground"
                        title={subject.clientID}
                      >
                        {subject.clientID}
                      </span>
                    ) : null}
                  </SelectItem>
                )
              })}
            </SelectGroup>
          </SelectContent>
        </Select>
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
