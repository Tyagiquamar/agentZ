"use client"

import * as React from "react"
import { useTagInput } from "@/components/interior/tag-input"
import type { FieldError as RHFFieldError } from "react-hook-form"
import { Plus, X } from "lucide-react"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { secretHostSchema } from "@/data/schema"

type SecretHostsFieldProps = {
  name: string
  value: string
  inputRef: React.Ref<HTMLInputElement>
  onBlur: () => void
  onChange: (value: string) => void
  invalid: boolean
  error?: RHFFieldError
  inputID: string
}

export function SecretHostsField({
  name,
  value,
  inputRef,
  onBlur,
  onChange,
  invalid,
  error,
  inputID,
}: SecretHostsFieldProps) {
  const [draftError, setDraftError] = React.useState<string>()
  const hosts = value
    .split("\n")
    .map((host) => host.trim())
    .filter(Boolean)

  const tags = useTagInput({
    value: hosts,
    onChange: (next) => onChange([...next].sort().join("\n")),
    parse: (candidate) => {
      const parsed = secretHostSchema.safeParse(candidate)
      if (!parsed.success) {
        setDraftError(parsed.error.issues[0]?.message ?? "Host is invalid")
        return
      }
      return parsed.data
    },
  })

  return (
    <Field data-invalid={invalid || Boolean(draftError)}>
      <FieldLabel htmlFor={inputID} required>
        Hosts
      </FieldLabel>
      <FieldDescription className="text-muted-foreground/80">
        Add an exact host, IP address, or CIDR range. `*.` matches one subdomain label; `**.`
        matches any depth.
      </FieldDescription>
      <input type="hidden" name={name} value={value} readOnly />
      <InputGroup className="h-9">
        <InputGroupInput
          id={inputID}
          ref={inputRef}
          aria-describedby={`${inputID}-error`}
          {...tags.inputProps}
          onBlur={() => {
            tags.inputProps.onBlur()
            onBlur()
          }}
          onChange={(event) => {
            tags.inputProps.onChange(event)
            setDraftError(undefined)
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") setDraftError(undefined)
            tags.inputProps.onKeyDown(event)
          }}
          onPaste={(event) => {
            setDraftError(undefined)
            tags.inputProps.onPaste(event)
          }}
          placeholder="api.example.com, *.example.com, **.example.com, 10.0.0.0/24"
          className="font-mono"
          aria-invalid={invalid || Boolean(draftError)}
          aria-required="true"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            onClick={() => {
              setDraftError(undefined)
              tags.add([tags.draft])
            }}
            aria-label="Add host"
          >
            <Plus />
            Add
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {hosts.length > 0 ? (
        <div className="overflow-hidden rounded-md border">
          {hosts.map((host, index) => (
            <div
              key={host}
              data-selected={tags.armedIndex === index || undefined}
              className="flex h-8 items-center justify-between gap-3 border-b px-2.5 last:border-b-0 data-selected:bg-muted"
            >
              <span className="truncate font-mono text-sm">{host}</span>
              <button
                type="button"
                className="shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => tags.removeAt(index)}
                aria-label={`Remove ${host}`}
              >
                <X data-icon="inline-end" size={15} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <span role="status" className="sr-only">
        {tags.announcement}
      </span>
      <FieldError
        id={`${inputID}-error`}
        errors={[draftError ? { message: draftError } : undefined, invalid ? error : undefined]}
      />
    </Field>
  )
}
