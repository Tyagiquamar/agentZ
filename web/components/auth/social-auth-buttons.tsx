"use client"

import { LoadingButton } from "@/components/interior/loading-button"
import { GitHubDark, GitHubLight, Google } from "@ridemountainpig/svgl-react"
import type { AuthPath, SocialProvider } from "@/app/(auth)/shared"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { CircleAlert } from "lucide-react"

type SocialAuthButtonsProps = {
  authPath: AuthPath
  disabled?: boolean
  errors?: Partial<Record<SocialProvider, string>>
  hiddenFields?: Record<string, string | undefined>
  pendingProvider?: SocialProvider
  providers: SocialProvider[]
  returnTo?: string
  submitLabel: "Sign in" | "Sign up"
  onPendingChangeAction?: (provider: SocialProvider) => void
  actions: Record<SocialProvider, (formData: FormData) => Promise<void>>
}

export function SocialAuthButtons({
  actions,
  authPath,
  disabled = false,
  errors,
  hiddenFields,
  onPendingChangeAction,
  pendingProvider,
  providers,
  returnTo,
  submitLabel,
}: SocialAuthButtonsProps) {
  return (
    <div className="flex flex-col gap-3">
      {providers.map((provider) => (
        <form
          key={provider}
          action={actions[provider]}
          className="flex flex-col gap-2"
          onSubmitCapture={() => {
            onPendingChangeAction?.(provider)
          }}
        >
          <input type="hidden" name="authPath" value={authPath} />
          {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
          {hiddenFields
            ? Object.entries(hiddenFields).map(([name, value]) =>
                value ? <input key={name} type="hidden" name={name} value={value} /> : null
              )
            : null}
          <LoadingButton
            pending={pendingProvider === provider}
            type="submit"
            variant="outline"
            size="lg"
            className="w-full gap-3"
            aria-invalid={errors?.[provider] ? "true" : undefined}
            disabled={disabled}
          >
            {provider === "github" ? (
              <>
                <GitHubLight data-icon="inline-start" className="dark:hidden" />
                <GitHubDark data-icon="inline-start" className="hidden dark:block" />
              </>
            ) : (
              <Google data-icon="inline-start" />
            )}
            {submitLabel} with {provider === "github" ? "GitHub" : "Google"}
          </LoadingButton>
          {errors?.[provider] ? (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{errors[provider]}</AlertDescription>
            </Alert>
          ) : null}
        </form>
      ))}
    </div>
  )
}
