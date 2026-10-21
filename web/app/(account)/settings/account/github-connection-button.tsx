"use client"

import { LoadingButton } from "@/components/interior/loading-button"
import { useFormStatus } from "react-dom"
import { GitHubDark, GitHubLight } from "@ridemountainpig/svgl-react"
import { Unplug } from "lucide-react"

export function GitHubConnectionButton({
  connected = false,
  disabled = false,
}: {
  connected?: boolean
  disabled?: boolean
}) {
  const { pending } = useFormStatus()
  const label = connected ? "Disconnect" : "Connect GitHub"
  const pendingLabel = connected ? "Disconnecting..." : "Connecting..."

  return (
    <LoadingButton pending={pending} disabled={disabled || pending} variant="outline" type="submit">
      {connected ? (
        <Unplug data-icon="inline-start" aria-hidden="true" />
      ) : (
        <>
          <GitHubLight data-icon="inline-start" className="dark:hidden" aria-hidden="true" />
          <GitHubDark data-icon="inline-start" className="hidden dark:block" aria-hidden="true" />
        </>
      )}
      {pending ? pendingLabel : label}
    </LoadingButton>
  )
}
