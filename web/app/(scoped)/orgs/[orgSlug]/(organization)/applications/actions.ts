"use server"

import { revalidatePath } from "next/cache"
import { cookies, headers } from "next/headers"
import {
  encodeSelectionHistory,
  invalidateSelections,
  readSelectionHistory,
  selectionCookie,
} from "@/lib/page-selection"
import {
  changeOAuthApplication,
  saveOAuthApplication,
  setOrganizationDelegation,
} from "@/data/delegations"
import { z } from "zod"
import type { oauthApplicationInput } from "@/data/schema"
import { isAPIError } from "better-auth/api"

export async function saveApplicationAction(
  organizationId: string,
  input: z.input<typeof oauthApplicationInput>,
  clientId?: string
) {
  try {
    const result = await saveOAuthApplication(organizationId, input, clientId)
    revalidatePath("/orgs", "layout")
    return result
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.issues.map((issue) => issue.message).join("\n") }
    }
    let message = "The application could not be saved."
    if (error instanceof Error && error.message) message = error.message
    if (isAPIError(error)) {
      const body = z
        .object({ error_description: z.string().optional() })
        .safeParse(error.body ?? {})
      if (body.success && body.data.error_description) message = body.data.error_description
    }
    return { error: message }
  }
}

export async function changeApplicationAction(
  organizationId: string,
  clientId: string,
  operation: "delete" | "rotate" | "disable" | "enable"
) {
  try {
    const result = await changeOAuthApplication(organizationId, clientId, operation)
    if (operation === "delete") {
      const jar = await cookies()
      const current = jar.get(selectionCookie)?.value
      let history = readSelectionHistory(
        current === undefined ? undefined : encodeURIComponent(current)
      )
      const previous = encodeSelectionHistory(history)
      // Client IDs are global; the deleted app cannot remain valid in another saved scope.
      for (const scope of new Set(history.map(([scope]) => scope))) {
        history = invalidateSelections(history, scope, [{ app_client_id: clientId }])
      }
      const next = encodeSelectionHistory(history)
      if (next !== previous)
        jar.set(selectionCookie, decodeURIComponent(next), {
          path: "/",
          maxAge: 15552000,
          sameSite: "lax",
          secure: (await headers()).get("x-forwarded-proto") === "https",
        })
    }
    revalidatePath("/orgs", "layout")
    return result
  } catch (error) {
    return {
      error:
        error instanceof Error && error.message
          ? error.message
          : "The application could not be updated.",
    }
  }
}

export async function delegationSettingAction(organizationId: string, enabled: boolean) {
  try {
    await setOrganizationDelegation(organizationId, enabled)
    revalidatePath("/orgs", "layout")
    return { enabled }
  } catch (error) {
    return {
      error:
        error instanceof Error && error.message ? error.message : "The setting could not be saved.",
    }
  }
}
