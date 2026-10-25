"use client"

import { useId, useState } from "react"
import { flushSync } from "react-dom"
import { ArrowDown, ArrowUp, ChevronDown, MoreHorizontal, Trash2 } from "lucide-react"
import type { GuardrailCheck, GuardrailConnection } from "@/lib/gateway/client"
import type { GuardrailActionScope } from "@/data/guardrail.actions"
import { GuardrailProviderResources } from "./provider-resources"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const contentScopes = [
  ["instructions", "Instructions"],
  ["conversation", "Conversation"],
  ["toolResults", "Tool results"],
  ["toolArguments", "Tool arguments"],
] as const

export function CheckEditor({
  check,
  connections,
  disabled,
  expanded,
  index,
  count,
  scope,
  validationVisible,
  onChange,
  onExpandedChange,
  onMove,
  onRemove,
}: {
  check: GuardrailCheck
  connections: GuardrailConnection[]
  disabled: boolean
  expanded: boolean
  index: number
  count: number
  scope: GuardrailActionScope
  validationVisible: boolean
  onChange: (check: GuardrailCheck) => void
  onExpandedChange: (open: boolean) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
}) {
  const [advanced, setAdvanced] = useState(false)
  const connection = connections.find(
    (item) => item.name === check.connection?.name && item.scope === check.connection.scope
  )
  const defaultScopes =
    check.phase === "output" || check.regex ? ["conversation"] : ["instructions", "conversation"]
  const customScopes =
    check.scopes.length !== defaultScopes.length ||
    check.scopes.some((scope) => !defaultScopes.includes(scope))
  const id = useId()

  return (
    <div className="relative border-b border-border/60 last:border-b-0">
      <details
        className="group/check"
        open={expanded}
        onInvalidCapture={() => flushSync(() => onExpandedChange(true))}
        onToggle={(event) => {
          if (event.target === event.currentTarget) onExpandedChange(event.currentTarget.open)
        }}
      >
        <summary className="-mx-2 flex cursor-pointer list-none items-center gap-3 rounded-md px-2 py-4 pr-10 transition-colors marker:hidden hover:bg-muted/35 focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
          <span
            aria-hidden
            className="w-4 shrink-0 text-center font-mono text-[11px] text-muted-foreground/70 tabular-nums"
          >
            {index + 1}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate text-sm font-medium">{check.name || "New check"}</span>
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex shrink-0 items-center gap-1">
                {check.phase === "input" ? (
                  <ArrowDown aria-hidden className="size-3" />
                ) : (
                  <ArrowUp aria-hidden className="size-3" />
                )}
                {check.phase === "input" ? "Input" : "Output"}
              </span>
              <span aria-hidden className="text-muted-foreground/50">
                ·
              </span>
              <span className="max-w-48 truncate">
                {check.regex
                  ? "Regex"
                  : (connection?.displayName ?? check.connection?.name ?? "Checker")}
              </span>
              {check.mode === "audit" ? (
                <Badge className="text-[11px]" variant="secondary">
                  Audit
                </Badge>
              ) : null}
              {check.mode === "enforce" && check.action === "mask" ? (
                <Badge className="text-[11px]" variant="secondary">
                  Mask
                </Badge>
              ) : null}
              {check.mode === "enforce" && check.failureMode === "open" ? (
                <Badge className="text-[11px]" variant="warning">
                  Fail open
                </Badge>
              ) : null}
              {customScopes ? (
                <Badge className="text-[11px]" variant="secondary">
                  Custom scope
                </Badge>
              ) : null}
            </span>
          </span>
          <ChevronDown
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150 group-open/check:rotate-180 motion-reduce:transition-none"
          />
        </summary>
        <div className="pt-1 pb-6 motion-safe:group-open/check:animate-in motion-safe:group-open/check:duration-150 motion-safe:group-open/check:fade-in motion-safe:group-open/check:slide-in-from-top-1 sm:pl-7">
          <FieldGroup className="[&_[data-slot=field-description]]:text-xs">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${id}-name`} required>
                  Label
                </FieldLabel>
                <Input
                  disabled={disabled}
                  id={`${id}-name`}
                  maxLength={128}
                  onChange={(event) => onChange({ ...check, name: event.target.value })}
                  required
                  value={check.name}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-phase`}>Phase</FieldLabel>
                <Select
                  disabled={disabled}
                  onValueChange={(value) => {
                    if (value === "input" || value === "output")
                      onChange({
                        ...check,
                        phase: value,
                        scopes:
                          value === "output"
                            ? ["conversation"]
                            : !check.regex
                              ? ["instructions", "conversation"]
                              : check.scopes,
                      })
                  }}
                  value={check.phase}
                >
                  <SelectTrigger id={`${id}-phase`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="input">Input</SelectItem>
                      <SelectItem disabled={connection?.provider === "OpenAI"} value="output">
                        Output
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor={`${id}-detector`}>Checker</FieldLabel>
              <Select
                disabled={disabled}
                onValueChange={(value) => {
                  if (value === "regex") {
                    onChange({
                      ...check,
                      connection: undefined,
                      regex: { patterns: [""] },
                      guardrailId: undefined,
                      guardrailVersion: undefined,
                      template: undefined,
                    })
                    return
                  }
                  const selected = connections.find(
                    (item) => `${item.scope}/${item.name}` === value
                  )
                  if (selected)
                    onChange({
                      ...check,
                      regex: undefined,
                      connection: { scope: selected.scope, name: selected.name },
                      phase: selected.provider === "OpenAI" ? "input" : check.phase,
                      action: "deny",
                      guardrailId: undefined,
                      guardrailVersion: undefined,
                      template: undefined,
                      scopes:
                        check.phase === "output" && selected.provider !== "OpenAI"
                          ? ["conversation"]
                          : ["instructions", "conversation"],
                    })
                }}
                value={
                  check.regex
                    ? "regex"
                    : check.connection
                      ? `${check.connection.scope}/${check.connection.name}`
                      : ""
                }
              >
                <SelectTrigger id={`${id}-detector`} className="w-full">
                  <SelectValue placeholder="Select a checker connection" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="regex">Regex · no connection required</SelectItem>
                    {check.connection && !connection ? (
                      <SelectItem value={`${check.connection.scope}/${check.connection.name}`}>
                        {check.connection.scope} / {check.connection.name}
                      </SelectItem>
                    ) : null}
                    {connections.map((item) => (
                      <SelectItem
                        key={`${item.scope}/${item.name}`}
                        value={`${item.scope}/${item.name}`}
                      >
                        {item.displayName} · {item.provider}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            {check.regex ? (
              <Field>
                <FieldLabel htmlFor={`${id}-patterns`} required>
                  Regex patterns
                </FieldLabel>
                <Textarea
                  className="bg-muted/20 font-mono"
                  disabled={disabled}
                  id={`${id}-patterns`}
                  onChange={(event) =>
                    onChange({
                      ...check,
                      regex: { ...check.regex, patterns: event.target.value.split("\n") },
                    })
                  }
                  placeholder="One pattern per line"
                  required
                  value={check.regex.patterns.join("\n")}
                />
                <FieldDescription>One pattern per line.</FieldDescription>
              </Field>
            ) : null}
            {disabled && check.connection && !connection ? (
              <FieldDescription>
                Referenced connection: {check.connection.scope} / {check.connection.name}.
                {check.guardrailId ? (
                  <span className="block">Guardrail ID: {check.guardrailId}</span>
                ) : null}
                {check.guardrailVersion ? (
                  <span className="block">Guardrail version: {check.guardrailVersion}</span>
                ) : null}
                {check.template ? <span className="block">Template: {check.template}</span> : null}
              </FieldDescription>
            ) : null}
            {connection ? (
              <GuardrailProviderResources
                check={check}
                connection={connection}
                disabled={disabled}
                key={`${connection.scope}/${connection.name}`}
                onChange={onChange}
                scope={scope}
                validationVisible={validationVisible}
              />
            ) : null}

            <Field>
              <FieldLabel htmlFor={`${id}-action`}>Action</FieldLabel>
              <Select
                disabled={disabled}
                onValueChange={(value) => {
                  if (value === "audit") onChange({ ...check, mode: "audit" })
                  if (value === "enforce") onChange({ ...check, mode: "enforce", action: "deny" })
                }}
                value={
                  check.mode === "audit" ? "audit" : check.action === "mask" ? "mask" : "enforce"
                }
              >
                <SelectTrigger id={`${id}-action`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="enforce">Enforce</SelectItem>
                    {check.action === "mask" ? (
                      <SelectItem disabled value="mask">
                        Mask (existing configuration)
                      </SelectItem>
                    ) : null}
                    <SelectItem value="audit">Audit only</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              {check.mode === "audit" ? (
                <FieldDescription>
                  Records findings without blocking or changing content.
                </FieldDescription>
              ) : check.regex && check.action === "mask" ? (
                <FieldDescription>
                  Matched text uses the gateway&apos;s standard redaction.
                </FieldDescription>
              ) : !check.regex ? (
                <FieldDescription>
                  The provider controls detection and may modify content as part of enforcement.
                </FieldDescription>
              ) : null}
            </Field>
            <details
              className="group/advanced pt-1"
              open={advanced}
              onInvalidCapture={() => flushSync(() => setAdvanced(true))}
              onToggle={(event) => {
                if (event.target === event.currentTarget) setAdvanced(event.currentTarget.open)
              }}
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted-foreground transition-colors marker:hidden hover:text-foreground motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
                <ChevronDown className="size-3.5 transition-transform group-open/advanced:rotate-180 motion-reduce:transition-none" />
                Advanced
              </summary>
              <FieldGroup className="pt-5">
                <FieldSet>
                  <FieldLegend variant="label">Inspected content</FieldLegend>
                  {check.phase === "input" ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {contentScopes.map(([scope, label]) => (
                        <Field key={scope} orientation="horizontal">
                          <Checkbox
                            checked={check.scopes.includes(scope)}
                            disabled={
                              disabled || (!check.regex && connection?.provider !== "Bedrock")
                            }
                            id={`${id}-${scope}`}
                            onCheckedChange={(selected) =>
                              onChange({
                                ...check,
                                scopes:
                                  selected === true
                                    ? [...check.scopes, scope]
                                    : check.scopes.filter((item) => item !== scope),
                              })
                            }
                          />
                          <FieldLabel htmlFor={`${id}-${scope}`}>{label}</FieldLabel>
                        </Field>
                      ))}
                    </div>
                  ) : (
                    <FieldDescription>Response text.</FieldDescription>
                  )}
                </FieldSet>
                <Field>
                  <FieldLabel htmlFor={`${id}-failure`}>If the checker fails</FieldLabel>
                  <Select
                    disabled={disabled}
                    onValueChange={(value) => {
                      if (value === "closed" || value === "open")
                        onChange({ ...check, failureMode: value })
                    }}
                    value={check.failureMode}
                  >
                    <SelectTrigger id={`${id}-failure`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="closed">Stop request</SelectItem>
                        <SelectItem value="open">Allow request</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    Applies to checker errors and timeouts, including audit checks. Audit findings
                    do not block requests.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-explanation`}>Message when blocked</FieldLabel>
                  <Textarea
                    disabled={disabled}
                    id={`${id}-explanation`}
                    maxLength={512}
                    onChange={(event) =>
                      onChange({ ...check, safeExplanation: event.target.value })
                    }
                    placeholder="Explain what the user can change and try again."
                    value={check.safeExplanation ?? ""}
                  />
                  <FieldDescription>Shown in errors. Keep sensitive details out.</FieldDescription>
                </Field>
              </FieldGroup>
            </details>
          </FieldGroup>
        </div>
      </details>
      {!disabled ? (
        <div className="absolute top-5 -right-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={`Actions for ${check.name || "new check"}`}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(-1)}>
                  <ArrowUp /> Move up
                </DropdownMenuItem>
                <DropdownMenuItem disabled={index === count - 1} onSelect={() => onMove(1)}>
                  <ArrowDown /> Move down
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onRemove} variant="destructive">
                  <Trash2 /> Delete check
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </div>
  )
}
