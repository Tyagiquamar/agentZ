"use client"

import type { ReactNode } from "react"
import { useSelectedLayoutSegments } from "next/navigation"

// Only the actions follow the child route; the header stays in the parent layout.
export function GuardrailHeaderActions({
  connectionAction,
  defaultSection,
  policyAction,
}: {
  connectionAction: ReactNode
  defaultSection: string
  policyAction: ReactNode
}) {
  const segments = useSelectedLayoutSegments()
  const view = segments[0] ?? defaultSection
  if (view === "connections") return connectionAction
  if (view === "policies") return policyAction
  return null
}
