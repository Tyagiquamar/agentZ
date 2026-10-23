"use client"

import type { GuardrailOutcome as Outcome } from "@/lib/gateway/client"
import { ShieldAlert, TriangleAlert } from "lucide-react"
import { CopyButton } from "@/components/interior/copy-button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

export function GuardrailOutcome({ outcome, onEdit }: { outcome: Outcome; onEdit?: () => void }) {
  const {
    safeLabel: category,
    explanation,
    phase,
    referenceId,
    partialOutput: incomplete,
  } = outcome
  const serviceError = outcome.code === "guardrail_unavailable"
  return (
    <Alert
      className="border-l-2 border-destructive/45 bg-destructive/5 px-4 py-3"
      variant="destructive"
    >
      {serviceError ? <TriangleAlert aria-hidden /> : <ShieldAlert aria-hidden />}
      <AlertTitle>
        {serviceError ? "Guardrail service unavailable" : "Blocked by guardrail"}
      </AlertTitle>
      <AlertDescription className="mt-1 flex flex-col gap-2 text-foreground">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{phase === "input" ? "Input" : "Output"}</span>
          {category ? (
            <>
              <span aria-hidden>·</span>
              <span>{category}</span>
            </>
          ) : null}
          {incomplete ? (
            <>
              <span aria-hidden>·</span>
              <span className="font-medium text-destructive">Incomplete response</span>
            </>
          ) : null}
        </div>
        {incomplete ? (
          <p>The response stopped during a guardrail check. The text above is incomplete.</p>
        ) : null}
        <p>{explanation}</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex max-w-full min-w-0 items-center gap-1">
            <span className="truncate font-mono text-xs text-muted-foreground" title={referenceId}>
              Reference {referenceId}
            </span>
            <CopyButton content={referenceId} label="Copy guardrail reference" />
          </span>
          {onEdit && phase === "input" && !serviceError ? (
            <Button onClick={onEdit} size="sm" type="button" variant="outline">
              Edit request
            </Button>
          ) : null}
        </div>
      </AlertDescription>
    </Alert>
  )
}
