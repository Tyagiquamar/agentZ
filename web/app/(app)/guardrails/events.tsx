"use client"

import Link from "next/link"
import { useId, useState, type ComponentProps } from "react"
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatTimestamp } from "@/lib/format"

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
  action?: string
  referenceId?: string
}) {
  "use no memo"

  const router = useRouter()
  const idPrefix = useId()
  const [filter, setFilter] = useState(action ?? "all")
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table is not React Compiler compatible yet.
  const table = useReactTable({
    data: data.events,
    getCoreRowModel: getCoreRowModel(),
    columns: [
      column.accessor("occurred_at", {
        header: "Time",
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
        id: "policy",
        header: "Check",
        cell: ({ getValue }) => (
          <div className="flex flex-col gap-1">
            <span>{getValue().agentz?.safeLabel || getValue().guard}</span>
            {getValue().agentz?.errorCode ? (
              <span className="text-xs text-muted-foreground">Checker error</span>
            ) : null}
          </div>
        ),
      }),
      column.accessor("evaluation", {
        id: "reference",
        header: "Reference",
        cell: ({ row, getValue }) => (
          <Link
            className="font-mono text-xs hover:underline"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            href={`${basePath}/events/${encodeURIComponent(row.original.id)}`}
          >
            <span
              className="block max-w-36 truncate"
              title={getValue().agentz?.referenceId || row.original.id}
            >
              {getValue().agentz?.referenceId || row.original.id}
            </span>
          </Link>
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
      <form action={`${basePath}/events`} className="px-4 md:px-6">
        <FieldGroup className="flex-row flex-wrap items-end">
          <Field className="max-w-56">
            <FieldLabel htmlFor={`${idPrefix}-guardrail-event-action`}>Outcome</FieldLabel>
            <Select name="action" onValueChange={setFilter} value={filter}>
              <SelectTrigger className="w-full" id={`${idPrefix}-guardrail-event-action`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">All outcomes</SelectItem>
                  <SelectItem value="reject">Blocked</SelectItem>
                  <SelectItem value="mask">Masked</SelectItem>
                  <SelectItem value="audit">Audit finding</SelectItem>
                  <SelectItem value="failOpen">Allowed after checker error</SelectItem>
                  <SelectItem value="allow">Allowed</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field className="max-w-sm">
            <FieldLabel htmlFor={`${idPrefix}-guardrail-event-reference`}>Reference ID</FieldLabel>
            <Input
              defaultValue={referenceId}
              id={`${idPrefix}-guardrail-event-reference`}
              name="reference_id"
              placeholder="Find a reported block"
            />
          </Field>
          <Button type="submit" variant="outline">
            Apply filters
          </Button>
        </FieldGroup>
      </form>
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
          policy: { minWidth: 200 },
          reference: { minWidth: 200 },
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
  const context = event.evaluation.agentz
  const reference = context?.referenceId || event.id
  const explanation = context?.errorCode
    ? event.evaluation.action === "reject"
      ? "The checker could not complete. The request was blocked."
      : "The checker could not complete. The request was allowed under the configured audit or failure handling."
    : event.evaluation.action === "allow"
      ? "The check allowed this content."
      : context?.explanation ||
        event.evaluation.actionReason ||
        "No additional explanation was recorded."
  const verdict = verdicts[event.evaluation.action]
  const subject = event.agent_name || event.client_id || event.sandbox_name
  const metadata = [
    ["Event ID", event.id],
    ["Expires", formatTimestamp(event.expires_at)],
    ["Organization ID", event.organization_id],
    ["Workspace ID", event.workspace_id],
    ["Agent", event.agent_name],
    ["Application client", event.client_id],
    ["Sandbox", event.sandbox_name],
    ["Session", event.session_id],
    ["Trace", event.trace_id],
    ["Policy ID", context?.policyId],
    ["Check ID", context?.checkId],
    ["Revision", context?.revision],
    ["Connection ID", context?.connectionId],
    ["Attachment", context?.attachment],
    ["Required", context ? (context.mandatory ? "Yes" : "No") : undefined],
    ["Detector", event.evaluation.guard],
    ["Provider guardrail ID", event.evaluation.guardrailId],
    ["Provider version", event.evaluation.guardrailVersion],
    ["Inspected scopes", context?.scopes.join(", ")],
    ["Duration", context ? `${context.durationMs.toFixed(2)} ms` : "Unavailable"],
    ["Checker error", context?.errorCode],
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
          {context?.mandatory ? <Badge variant="secondary">Required policy</Badge> : null}
          {context?.validationPass === "mandatoryFinal" ? (
            <Badge variant="secondary">Rechecked after masking</Badge>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-lg font-medium break-words">
            {context?.safeLabel || event.evaluation.guard}
          </h2>
          <p className="text-sm text-muted-foreground">{explanation}</p>
        </div>
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
            <dt className="text-xs text-muted-foreground">Evaluated</dt>
            <dd className="mt-1">{formatTimestamp(event.occurred_at)}</dd>
          </div>
        </dl>
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xs text-muted-foreground">Reference</span>
          <code className="truncate text-xs" title={reference}>
            {reference}
          </code>
          <CopyButton content={reference} label="Copy reference ID" />
        </div>
      </section>
      <section className="flex flex-col gap-3 border-t border-dotted pt-5">
        <div className="flex flex-col gap-1.5">
          <h3 className="text-sm font-medium">Captured content</h3>
          <p className="text-sm text-muted-foreground">
            {context?.inspected?.length
              ? "Content retained with this evaluation under the configured capture permissions."
              : "No inspected content was captured for this evaluation."}
          </p>
        </div>
        {context?.inspected?.length || context?.replacement?.length ? (
          <Accordion type="multiple">
            {[
              { key: "inspected", label: "Inspected content", content: context.inspected },
              { key: "replacement", label: "Replacement content", content: context.replacement },
            ].map(({ key, label, content }) =>
              content?.length ? (
                <AccordionItem key={key} value={key}>
                  <AccordionTrigger>
                    {label} ({content.length})
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="flex flex-col gap-3">
                      {content.map((text, index) => (
                        <pre
                          className="max-h-96 overflow-auto rounded-sm bg-muted/30 p-3 text-xs whitespace-pre-wrap"
                          key={index}
                        >
                          {text}
                        </pre>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ) : null
            )}
          </Accordion>
        ) : null}
      </section>
      <Accordion type="multiple">
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
        {event.evaluation.assessments?.length ? (
          <AccordionItem value="assessment">
            <AccordionTrigger>Provider assessment</AccordionTrigger>
            <AccordionContent>
              <pre className="max-h-96 overflow-auto rounded-sm bg-muted/30 p-3 text-xs whitespace-pre-wrap">
                {JSON.stringify(event.evaluation.assessments, null, 2)}
              </pre>
            </AccordionContent>
          </AccordionItem>
        ) : null}
      </Accordion>
    </div>
  )
}
