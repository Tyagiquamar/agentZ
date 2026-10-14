import "server-only"

import { and, eq, gt, isNull } from "drizzle-orm"
import { getAuth, getAuthSession } from "@/lib/auth"
import { getDB, schema } from "@/db"
import { getEnv } from "@/lib/env"

/** loadDevice binds the review to the browser session that started it. */
export async function loadDevice(code: string) {
  if (!getEnv().ENABLE_CLAUDE_GATEWAY_POC) throw new Error("Claude gateway PoC is disabled.")
  const state = await getAuthSession()
  if (!state) throw new Error("Sign in to authorize Claude Code.")
  await getAuth().api.deviceVerify({ query: { user_code: code }, headers: state.requestHeaders })
  const [device] = await getDB()
    .select()
    .from(schema.deviceCodes)
    .where(
      and(
        eq(schema.deviceCodes.userCode, code),
        eq(schema.deviceCodes.userId, state.session.user.id),
        eq(schema.deviceCodes.clientId, getEnv().CLAUDE_GATEWAY_CLIENT_ID),
        gt(schema.deviceCodes.expiresAt, new Date()),
        eq(schema.deviceCodes.status, "pending")
      )
    )
  if (!device || (device.sessionId && device.sessionId !== state.session.session.id))
    throw new Error("This code expired, was already used, or belongs to another browser session.")
  if (!device.sessionId) {
    const [claimed] = await getDB()
      .update(schema.deviceCodes)
      .set({ sessionId: state.session.session.id })
      .where(and(eq(schema.deviceCodes.id, device.id), isNull(schema.deviceCodes.sessionId)))
      .returning()
    if (!claimed) throw new Error("This code is already being reviewed in another session.")
  }
  return { device, state }
}
