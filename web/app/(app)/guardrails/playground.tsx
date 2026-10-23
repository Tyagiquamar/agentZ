"use client"

import { useId, useState, useTransition } from "react"
import { FlaskConical, ShieldCheck } from "lucide-react"
import type {
  GuardrailEffective,
  GuardrailPolicy,
  GuardrailPolicyInput,
  GuardrailTestInput,
  GuardrailTestResult,
  Sandbox,
} from "@/lib/gateway/client"
import {
  resolveGuardrailsAction,
  testGuardrailsAction,
  type GuardrailActionScope,
} from "@/data/guardrail.actions"
import { GuardrailOutcome } from "@/components/guardrails/guardrail-outcome"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { LoadingButton } from "@/components/interior/loading-button"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { CopyButton } from "@/components/interior/copy-button"
import { cn } from "@/lib/utils"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

type GuardrailTestReport = {
  target: string
  policy: GuardrailPolicyInput | undefined
  content: string
  phase: GuardrailTestInput["phase"]
  result?: GuardrailTestResult
  effective?: GuardrailEffective
  error?: string
}

export function GuardrailPlayground({
  policies,
  sandboxes,
  scope,
  initialPolicy,
  policy,
}: {
  policy?:
    | { kind: "draft"; configuration: GuardrailPolicyInput }
    | { kind: "saved"; configuration: GuardrailPolicy }
  policies: GuardrailPolicy[]
  sandboxes: Sandbox[]
  scope: GuardrailActionScope
  initialPolicy?: string
}) {
  const id = useId()
  const [target, setTarget] = useState(initialPolicy ? `policy/${initialPolicy}` : "")
  const [clientId, setClientId] = useState("")
  const [phase, setPhase] = useState<GuardrailTestInput["phase"]>("input")
  const [content, setContent] = useState("")
  const [report, setReport] = useState<GuardrailTestReport>()
  const [pending, startTransition] = useTransition()
  const targetPolicy = policies.find((item) => `policy/${item.scope}/${item.name}` === target)
  const sandbox = sandboxes.find((item) => `sandbox/${item.scope}/${item.name}` === target)
  const selectedPolicy = policy?.configuration ?? targetPolicy
  const currentReport =
    report?.policy === selectedPolicy && report?.target === target ? report : undefined
  const result = currentReport?.result
  const effective = currentReport?.effective
  const definitions = effective?.checks.map((item) => item.check) ?? selectedPolicy?.checks ?? []
  const auditFindings = result?.checks.some((check) => check.action === "audit") ?? false
  const showResults =
    pending ||
    result !== undefined ||
    effective !== undefined ||
    (report !== undefined && currentReport === undefined)

  return (
    <div
      className={cn(
        "grid min-w-0 items-start gap-8",
        !policy && "px-4 pb-6 md:px-6",
        !policy && (showResults ? "lg:grid-cols-2" : "max-w-2xl")
      )}
    >
      <form
        className="min-w-0"
        onChange={() => setReport(undefined)}
        onSubmit={(event) => {
          event.preventDefault()
          const snapshot: GuardrailTestReport = { target, policy: selectedPolicy, content, phase }
          setReport(undefined)
          startTransition(async () => {
            let body: GuardrailTestInput = { phase, content }
            let resolved: GuardrailEffective | undefined
            if (policy || target.startsWith("policy/")) {
              if (policy?.kind === "draft") {
                body = { ...body, inlinePolicy: policy.configuration }
              } else {
                const savedPolicy = policy?.kind === "saved" ? policy.configuration : targetPolicy
                if (!savedPolicy) {
                  setReport({ ...snapshot, error: "Select a policy to test." })
                  return
                }
                body = { ...body, policy: { scope: savedPolicy.scope, name: savedPolicy.name } }
              }
            } else {
              if (!target) {
                setReport({ ...snapshot, error: "Select a test target." })
                return
              }
              const selectedClient = target === "client" ? clientId : undefined
              const response = await resolveGuardrailsAction(scope, {
                assignment: {},
                sandbox: sandbox?.name,
                sandboxScope: sandbox?.scope,
                clientId: selectedClient,
              })
              if (response.error) {
                setReport({ ...snapshot, error: response.error.message })
                return
              }
              resolved = response.data
              setReport({ ...snapshot, effective: resolved })
              body = {
                ...body,
                sandbox: sandbox?.name,
                sandboxScope: sandbox?.scope,
                clientId: selectedClient,
                ...(!sandbox && !selectedClient ? { assignment: {} } : {}),
              }
            }
            const response = await testGuardrailsAction(scope, body)
            if (response.outcome) {
              setReport({
                ...snapshot,
                effective: resolved,
                result: {
                  action: response.outcome.code === "guardrail_denied" ? "deny" : "error",
                  content: "",
                  referenceId: response.outcome.referenceId,
                  explanation: response.outcome.explanation,
                  outcome: response.outcome,
                  checks: [],
                },
              })
              return
            }
            if (response.error) {
              setReport({ ...snapshot, effective: resolved, error: response.error.message })
              return
            }
            setReport({ ...snapshot, effective: resolved, result: response.data })
          })
        }}
      >
        <FieldGroup className="gap-6">
          {policy ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {policy.kind === "draft" ? "Tests this draft only." : "Tests this policy only."}{" "}
              Organization and workload additions are excluded.
            </p>
          ) : (
            <>
              <Field>
                <FieldLabel htmlFor={`${id}-target`}>Test target</FieldLabel>
                <Select
                  disabled={pending}
                  onValueChange={(value) => {
                    setTarget(value)
                    setReport(undefined)
                  }}
                  value={target}
                >
                  <SelectTrigger className="w-full" id={`${id}-target`}>
                    <SelectValue placeholder="Select a policy or workload" />
                  </SelectTrigger>
                  <SelectContent>
                    {policies.length ? (
                      <SelectGroup>
                        <SelectLabel>Policies</SelectLabel>
                        {policies.map((item) => (
                          <SelectItem
                            key={`policy/${item.scope}/${item.name}`}
                            value={`policy/${item.scope}/${item.name}`}
                          >
                            {item.displayName} ·{" "}
                            {item.scope === "Organisation" ? "Organization" : "Workspace"}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ) : null}
                    <SelectGroup>
                      <SelectLabel>Workloads</SelectLabel>
                      <SelectItem value="baseline">Organization baseline</SelectItem>
                      {sandboxes.map((item) => (
                        <SelectItem
                          key={`sandbox/${item.scope}/${item.name}`}
                          value={`sandbox/${item.scope}/${item.name}`}
                        >
                          Sandbox · {item.name} ·{" "}
                          {item.scope === "Organisation" ? "Organization" : "Workspace"}
                        </SelectItem>
                      ))}
                      {scope.workspaceId ? (
                        <SelectItem value="client">External client</SelectItem>
                      ) : null}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription className="text-xs leading-relaxed">
                  {targetPolicy
                    ? "Tests this policy only."
                    : "Includes required organization and saved workload policies."}
                </FieldDescription>
              </Field>
              {target === "client" ? (
                <Field>
                  <FieldLabel htmlFor={`${id}-client`}>Client ID</FieldLabel>
                  <Input
                    disabled={pending}
                    id={`${id}-client`}
                    onChange={(event) => setClientId(event.target.value)}
                    placeholder="Authorized application or CLI client"
                    required
                    value={clientId}
                  />
                </Field>
              ) : null}
            </>
          )}
          <Tabs
            value={phase}
            onValueChange={(value) => {
              if (value === "input" || value === "output") {
                setPhase(value)
                setReport(undefined)
              }
            }}
          >
            <TabsList aria-label="Content to test">
              <TabsTrigger disabled={pending} value="input">
                Input
              </TabsTrigger>
              <TabsTrigger disabled={pending} value="output">
                Output
              </TabsTrigger>
            </TabsList>
            <TabsContent value={phase}>
              <Field>
                <FieldLabel htmlFor={`${id}-content`}>
                  {phase === "input" ? "Prompt or input text" : "Response text"}
                </FieldLabel>
                <Textarea
                  className={cn("resize-y font-mono text-sm", policy ? "min-h-32" : "min-h-56")}
                  disabled={pending}
                  id={`${id}-content`}
                  maxLength={65536}
                  onChange={(event) => setContent(event.target.value)}
                  placeholder={
                    phase === "input" ? "Enter a sample message…" : "Enter a sample response…"
                  }
                  required
                  value={content}
                />
                <FieldDescription className="text-xs leading-relaxed">
                  Sent to the configured checkers. No model response is generated.
                </FieldDescription>
              </Field>
            </TabsContent>
          </Tabs>
          {currentReport?.error ? <FieldError>{currentReport.error}</FieldError> : null}
          <LoadingButton
            className="self-end"
            pending={pending}
            pendingLabel="Evaluating..."
            disabled={!content || (!policy && !target)}
            type="submit"
          >
            <FlaskConical data-icon="inline-start" />
            Run test
          </LoadingButton>
        </FieldGroup>
      </form>
      {showResults ? (
        <section
          className={cn(
            "flex min-w-0 flex-col gap-5 motion-safe:animate-in motion-safe:duration-150 motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1",
            policy && "border-t border-dotted border-border/80 pt-6"
          )}
          aria-live="polite"
        >
          <h2 className="text-sm font-medium">Test results</h2>
          {!result ? (
            <p className="text-sm text-muted-foreground">
              {pending
                ? "Waiting for the configured checkers…"
                : report && !currentReport
                  ? "The policy changed. Run this sample again."
                  : "Run a sample to see the verdict and individual checks."}
            </p>
          ) : null}
          {result ? (
            <>
              {result.action === "deny" || result.action === "error" ? (
                <GuardrailOutcome
                  outcome={
                    result.outcome ?? {
                      code:
                        result.action === "error" ? "guardrail_unavailable" : "guardrail_denied",
                      safeLabel: selectedPolicy?.displayName ?? "",
                      explanation: result.explanation,
                      phase: currentReport.phase,
                      referenceId: result.referenceId,
                      partialOutput: false,
                    }
                  }
                />
              ) : (
                <Alert
                  className={cn(
                    "border-l-2 px-4 py-3",
                    result.action === "mask" || auditFindings
                      ? "border-warning/45 bg-warning/5 [&>svg]:text-warning-foreground"
                      : "border-success/45 bg-success/5 [&>svg]:text-success"
                  )}
                >
                  <ShieldCheck aria-hidden />
                  <AlertTitle>
                    {result.action === "mask"
                      ? "Content modified"
                      : auditFindings
                        ? "Allowed in audit mode"
                        : "Allowed"}
                  </AlertTitle>
                  <AlertDescription className="mt-1 flex flex-col gap-2 text-muted-foreground">
                    <p>{result.explanation || "All evaluated checks passed."}</p>
                    {result.referenceId ? (
                      <div className="flex min-w-0 items-center gap-1">
                        <code className="truncate text-xs" title={result.referenceId}>
                          {result.referenceId}
                        </code>
                        <CopyButton content={result.referenceId} label="Copy test reference" />
                      </div>
                    ) : null}
                  </AlertDescription>
                </Alert>
              )}
              <div>
                <h3 className="mb-2 text-sm font-medium">Check results</h3>
                {result.checks.length ? (
                  <Accordion type="multiple">
                    {result.checks.map((check, index) => {
                      const matching = definitions.filter((item) => item.id === check.checkId)
                      const definition = matching.length === 1 ? matching[0] : undefined
                      return (
                        <AccordionItem
                          key={`${check.checkId}/${index}`}
                          value={`${check.checkId}/${index}`}
                        >
                          <AccordionTrigger className="items-center gap-3 rounded-none py-3 hover:no-underline">
                            <span className="w-4 shrink-0 text-xs text-muted-foreground tabular-nums">
                              {index + 1}
                            </span>
                            <span className="min-w-0 flex-1 text-left break-words">
                              {definition?.name || check.checkId}
                            </span>
                            <span
                              className={cn(
                                "shrink-0 text-xs font-normal",
                                check.action === "allow" && "text-muted-foreground",
                                (check.action === "reject" || check.action === "error") &&
                                  "text-destructive",
                                (check.action === "mask" ||
                                  check.action === "audit" ||
                                  check.action === "failOpen") &&
                                  "text-warning-foreground"
                              )}
                            >
                              {check.action === "allow"
                                ? "Passed"
                                : check.action === "reject"
                                  ? "Blocked"
                                  : check.action === "mask"
                                    ? "Masked"
                                    : check.action === "audit"
                                      ? "Audit finding"
                                      : check.action === "failOpen"
                                        ? "Allowed after error"
                                        : check.action}
                            </span>
                          </AccordionTrigger>
                          <AccordionContent className="pl-7">
                            <p className="text-sm text-muted-foreground">{check.explanation}</p>
                            <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                              <span className="shrink-0">Check ID</span>
                              <code className="truncate" title={check.checkId}>
                                {check.checkId}
                              </code>
                              <CopyButton content={check.checkId} label="Copy check ID" />
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      )
                    })}
                  </Accordion>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Per-check details were not returned for this request.
                  </p>
                )}
              </div>
              {result.action === "mask" ? (
                <div className={cn("grid min-w-0 gap-4", !policy && "xl:grid-cols-2")}>
                  <div className="min-w-0">
                    <h3 className="mb-2 text-sm font-medium">Original content</h3>
                    <pre className="max-h-64 overflow-auto py-1 text-xs leading-relaxed whitespace-pre-wrap">
                      {currentReport.content}
                    </pre>
                  </div>
                  <div className="min-w-0">
                    <h3 className="mb-2 text-sm font-medium">Updated content</h3>
                    <pre className="max-h-64 overflow-auto py-1 text-xs leading-relaxed whitespace-pre-wrap">
                      {result.content}
                    </pre>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
          {effective ? (
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                Effective configuration · {effective.checks.length}{" "}
                {effective.checks.length === 1 ? "check" : "checks"}
              </summary>
              <div className="mt-3 flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {effective.delivery === "wholeOutput"
                      ? "Output held until checked"
                      : "Checked streaming"}
                  </span>
                  <span aria-hidden>·</span>
                  <span>
                    {effective.captureMode === "all"
                      ? "All content captured"
                      : effective.captureMode === "findings"
                        ? "Findings captured"
                        : "Content capture off"}
                  </span>
                </div>
                <ol className="flex list-inside list-decimal flex-col gap-2 text-sm">
                  {effective.checks.map((item) => (
                    <li className="break-words" key={`${item.policyId}/${item.check.id}`}>
                      {item.policyName} / {item.check.name}
                      <span className="text-muted-foreground">
                        {" "}
                        · {item.check.phase === "input" ? "Input" : "Output"}
                        {item.mandatory ? " · Required" : ""}
                      </span>
                    </li>
                  ))}
                </ol>
                {!effective.checks.length ? (
                  <p className="text-sm text-muted-foreground">No checks apply to this context.</p>
                ) : null}
                <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                  <span>Revision</span>
                  <code className="truncate" title={effective.revision}>
                    {effective.revision.slice(0, 12)}
                  </code>
                  <CopyButton content={effective.revision} label="Copy configuration revision" />
                </div>
              </div>
            </details>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
