"use client"

import * as React from "react"
import Image from "next/image"
import { ClaudeAI, CodexLight } from "@ridemountainpig/svgl-react"
import { useSelectResource } from "@/components/page-selection"
import { AppWindowIcon, CheckIcon, ChevronsUpDownIcon } from "lucide-react"
import { useRouter } from "@bprogress/next/app"
import { usePathname, useSearchParams } from "next/navigation"
import { DateRangePicker } from "@/components/ui/calendar"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { listAppSessionsAction } from "@/data/lens.actions"
import type { TraceSessionFilterItem } from "@/data/types"
import { dayjs, formatDateParam } from "@/lib/format"
import type { Agent, LensApp } from "@/lib/gateway/client"

type SourceIconKind = "agent" | "app" | NonNullable<LensApp["agent_kind"]>

export function LensSourceIcon({
  kind,
  className = "size-4 shrink-0",
}: {
  kind: SourceIconKind
  className?: string
}) {
  switch (kind) {
    case "agent":
      return (
        <Image
          src="/agentz-logo.svg"
          width={16}
          height={16}
          alt=""
          aria-hidden="true"
          className={className}
        />
      )
    case "claude":
      return <ClaudeAI aria-hidden="true" className={className} />
    case "codex":
      return <CodexLight aria-hidden="true" fill="currentColor" className={className} />
    case "app":
      return <AppWindowIcon aria-hidden="true" className={className} />
  }
}

type LensFiltersProps = {
  agents: Agent[]
  apps?: LensApp[]
  selectedAppClientID?: string
  defaultAppClientID?: string
  from: string
  selectedAgentName?: string
  selectedSessionId?: string
  sessions?: TraceSessionFilterItem[]
  sessionNextPageToken?: string
  workspaceId: string
  to: string
}

export function LensFilters({
  agents,
  apps: appOptions,
  selectedAppClientID,
  defaultAppClientID,
  from,
  selectedAgentName,
  selectedSessionId,
  sessions,
  sessionNextPageToken,
  workspaceId,
  to,
}: LensFiltersProps) {
  const { select, pending: selectionPending } = useSelectResource(true)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = React.useTransition()
  const apps = appOptions ?? []
  const ordinaryApps = apps.filter((app) => !app.agent_kind)
  const externalAgents = apps
    .flatMap((app) => (app.agent_kind ? [{ ...app, agent_kind: app.agent_kind }] : []))
    .toSorted((a, b) => a.name.localeCompare(b.name) || a.client_id.localeCompare(b.client_id))
  const selectedApp = apps.find((app) => app.client_id === selectedAppClientID)
  const iconKind = selectedApp?.agent_kind ?? (selectedAgentName ? "agent" : "app")
  let selectedSubject = "external-apps"
  if (selectedAgentName) selectedSubject = `agent:${selectedAgentName}`
  if (selectedApp?.agent_kind) selectedSubject = `external-agent:${selectedApp.client_id}`
  const disabled = pending || selectionPending

  function updateDate(values: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams)
    params.delete("page_token")
    params.delete("token_stack")
    for (const [key, value] of Object.entries(values)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    startTransition(() => {
      const query = params.toString()
      router.replace(query === "" ? pathname : `${pathname}?${query}`)
    })
  }

  return (
    <div
      data-pending={disabled}
      className="flex min-h-14 flex-col gap-3 border-b bg-background px-4 py-2 data-[pending=true]:opacity-70 sm:flex-row sm:items-center sm:justify-between sm:px-6"
    >
      <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
        <Select
          value={selectedSubject}
          onValueChange={(value) => {
            if (value === "external-apps") {
              const app =
                ordinaryApps.find((app) => app.client_id === defaultAppClientID) ?? ordinaryApps[0]
              if (app) select({ app_client_id: app.client_id })
              return
            }
            const agent = agents.find((agent) => `agent:${agent.name}` === value)
            if (agent) {
              select({ agent_name: agent.name })
              return
            }
            const external = externalAgents.find(
              (app) => `external-agent:${app.client_id}` === value
            )
            if (external) select({ app_client_id: external.client_id })
          }}
          disabled={agents.length + apps.length === 0 || disabled}
        >
          <SelectTrigger
            aria-label="Agent or external apps"
            className="h-8 w-full min-w-0 rounded-md sm:w-64"
          >
            <SelectValue placeholder="Agent or external apps" />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectGroup>
              {appOptions ? (
                <SelectItem
                  value="external-apps"
                  disabled={ordinaryApps.length === 0 && agents.length + externalAgents.length > 0}
                >
                  <LensSourceIcon kind="app" />
                  External apps
                </SelectItem>
              ) : null}
              {agents.map((agent) => (
                <SelectItem key={agent.name} value={`agent:${agent.name}`}>
                  <LensSourceIcon kind="agent" />
                  {agent.name}
                </SelectItem>
              ))}
              {externalAgents.map((app) => (
                <SelectItem key={app.client_id} value={`external-agent:${app.client_id}`}>
                  <LensSourceIcon kind={app.agent_kind} />
                  {app.name}
                  {agents.some((agent) => agent.name === app.name) ||
                  externalAgents.some(
                    (other) => other.client_id !== app.client_id && other.name === app.name
                  ) ? (
                    <span
                      className="max-w-28 truncate text-xs text-muted-foreground"
                      title={app.client_id}
                    >
                      {app.client_id.slice(-8)}
                    </span>
                  ) : null}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {selectedSubject === "external-apps" ? (
          <Select
            value={selectedAppClientID ?? ""}
            onValueChange={(app_client_id) => select({ app_client_id })}
            disabled={ordinaryApps.length === 0 || disabled}
          >
            <SelectTrigger
              aria-label="External app"
              className="h-8 w-full min-w-0 rounded-md sm:w-72"
            >
              <SelectValue placeholder="External app" className="truncate" />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectGroup>
                {ordinaryApps.map((app) => (
                  <SelectItem key={app.client_id} value={app.client_id}>
                    <LensSourceIcon kind="app" />
                    {app.name}
                    {ordinaryApps.some(
                      (other) => other.name === app.name && other.client_id !== app.client_id
                    ) ? (
                      <span
                        className="max-w-28 truncate text-xs text-muted-foreground"
                        title={app.client_id}
                      >
                        {app.client_id.slice(-8)}
                      </span>
                    ) : null}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : sessions ? (
          <LensSessionPicker
            key={JSON.stringify([
              workspaceId,
              selectedSubject,
              selectedSessionId,
              sessions,
              sessionNextPageToken,
            ])}
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            kind={iconKind}
            disabled={disabled}
            nextPageToken={sessionNextPageToken}
            clientID={selectedApp?.agent_kind ? selectedApp.client_id : undefined}
            workspaceId={workspaceId}
            onSelect={(session_id) =>
              select({
                agent_name: selectedAgentName,
                app_client_id: selectedAppClientID,
                session_id,
              })
            }
          />
        ) : null}
        <DateRangePicker
          className="w-full sm:w-auto"
          onSelect={(range) =>
            updateDate({ from: formatDateParam(range.from), to: formatDateParam(range.to) })
          }
          range={{ from: dayjs(from).toDate(), to: dayjs(to).toDate() }}
        />
      </div>
    </div>
  )
}

function LensSessionPicker({
  sessions,
  selectedSessionId,
  kind,
  disabled,
  nextPageToken,
  clientID,
  workspaceId,
  onSelect,
}: {
  sessions: TraceSessionFilterItem[]
  selectedSessionId?: string
  kind: SourceIconKind
  disabled: boolean
  nextPageToken?: string
  clientID?: string
  workspaceId: string
  onSelect: (sessionId: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [items, setItems] = React.useState(sessions)
  const [next, setNext] = React.useState(nextPageToken)
  const [loading, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string>()
  const selected = items.find((session) => session.sessionId === selectedSessionId)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-label="Session"
          aria-expanded={open}
          disabled={disabled || items.length === 0}
          className="h-8 w-full min-w-0 justify-between rounded-md sm:w-72"
        >
          <span className="flex min-w-0 items-center gap-2">
            <LensSourceIcon kind={kind} />
            <span className="truncate" title={selected?.sessionId}>
              {selected?.title ?? "Session"}
            </span>
          </span>
          <ChevronsUpDownIcon aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder="Find a session" />
          <CommandList>
            <CommandEmpty>No matching sessions</CommandEmpty>
            <CommandGroup>
              {items.map((session) => (
                <CommandItem
                  key={session.sessionId}
                  value={session.sessionId}
                  keywords={[session.title]}
                  aria-selected={session.sessionId === selectedSessionId}
                  onSelect={() => {
                    onSelect(session.sessionId)
                    setOpen(false)
                  }}
                >
                  <LensSourceIcon kind={kind} />
                  <span className="min-w-0 flex-1 truncate" title={session.sessionId}>
                    {session.title}
                  </span>
                  {session.sessionId === selectedSessionId ? (
                    <CheckIcon aria-hidden="true" />
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {error ? (
            <p role="alert" className="px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {next && clientID ? (
            <Button
              variant="ghost"
              disabled={loading}
              onClick={() =>
                startTransition(async () => {
                  setError(undefined)
                  const result = await listAppSessionsAction(clientID, workspaceId, {
                    limit: 50,
                    page_token: next,
                  })
                  if (result.error) {
                    setError(result.error.message)
                    return
                  }
                  setItems((current) => [
                    ...current,
                    ...result.data.sessions
                      .filter(
                        (session) => !current.some((item) => item.sessionId === session.session_id)
                      )
                      .map((session) => ({
                        sessionId: session.session_id,
                        title: session.session_id,
                      })),
                  ])
                  setNext(result.data.next_page_token)
                })
              }
            >
              {loading ? "Loading sessions" : "Load more sessions"}
            </Button>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  )
}
