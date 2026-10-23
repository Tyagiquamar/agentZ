"use client"

import { useId, useState, useTransition } from "react"
import { flushSync } from "react-dom"
import { useRouter } from "next/navigation"
import { Cable, ChevronDown, FlaskConical, Plus, Regex, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import type {
  GuardrailCheck,
  GuardrailConnection,
  GuardrailPolicy,
  GuardrailPolicyInput,
} from "@/lib/gateway/client"
import { saveGuardrailPolicyAction, type GuardrailActionScope } from "@/data/guardrail.actions"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { CopyButton } from "@/components/interior/copy-button"
import { LoadingButton } from "@/components/interior/loading-button"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ConnectionSheet } from "./connection-sheet"
import { GuardrailPlayground } from "./playground"
import { CheckEditor } from "./check-editor"

export function PolicyEditor({
  policy,
  connections: initialConnections,
  scope,
  basePath,
  canCreateConnection,
  onSaved,
  onCancel,
}: {
  policy?: GuardrailPolicy
  connections: GuardrailConnection[]
  scope: GuardrailActionScope
  basePath?: `/orgs/${string}/guardrails`
  onSaved?: (policy: GuardrailPolicy) => void
  onCancel?: () => void
  canCreateConnection: boolean
}) {
  const id = useId()
  const router = useRouter()
  const [draft, setDraft] = useState<GuardrailPolicyInput>(() => ({
    name: policy?.name ?? "",
    displayName: policy?.displayName ?? "",
    description: policy?.description ?? "",
    checks: policy?.checks ?? [],
  }))
  const [connections, setConnections] = useState(initialConnections)
  const [addingConnection, setAddingConnection] = useState(false)
  const [tab, setTab] = useState("policy")
  const [editingCheck, setEditingCheck] = useState<string>()
  const [dirty, setDirty] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState("")
  const [validationVisible, setValidationVisible] = useState(false)
  const readOnly = policy !== undefined && !policy.canModify

  function close() {
    if (pending || (dirty && !window.confirm("Discard unsaved policy changes?"))) return
    if (onCancel) onCancel()
    else if (basePath) router.push(`${basePath}/policies`)
  }

  function addCheck(connection?: GuardrailConnection) {
    const check: GuardrailCheck = {
      id: crypto.randomUUID(),
      name: "",
      phase: "input",
      scopes: connection ? ["instructions", "conversation"] : ["conversation"],
      mode: "enforce",
      failureMode: "closed",
      action: "deny",
      safeExplanation: "Revise the request to comply with this policy and submit again.",
      ...(connection
        ? { connection: { scope: connection.scope, name: connection.name } }
        : { regex: { patterns: [""] } }),
    }
    setDraft({ ...draft, checks: [...draft.checks, check] })
    setEditingCheck(check.id)
    setDirty(true)
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-3xl">
        <SheetHeader className="gap-1.5 border-b-0 px-6 py-5 pr-12">
          <SheetTitle className="flex items-center gap-2.5 text-lg tracking-tight">
            <ShieldCheck aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate" title={policy?.displayName}>
              {policy?.displayName ?? "New policy"}
            </span>
          </SheetTitle>
          <SheetDescription
            className={policy?.mandatory || readOnly ? "pl-6.5 text-xs" : "sr-only"}
          >
            {readOnly
              ? "Read only."
              : policy?.mandatory
                ? "Required by the organization."
                : "Configure checks for model input and output."}
          </SheetDescription>
        </SheetHeader>
        <Tabs className="min-h-0 flex-1 gap-0" onValueChange={setTab} value={tab}>
          <div className="mx-6 mb-6 border-b border-border/60 pb-1">
            <TabsList aria-label="Policy editor" className="gap-5 px-0" variant="line">
              <TabsTrigger className="flex-none px-0" disabled={pending} value="policy">
                Policy
              </TabsTrigger>
              <TabsTrigger
                className="flex-none px-0"
                disabled={!draft.checks.length || !draft.displayName || pending}
                value="test"
              >
                <FlaskConical aria-hidden className="size-3.5" />
                Test
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent
            forceMount
            className="min-h-0 overflow-y-auto px-6 pb-6 data-[state=inactive]:hidden motion-safe:data-[state=active]:animate-in motion-safe:data-[state=active]:duration-150 motion-safe:data-[state=active]:fade-in"
            value="policy"
          >
            <form
              className="flex min-w-0 flex-col gap-7"
              id={`${id}-form`}
              onChange={() => setDirty(true)}
              onInvalidCapture={(event) => {
                const firstInvalid = event.currentTarget.querySelector(
                  "input:invalid, select:invalid, textarea:invalid"
                )
                if (event.target !== firstInvalid) {
                  event.preventDefault()
                  event.stopPropagation()
                  return
                }
                flushSync(() => setTab("policy"))
              }}
              onSubmit={(event) => {
                event.preventDefault()
                setError("")
                const incomplete = draft.checks.find((check) => {
                  const connection = connections.find(
                    (item) =>
                      item.scope === check.connection?.scope && item.name === check.connection.name
                  )
                  return (
                    (connection?.provider === "Bedrock" &&
                      (!check.guardrailId || !check.guardrailVersion)) ||
                    (connection?.provider === "ModelArmor" && !check.template)
                  )
                })
                if (incomplete) {
                  flushSync(() => {
                    setValidationVisible(true)
                    setTab("policy")
                    setEditingCheck(incomplete.id)
                  })
                  event.currentTarget
                    .querySelector<HTMLButtonElement>('button[aria-invalid="true"]:not(:disabled)')
                    ?.focus()
                  return
                }
                startTransition(async () => {
                  const result = await saveGuardrailPolicyAction(scope, draft, policy !== undefined)
                  if (result.error) {
                    setError(result.error.message)
                    return
                  }
                  setDirty(false)
                  toast.success("Policy saved")
                  onSaved?.(result.data)
                  if (basePath) router.push(`${basePath}/policies`)
                  router.refresh()
                })
              }}
            >
              {policy?.status.state === "Error" && policy.status.message ? (
                <Alert variant="destructive">
                  <AlertDescription>{policy.status.message}</AlertDescription>
                </Alert>
              ) : null}
              <Field>
                <FieldLabel htmlFor={`${id}-display`} required>
                  Name
                </FieldLabel>
                <Input
                  disabled={readOnly || pending}
                  id={`${id}-display`}
                  maxLength={128}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      displayName: event.target.value,
                      name: draft.name || `policy-${crypto.randomUUID()}`,
                    })
                  }
                  placeholder="Protect sensitive data"
                  required
                  value={draft.displayName}
                />
              </Field>
              <section>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-sm font-medium">
                    Checks
                    <span className="text-xs font-normal text-muted-foreground tabular-nums">
                      {draft.checks.length}
                    </span>
                  </h2>
                  {!readOnly ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          disabled={pending || draft.checks.length >= 16}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          <Plus /> Add check <ChevronDown />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                          <DropdownMenuItem onSelect={() => addCheck()}>
                            <Regex /> Regex pattern
                          </DropdownMenuItem>
                          {connections.map((connection) => (
                            <DropdownMenuItem
                              key={`${connection.scope}/${connection.name}`}
                              onSelect={() => addCheck(connection)}
                            >
                              <Cable /> {connection.displayName}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuGroup>
                        {canCreateConnection ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                              <DropdownMenuItem onSelect={() => setAddingConnection(true)}>
                                <Plus /> New connection
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
                {draft.checks.length ? (
                  <div>
                    {draft.checks.map((check, index) => (
                      <CheckEditor
                        check={check}
                        connections={connections}
                        count={draft.checks.length}
                        disabled={readOnly || pending}
                        expanded={editingCheck === check.id}
                        index={index}
                        scope={scope}
                        validationVisible={validationVisible}
                        key={check.id}
                        onExpandedChange={(open) => {
                          if (open) setEditingCheck(check.id)
                          else
                            setEditingCheck((current) =>
                              current === check.id ? undefined : current
                            )
                        }}
                        onChange={(value) => {
                          setDraft({
                            ...draft,
                            checks: draft.checks.map((item) =>
                              item.id === check.id ? value : item
                            ),
                          })
                          setDirty(true)
                        }}
                        onMove={(direction) => {
                          const checks = [...draft.checks]
                          const next = index + direction
                          const target = checks[next]
                          if (!target) return
                          checks[index] = target
                          checks[next] = check
                          setDraft({ ...draft, checks })
                          setDirty(true)
                        }}
                        onRemove={() => {
                          setDraft({
                            ...draft,
                            checks: draft.checks.filter((item) => item.id !== check.id),
                          })
                          setEditingCheck(undefined)
                          setDirty(true)
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="border-y border-dotted border-border/80 py-8 text-center text-sm text-muted-foreground">
                    Add a check to get started.
                  </p>
                )}
              </section>
              <details
                className="group/details border-t border-dotted border-border/80 pt-4"
                onInvalidCapture={(event) => {
                  event.currentTarget.open = true
                }}
              >
                <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-sm text-muted-foreground transition-colors marker:hidden hover:text-foreground motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
                  <ChevronDown className="size-3.5 transition-transform group-open/details:rotate-180 motion-reduce:transition-none" />{" "}
                  Details
                </summary>
                <FieldGroup className="mt-3">
                  <Field>
                    <FieldLabel htmlFor={`${id}-description`}>Description</FieldLabel>
                    <Textarea
                      disabled={readOnly || pending}
                      id={`${id}-description`}
                      maxLength={2048}
                      onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                      rows={2}
                      value={draft.description ?? ""}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={policy ? undefined : `${id}-id`}>Policy ID</FieldLabel>
                    {policy ? (
                      <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                        <code className="truncate">{draft.name}</code>
                        <CopyButton content={draft.name} label="Copy policy ID" />
                      </div>
                    ) : (
                      <Input
                        disabled={pending}
                        id={`${id}-id`}
                        maxLength={63}
                        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                        pattern={"[a-z0-9]([a-z0-9\\-]*[a-z0-9])?"}
                        required
                        value={draft.name}
                      />
                    )}
                  </Field>
                </FieldGroup>
              </details>
              {error ? <FieldError>{error}</FieldError> : null}
            </form>
          </TabsContent>
          <TabsContent
            forceMount
            className="min-h-0 overflow-y-auto px-6 pb-6 data-[state=inactive]:hidden motion-safe:data-[state=active]:animate-in motion-safe:data-[state=active]:duration-150 motion-safe:data-[state=active]:fade-in"
            value="test"
          >
            <GuardrailPlayground
              policy={
                readOnly && policy
                  ? { kind: "saved", configuration: policy }
                  : { kind: "draft", configuration: draft }
              }
              policies={policy ? [policy] : []}
              sandboxes={[]}
              scope={scope}
            />
          </TabsContent>
        </Tabs>
        <SheetFooter className="flex-row justify-end border-t border-border/60 bg-muted/15 px-6 py-4">
          <Button disabled={pending} onClick={close} type="button" variant="ghost">
            {readOnly ? "Close" : "Cancel"}
          </Button>
          {tab === "policy" && !readOnly ? (
            <LoadingButton
              disabled={!draft.checks.length}
              form={`${id}-form`}
              pending={pending}
              pendingLabel="Saving..."
              type="submit"
            >
              Save policy
            </LoadingButton>
          ) : tab === "test" ? (
            <Button onClick={() => setTab("policy")} type="button" variant="outline">
              Back to policy
            </Button>
          ) : null}
        </SheetFooter>
        {addingConnection ? (
          <ConnectionSheet
            scope={scope}
            onClose={() => setAddingConnection(false)}
            onSaved={(connection) => {
              setConnections((items) => [
                ...items.filter(
                  (item) => item.scope !== connection.scope || item.name !== connection.name
                ),
                connection,
              ])
              addCheck(connection)
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
