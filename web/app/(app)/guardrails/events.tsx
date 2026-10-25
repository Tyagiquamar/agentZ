"use client"

import Link from "next/link"
import type { ComponentProps } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  Eye,
  ShieldX,
  WandSparkles,
  type LucideIcon,
} from "lucide-react"
import { CopyButton } from "@/components/interior/copy-button"
import { createColumnHelper, getCoreRowModel, useReactTable } from "@tanstack/react-table"
import type { GuardrailEvent, ListGuardrailEventsResponse } from "@/lib/gateway/client"
import { AdminDataGrid } from "@/components/admin-data-grid"
import { AdministrationState } from "@/components/administration"
import { Badge } from "@/components/ui/badge"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { formatTimestamp } from "@/lib/format"
import { GuardrailEventFilters } from "./event-filters"

const column = createColumnHelper<GuardrailEvent>()
const verdicts = {
  allow: { label: "Allowed", icon: CheckCircle2, variant: "success" },
  reject: { label: "Blocked", icon: ShieldX, variant: "destructive" },
  mask: { label: "Masked", icon: WandSparkles, variant: "secondary" },
  audit: { label: "Audit finding", icon: Eye, variant: "secondary" },
  failOpen: { label: "Allowed after error", icon: CircleAlert, variant: "warning" },
} satisfies Record<
  GuardrailEvent["evaluation"]["action"],
  {
    label: string
    icon: LucideIcon
    variant: ComponentProps<typeof Badge>["variant"]
  }
>

export function GuardrailEvents({
  data,
  basePath,
  action,
  referenceId,
}: {
  data: ListGuardrailEventsResponse
  basePath: `/orgs/${string}/guardrails`
  action?: GuardrailEvent["evaluation"]["action"]
  referenceId?: string
}) {
  "use no memo"

  const router = useRouter()
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table is not React Compiler compatible yet.
  const table = useReactTable({
    data: data.events,
    getCoreRowModel: getCoreRowModel(),
    columns: [
      column.accessor("occurred_at", {
        header: "Request time",
        cell: ({ row, getValue }) => (
          <Link
            className="hover:underline"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            href={`${basePath}/events/${encodeURIComponent(row.original.id)}`}
          >
            {formatTimestamp(getValue())}
          </Link>
        ),
      }),
      column.display({
        id: "subject",
        header: "Subject",
        cell: ({ row }) =>
          row.original.agent_name ||
          row.original.client_id ||
          row.original.sandbox_name ||
          "Evaluation",
      }),
      column.accessor("evaluation", {
        id: "outcome",
        header: "Outcome",
        cell: ({ row }) => {
          const verdict = verdicts[row.original.evaluation.action]
          return (
            <Badge variant={verdict.variant}>
              <verdict.icon data-icon="inline-start" />
              {verdict.label}
            </Badge>
          )
        },
      }),
      column.accessor("evaluation", {
        id: "phase",
        header: "Phase",
        cell: ({ getValue }) => (getValue().phase === "request" ? "Input" : "Output"),
      }),
      column.accessor("evaluation", {
        id: "guard",
        header: "Checker",
        cell: ({ getValue }) => getValue().guard,
      }),
      column.accessor("trace_id", {
        header: "Trace",
        cell: ({ getValue }) => (
          <span className="block max-w-36 truncate font-mono text-xs" title={getValue()}>
            {getValue() || "Unavailable"}
          </span>
        ),
      }),
    ],
  })
  const next = new URLSearchParams()
  if (data.next_cursor) next.set("cursor", data.next_cursor)
  if (action) next.set("action", action)
  if (referenceId) next.set("reference_id", referenceId)

  return (
    <>
      <GuardrailEventFilters action={action} referenceId={referenceId} />
      <AdminDataGrid
        ariaLabel="Guardrail evaluations"
        emptyState={
          <AdministrationState
            description="No evaluations match these filters. Events appear after processing."
            kind="empty"
            title="No guardrail events"
          />
        }
        layout={{
          occurred_at: { minWidth: 180 },
          subject: { minWidth: 160 },
          outcome: { minWidth: 120 },
          phase: { minWidth: 80 },
          guard: { minWidth: 160 },
          trace_id: { minWidth: 200 },
        }}
        pagination={
          data.next_cursor ? (
            <div className="flex justify-end px-4">
              <Button asChild variant="outline">
                <Link href={`${basePath}/events?${next.toString()}`}>Next events</Link>
              </Button>
            </div>
          ) : undefined
        }
        onRowActivate={(event) => router.push(`${basePath}/events/${encodeURIComponent(event.id)}`)}
        rowAriaLabel={(event) =>
          `View ${verdicts[event.evaluation.action].label.toLowerCase()} evaluation from ${formatTimestamp(event.occurred_at)}`
        }
        rows={data.events}
        table={table}
      />
    </>
  )
}

export function GuardrailEventDetail({
  event,
  basePath,
}: {
  event: GuardrailEvent
  basePath: `/orgs/${string}/guardrails`
}) {
  const verdict = verdicts[event.evaluation.action]
  const subject = event.agent_name || event.client_id || event.sandbox_name
  const legacy = event.evaluation.agentz
  const metadata = [
    ["Event ID", event.id],
    ["Record format", legacy ? "Historical" : "Native"],
    ["Policy", legacy?.policyId],
    ["Check", legacy?.checkId],
    ["Reference", legacy?.referenceId],
    ["Explanation", legacy?.explanation],
    ["Checker error", legacy?.errorCode],
    ["Historical label", legacy?.safeLabel],
    ["Historical provider reason", legacy ? event.evaluation.actionReason : undefined],
    ["Expires", formatTimestamp(event.expires_at)],
    ["Organization ID", event.organization_id],
    ["Workspace ID", event.workspace_id],
    ["Agent", event.agent_name],
    ["Application client", event.client_id],
    ["Sandbox", event.sandbox_name],
    ["Session", event.session_id],
    ["Trace", event.trace_id],
    ["Span", event.span_id],
    ["Applied revision", event.revision],
    ["Detector", event.evaluation.guard],
    ["Provider guardrail ID", event.evaluation.guardrailId],
    ["Provider version", event.evaluation.guardrailVersion],
  ]
  return (
    <div className="flex w-full max-w-4xl flex-col gap-5 px-4 pb-6 md:px-6">
      <Button asChild className="self-start" size="sm" variant="ghost">
        <Link href={`${basePath}/events`}>
          <ArrowLeft data-icon="inline-start" />
          All events
        </Link>
      </Button>
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={verdict.variant}>
            <verdict.icon data-icon="inline-start" />
            {verdict.label}
          </Badge>
          <Badge variant="outline">
            {event.evaluation.phase === "request" ? "Input" : "Output"}
          </Badge>
        </div>
        <h2 className="text-lg font-medium break-words">{event.evaluation.guard}</h2>
        <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
          {subject ? (
            <div>
              <dt className="text-xs text-muted-foreground">Workload</dt>
              <dd className="mt-1 break-all">{subject}</dd>
            </div>
          ) : null}
          {event.model ? (
            <div>
              <dt className="text-xs text-muted-foreground">Model</dt>
              <dd className="mt-1 break-all">{event.model}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs text-muted-foreground">Request time</dt>
            <dd className="mt-1">{formatTimestamp(event.occurred_at)}</dd>
          </div>
        </dl>
        {event.trace_id ? (
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-xs text-muted-foreground">Trace</span>
            <code className="truncate text-xs" title={event.trace_id}>
              {event.trace_id}
            </code>
            <CopyButton content={event.trace_id} label="Copy trace ID" />
          </div>
        ) : null}
      </section>
      <Accordion type="multiple">
        {legacy?.inspected?.length ? (
          <AccordionItem value="historical-content">
            <AccordionTrigger>Historical inspected content</AccordionTrigger>
            <AccordionContent>
              {legacy.inspected.map((content, index) => (
                <pre className="mb-3 text-xs break-words whitespace-pre-wrap" key={index}>
                  {content}
                </pre>
              ))}
            </AccordionContent>
          </AccordionItem>
        ) : null}
        <AccordionItem value="technical">
          <AccordionTrigger>Technical details</AccordionTrigger>
          <AccordionContent>
            <dl className="flex flex-col gap-3">
              {metadata
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div
                    className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4"
                    key={label}
                  >
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="min-w-0 break-all">{value}</dd>
                  </div>
                ))}
            </dl>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}
