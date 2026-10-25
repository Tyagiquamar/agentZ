"use client"

import { useId, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ArrowDown, ArrowUp, CircleAlert, Save } from "lucide-react"
import { toast } from "sonner"
import type { GuardrailPolicy, GuardrailSettings } from "@/lib/gateway/client"
import { saveGuardrailSettingsAction } from "@/data/guardrail.actions"
import { LoadingButton } from "@/components/interior/loading-button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function GuardrailOrganizationSettings({
  initial,
  policies,
  canModify,
}: {
  initial: GuardrailSettings
  policies: GuardrailPolicy[]
  canModify: boolean
}) {
  const idPrefix = useId()
  const router = useRouter()
  const [settings, setSettings] = useState(initial)
  const retentionInput = useRef<HTMLInputElement>(null)
  const [error, setError] = useState("")
  const [pending, startTransition] = useTransition()
  const organizationPolicies = policies.filter((policy) => policy.scope === "Organisation")

  return (
    <form
      className="flex max-w-4xl min-w-0 flex-col gap-8 px-4 pb-6 md:px-6"
      onSubmit={(event) => {
        event.preventDefault()
        if (!retentionInput.current) return
        const retentionDays = retentionInput.current.valueAsNumber
        setError("")
        startTransition(async () => {
          const result = await saveGuardrailSettingsAction({ ...settings, retentionDays })
          if (result.error) {
            setError(result.error.message)
            return
          }
          toast.success("Organization guardrail settings saved")
          router.refresh()
        })
      }}
    >
      <FieldSet className="gap-5">
        <FieldLegend className="font-semibold">Organization baseline</FieldLegend>
        <FieldDescription>
          Selected policies protect every managed request, including external applications and CLI
          agents. Workspaces cannot remove them.
        </FieldDescription>
        {organizationPolicies.map((policy) => (
          <Field key={policy.name} orientation="horizontal">
            <Checkbox
              checked={settings.mandatoryPolicies.includes(policy.name)}
              disabled={!canModify || pending}
              id={`${idPrefix}-required-${policy.name}`}
              onCheckedChange={(value) =>
                setSettings({
                  ...settings,
                  mandatoryPolicies:
                    value === true
                      ? [...settings.mandatoryPolicies, policy.name]
                      : settings.mandatoryPolicies.filter((name) => name !== policy.name),
                })
              }
            />
            <FieldContent>
              <FieldLabel htmlFor={`${idPrefix}-required-${policy.name}`}>
                {policy.displayName}
              </FieldLabel>
              <FieldDescription>
                {policy.description ||
                  `${policy.checks.length} ${policy.checks.length === 1 ? "check" : "checks"}`}
              </FieldDescription>
            </FieldContent>
          </Field>
        ))}
        {organizationPolicies.length === 0 ? (
          <FieldDescription>
            Create an organization policy before adding it to the required baseline.
          </FieldDescription>
        ) : null}
      </FieldSet>
      {settings.mandatoryPolicies.length > 1 ? (
        <FieldSet>
          <FieldLegend variant="label">Baseline execution order</FieldLegend>
          {settings.mandatoryPolicies.map((name, index) => (
            <div className="flex items-center justify-between gap-2" key={name}>
              <span className="text-sm">
                {index + 1}. {policies.find((policy) => policy.name === name)?.displayName ?? name}
              </span>
              <div className="flex gap-1">
                {([-1, 1] as const).map((direction) => (
                  <Button
                    aria-label={`Move ${name} ${direction === -1 ? "up" : "down"}`}
                    disabled={
                      !canModify ||
                      pending ||
                      (direction === -1
                        ? index === 0
                        : index === settings.mandatoryPolicies.length - 1)
                    }
                    key={direction}
                    onClick={() => {
                      const values = [...settings.mandatoryPolicies]
                      const target = values[index + direction]
                      if (!target) return
                      values[index] = target
                      values[index + direction] = name
                      setSettings({ ...settings, mandatoryPolicies: values })
                    }}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    {direction === -1 ? <ArrowUp /> : <ArrowDown />}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </FieldSet>
      ) : null}
      <FieldSet className="gap-5">
        <FieldLegend className="font-semibold">Event storage</FieldLegend>
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-guardrail-retention`}>Retention in days</FieldLabel>
          <Input
            className="max-w-40"
            disabled={!canModify || pending}
            id={`${idPrefix}-guardrail-retention`}
            max={3650}
            min={1}
            defaultValue={initial.retentionDays}
            ref={retentionInput}
            required
            type="number"
          />
          <FieldDescription>
            Applies to guardrail event metadata. Reducing retention deletes events older than the
            new limit.
          </FieldDescription>
        </Field>
      </FieldSet>
      {error ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertTitle>Settings not saved</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {canModify ? (
        <div className="-mx-4 flex w-[100cqw] justify-end border-t px-4 pt-6 md:-mx-6 md:px-6">
          <LoadingButton pending={pending} pendingLabel="Saving..." type="submit">
            <Save data-icon="inline-start" />
            Save settings
          </LoadingButton>
        </div>
      ) : null}
    </form>
  )
}
