"use client"

import Link from "next/link"
import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { createColumnHelper, getCoreRowModel, useReactTable } from "@tanstack/react-table"
import {
  Cable,
  CheckCircle2,
  CircleDashed,
  Eye,
  LockKeyhole,
  MoreHorizontal,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  XCircle,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { GuardrailConnection, GuardrailPolicy, GuardrailStatus } from "@/lib/gateway/client"
import {
  deleteGuardrailConnectionAction,
  deleteGuardrailPolicyAction,
  type GuardrailActionScope,
} from "@/data/guardrail.actions"
import { AdminDataGrid } from "@/components/admin-data-grid"
import { AdministrationState } from "@/components/administration"
import { HoldToConfirm } from "@/components/interior/hold-to-confirm"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ConnectionSheet } from "./connection-sheet"

const policyColumn = createColumnHelper<GuardrailPolicy>()
const connectionColumn = createColumnHelper<GuardrailConnection>()
const statusMeta = {
  Pending: { icon: CircleDashed, label: "Applying", className: "text-warning" },
  Ready: { icon: CheckCircle2, label: "Configured", className: "text-success" },
  Error: { icon: XCircle, label: "Error", className: "text-destructive" },
} satisfies Record<
  GuardrailStatus["state"],
  {
    icon: LucideIcon
    label: string
    className: string
  }
>

export function NewGuardrailConnectionButton({ scope }: { scope: GuardrailActionScope }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)} type="button">
        <Plus />
        New connection
      </Button>
      {open ? <ConnectionSheet scope={scope} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

export function GuardrailPolicyList({
  policies,
  scope,
  basePath,
}: {
  policies: GuardrailPolicy[]
  scope: GuardrailActionScope
  basePath: `/orgs/${string}/guardrails`
}) {
  "use no memo"
  const router = useRouter()
  const [deleting, setDeleting] = useState<GuardrailPolicy>()
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table is not React Compiler compatible yet.
  const table = useReactTable({
    data: policies,
    getCoreRowModel: getCoreRowModel(),
    columns: [
      policyColumn.accessor("displayName", {
        header: "Name",
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-3 py-1">
            <ShieldCheck aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{row.original.displayName}</span>
                {row.original.mandatory ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                    <LockKeyhole aria-hidden className="size-3" /> Required
                  </span>
                ) : null}
              </div>
              {row.original.description ? (
                <span className="truncate text-xs text-muted-foreground">
                  {row.original.description}
                </span>
              ) : null}
              {scope.workspaceId !== undefined && row.original.scope === "Organisation" ? (
                <span className="text-xs text-muted-foreground">Organization</span>
              ) : null}
            </div>
          </div>
        ),
      }),
      policyColumn.accessor("checks", {
        header: "Checks",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground tabular-nums">
            {row.original.checks.filter((check) => check.phase === "input").length} input ·{" "}
            {row.original.checks.filter((check) => check.phase === "output").length} output
          </span>
        ),
      }),
      policyColumn.accessor("status", {
        header: "Status",
        cell: ({ getValue }) => <GuardrailStatusLabel status={getValue()} />,
      }),
      policyColumn.display({
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div
            className="flex justify-end"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={`Actions for ${row.original.displayName}`}
                  className="size-8"
                  size="icon"
                  variant="ghost"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem asChild>
                    <Link
                      href={`${basePath}/policies/${encodeURIComponent(row.original.name)}?scope=${row.original.scope}`}
                    >
                      {row.original.canModify ? <Pencil /> : <Eye />}
                      {row.original.canModify ? "Edit" : "View"}
                    </Link>
                  </DropdownMenuItem>
                  {row.original.canDelete ? (
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => setDeleting(row.original)}
                    >
                      <Trash2 />
                      Delete
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      }),
    ],
  })
  return (
    <>
      <AdminDataGrid
        ariaLabel="Guardrail policies"
        emptyState={
          <AdministrationState
            description="Start with a regex check or a provider connection. Assign policies to the workloads you want to protect."
            kind="empty"
            title="No guardrail policies"
          />
        }
        layout={{
          displayName: { minWidth: 280, contentMaxWidth: 480 },
          checks: { minWidth: 140 },
          status: { minWidth: 128, width: 128 },
          actions: { minWidth: 64, width: 64, align: "end" },
        }}
        rowAriaLabel={(policy) => `View ${policy.displayName}`}
        onRowActivate={(policy) =>
          router.push(
            `${basePath}/policies/${encodeURIComponent(policy.name)}?scope=${policy.scope}`
          )
        }
        rows={policies}
        table={table}
      />
      {deleting ? (
        <DeleteGuardrail
          name={deleting.name}
          label={deleting.displayName}
          kind="policy"
          scope={scope}
          onClose={() => setDeleting(undefined)}
        />
      ) : null}
    </>
  )
}

export function GuardrailConnectionList({
  connections,
  scope,
}: {
  connections: GuardrailConnection[]
  scope: GuardrailActionScope
}) {
  "use no memo"
  const [editing, setEditing] = useState<GuardrailConnection>()
  const [deleting, setDeleting] = useState<GuardrailConnection>()
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table is not React Compiler compatible yet.
  const table = useReactTable({
    data: connections,
    getCoreRowModel: getCoreRowModel(),
    columns: [
      connectionColumn.accessor("displayName", {
        header: "Name",
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-3 py-1">
            <Cable aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="truncate font-medium">{row.original.displayName}</span>
              {row.original.description ? (
                <span className="truncate text-xs text-muted-foreground">
                  {row.original.description}
                </span>
              ) : null}
              {scope.workspaceId !== undefined && row.original.scope === "Organisation" ? (
                <span className="text-xs text-muted-foreground">Organization</span>
              ) : null}
            </div>
          </div>
        ),
      }),
      connectionColumn.accessor("provider", {
        header: "Service",
        cell: ({ row }) =>
          ({
            OpenAI: "OpenAI moderation",
            Bedrock: "AWS Bedrock",
            ModelArmor: "Google Model Armor",
            Webhook: "Custom webhook",
          })[row.original.provider],
      }),
      connectionColumn.accessor("status", {
        header: "Status",
        cell: ({ getValue }) => <GuardrailStatusLabel status={getValue()} />,
      }),
      connectionColumn.display({
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div
            className="flex justify-end"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={`Actions for ${row.original.displayName}`}
                  className="size-8"
                  size="icon"
                  variant="ghost"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={() => setEditing(row.original)}>
                    {row.original.canModify ? <Pencil /> : <Eye />}
                    {row.original.canModify ? "Edit" : "View"}
                  </DropdownMenuItem>
                  {row.original.canDelete ? (
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => setDeleting(row.original)}
                    >
                      <Trash2 />
                      Delete
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      }),
    ],
  })
  return (
    <>
      <AdminDataGrid
        ariaLabel="Guardrail connections"
        emptyState={
          <AdministrationState
            description="Use OpenAI moderation, Bedrock Guardrails, Google Model Armor, or a service implementing the AgentGateway guardrail webhook."
            kind="empty"
            title="No connections"
          />
        }
        layout={{
          displayName: { minWidth: 240, contentMaxWidth: 360 },
          provider: { minWidth: 160 },
          status: { minWidth: 128, width: 128 },
          actions: { minWidth: 64, width: 64, align: "end" },
        }}
        onRowActivate={setEditing}
        rowAriaLabel={(connection) => `View ${connection.displayName}`}
        rows={connections}
        table={table}
      />
      {editing ? (
        <ConnectionSheet connection={editing} scope={scope} onClose={() => setEditing(undefined)} />
      ) : null}
      {deleting ? (
        <DeleteGuardrail
          name={deleting.name}
          label={deleting.displayName}
          kind="connection"
          scope={scope}
          onClose={() => setDeleting(undefined)}
        />
      ) : null}
    </>
  )
}

function GuardrailStatusLabel({ status }: { status: GuardrailStatus }) {
  const meta = statusMeta[status.state]
  const message = status.message.trim()
  const label = (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
      tabIndex={message ? 0 : undefined}
    >
      <meta.icon aria-hidden className={cn("size-3.5", meta.className)} />
      {meta.label}
    </span>
  )
  if (!message) return label
  return (
    <Tooltip>
      <TooltipTrigger asChild>{label}</TooltipTrigger>
      <TooltipContent>{message}</TooltipContent>
    </Tooltip>
  )
}

function DeleteGuardrail({
  kind,
  name,
  label,
  scope,
  onClose,
}: {
  kind: "connection" | "policy"
  name: string
  label: string
  scope: GuardrailActionScope
  onClose: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState("")
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader className="min-w-0">
          <DialogTitle className="pr-6 leading-snug break-words">Delete {label}?</DialogTitle>
          <DialogDescription>
            Referenced {kind === "connection" ? "connections" : "policies"} cannot be deleted.
            Remove their assignments or references first. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Could not delete {kind}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button disabled={pending} onClick={onClose} type="button" variant="outline">
            Cancel
          </Button>
          <HoldToConfirm
            pending={pending}
            onConfirm={() =>
              startTransition(async () => {
                const result =
                  kind === "connection"
                    ? await deleteGuardrailConnectionAction(scope, name)
                    : await deleteGuardrailPolicyAction(scope, name)
                if (result.error) {
                  setError(result.error.message)
                  return
                }
                toast.success(`${kind === "connection" ? "Connection" : "Policy"} deleted`)
                router.refresh()
                onClose()
              })
            }
            type="button"
            variant="destructive"
          >
            <Trash2 data-icon="inline-start" />
            Hold to delete
          </HoldToConfirm>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function GuardrailRolloutRefresh({ pending }: { pending: boolean }) {
  const router = useRouter()
  useEffect(() => {
    if (!pending) return
    const interval = window.setInterval(() => router.refresh(), 3000)
    return () => window.clearInterval(interval)
  }, [pending, router])
  return pending ? (
    <p className="px-4 text-sm text-muted-foreground md:px-6" role="status">
      Applying configuration. Status updates automatically.
    </p>
  ) : null
}
