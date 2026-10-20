"use client"

import { LoadingButton } from "@/components/interior/loading-button"
import Image from "next/image"
import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { TWO_FACTOR_ERROR_CODES } from "better-auth/plugins/two-factor"
import { Controller, useForm } from "react-hook-form"
import { ArrowRight } from "lucide-react"
import * as z from "zod"
import { authClient } from "@/lib/auth-client"
import { signInURL } from "@/lib/sign-in-redirect"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldContent, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { SegmentedControl } from "@/components/interior/segmented-control"
import { OtpInput } from "@/components/interior/otp-input"

type TwoFactorChallengeProps = {
  returnTo: string
  oauth: boolean
}

type ChallengeMode = "totp" | "backup"

const invalidChallengeMessages = new Set([
  TWO_FACTOR_ERROR_CODES.INVALID_TWO_FACTOR_COOKIE.message,
  TWO_FACTOR_ERROR_CODES.TWO_FACTOR_NOT_ENABLED.message,
  TWO_FACTOR_ERROR_CODES.TOTP_NOT_ENABLED.message,
  TWO_FACTOR_ERROR_CODES.BACKUP_CODES_NOT_ENABLED.message,
])

const challengeSchemas = {
  totp: z.object({
    code: z
      .string({ error: "Enter a valid 6-digit code" })
      .trim()
      .regex(/^\d{6}$/, "Enter a valid 6-digit code"),
    trustDevice: z.boolean({ error: "Remember-device selection is required" }),
  }),
  backup: z.object({
    code: z.string({ error: "Enter a backup code" }).trim().min(1, "Enter a backup code"),
    trustDevice: z.boolean({ error: "Remember-device selection is required" }),
  }),
}

type TwoFactorChallengeValues = z.infer<(typeof challengeSchemas)["totp"]>

export function TwoFactorChallenge({ returnTo, oauth }: TwoFactorChallengeProps) {
  const [mode, setMode] = React.useState<ChallengeMode>("totp")
  const [pending, setPending] = React.useState(false)
  const [redirecting, setRedirecting] = React.useState(false)
  const locked = pending || redirecting
  const form = useForm<TwoFactorChallengeValues>({
    resolver: zodResolver(challengeSchemas[mode]),
    defaultValues: {
      code: "",
      trustDevice: false,
    },
  })

  async function submit(values: TwoFactorChallengeValues) {
    setPending(true)
    form.clearErrors("code")
    let redirected = false

    try {
      const result =
        mode === "totp"
          ? await authClient.twoFactor.verifyTotp({
              code: values.code,
              trustDevice: values.trustDevice,
            })
          : await authClient.twoFactor.verifyBackupCode({
              code: values.code,
              trustDevice: values.trustDevice,
            })

      if (result.error) {
        const message = result.error.message ?? "Sign-in could not be completed. Try again."

        if (
          message === TWO_FACTOR_ERROR_CODES.INVALID_CODE.message ||
          message === TWO_FACTOR_ERROR_CODES.INVALID_BACKUP_CODE.message
        ) {
          form.setError("code", {
            type: "server",
            message,
          })
          return
        }

        if (invalidChallengeMessages.has(message)) {
          redirected = true
          setRedirecting(true)
          window.location.replace(
            oauth
              ? `/signin${window.location.search}&error=session_expired`
              : signInURL({ error: "session_expired", returnTo })
          )
          return
        }

        form.setError("code", {
          type: "server",
          message: "Sign-in could not be completed. Try again.",
        })
        return
      }

      redirected = true
      setRedirecting(true)
      if (!oauth) window.location.replace(returnTo)
    } catch {
      form.setError("code", {
        type: "server",
        message: "Sign-in could not be completed. Try again.",
      })
    } finally {
      if (redirected) {
        return
      }
      setPending(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-8 pt-10">
      <div className="flex items-center justify-center gap-3">
        <Image
          src="/agentz-logo.svg"
          alt="AgentZ logo"
          width={46}
          height={40}
          className="h-10 w-auto"
        />
        <span className="text-3xl font-semibold tracking-tight text-foreground">AgentZ</span>
      </div>

      <section className="flex flex-col gap-5">
        <form
          className="flex flex-col gap-5"
          method="post"
          onSubmit={form.handleSubmit(submit)}
          aria-busy={locked}
          noValidate
        >
          <SegmentedControl<ChallengeMode>
            label="Verification method"
            className="h-9 w-full"
            value={mode}
            disabled={locked}
            onValueChange={(next) => {
              setMode(next)
              form.resetField("code")
              form.clearErrors("code")
            }}
            options={[
              { value: "totp", label: "Authenticator code" },
              { value: "backup", label: "Backup code" },
            ]}
          />

          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.code}>
              <FieldLabel htmlFor="two-factor-signin-code" required>
                {mode === "totp" ? "6-digit code" : "Backup code"}
              </FieldLabel>
              {mode === "totp" ? (
                <Controller
                  name="code"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <OtpInput
                      {...field}
                      id="two-factor-signin-code"
                      disabled={locked}
                      aria-invalid={fieldState.invalid}
                      aria-required="true"
                      aria-describedby="two-factor-signin-code-error"
                    />
                  )}
                />
              ) : (
                <Input
                  id="two-factor-signin-code"
                  autoComplete="off"
                  placeholder="Enter a backup code"
                  disabled={locked}
                  aria-invalid={!!form.formState.errors.code}
                  aria-required="true"
                  {...form.register("code")}
                  aria-describedby="two-factor-signin-code-error"
                />
              )}
              {form.formState.errors.code ? (
                <FieldError id="two-factor-signin-code-error">
                  {form.formState.errors.code.message}
                </FieldError>
              ) : null}
            </Field>

            <Field orientation="horizontal">
              <Controller
                name="trustDevice"
                control={form.control}
                render={({ field }) => (
                  <>
                    <Checkbox
                      id="trust-device"
                      checked={field.value}
                      disabled={locked}
                      onCheckedChange={(checked) => {
                        field.onChange(checked === true)
                      }}
                    />
                    <FieldContent>
                      <FieldLabel htmlFor="trust-device">
                        Remember this device for 30 days
                      </FieldLabel>
                    </FieldContent>
                  </>
                )}
              />
            </Field>
          </FieldGroup>

          <div className="flex flex-col gap-3">
            <LoadingButton pending={pending} type="submit" size="lg" disabled={locked}>
              Continue
              <ArrowRight data-icon="inline-end" />
            </LoadingButton>
            <Button
              type="button"
              variant="ghost"
              disabled={locked}
              onClick={() => {
                setRedirecting(true)
                window.location.replace(
                  oauth ? `/signin${window.location.search}` : signInURL({ returnTo })
                )
              }}
            >
              Back
            </Button>
          </div>
        </form>
      </section>
    </div>
  )
}
