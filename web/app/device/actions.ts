"use server"

import { randomUUID } from "node:crypto"
import { and, eq, gt, isNull } from "drizzle-orm"
import { redirect } from "next/navigation"
import { getAuth } from "@/lib/auth"
import { getDB, schema } from "@/db"
import { loadDevice } from "@/lib/claude-device-review"
import { checkDelegationSelection, delegationCatalog } from "@/lib/delegation"
import type { DelegationCatalog } from "@/lib/gateway/client"

/** reviewDevice requires a signed-in user to claim and confirm the device code. */
export async function reviewDevice(form: FormData) {
  const code = String(form.get("user_code") ?? "")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase()
  redirect(`/device?user_code=${encodeURIComponent(code)}&review=1`)
}

/** decideDevice stores the resource snapshot and approval in one transaction. */
export async function decideDevice(form: FormData) {
  const code = String(form.get("user_code") ?? "")
  let result = "approved"
  try {
    const { device, state } = await loadDevice(code)
    if (form.get("decision") === "deny") {
      await getAuth().api.deviceDeny({ body: { userCode: code }, headers: state.requestHeaders })
      result = "denied"
    } else {
      const workspaceId = String(form.get("workspace_id") ?? "")
      const [workspace] = await getDB()
        .select()
        .from(schema.workspaces)
        .where(and(eq(schema.workspaces.id, workspaceId), isNull(schema.workspaces.deletedAt)))
      if (!workspace) throw new Error("Select an available workspace.")
      const catalog = await delegationCatalog(
        workspace.organizationId,
        workspace.id,
        state.session.user
      )
      const models = new Set(form.getAll("models").map(String))
      const mcps = new Set(form.getAll("mcps").map(String))
      const selection: DelegationCatalog = {
        models: catalog.models.filter((model) => models.has(model.id)),
        mcp: catalog.mcp.filter((connection) => mcps.has(connection.id)),
      }
      if (!selection.models.length) throw new Error("Select at least one model for Claude Code.")
      if (selection.models.length !== models.size || selection.mcp.length !== mcps.size)
        throw new Error("A selected resource is unavailable. Reload this request.")
      await checkDelegationSelection(
        workspace.organizationId,
        selection,
        state.session.user,
        "consent"
      )
      await getDB().transaction(async (tx) => {
        const [client] = await tx
          .select()
          .from(schema.oauthClients)
          .where(eq(schema.oauthClients.clientId, device.clientId!))
          .for("update")
        if (!client || client.disabled) throw new Error("Claude Code access is disabled.")
        const [pending] = await tx
          .select()
          .from(schema.deviceCodes)
          .where(
            and(
              eq(schema.deviceCodes.id, device.id),
              eq(schema.deviceCodes.status, "pending"),
              gt(schema.deviceCodes.expiresAt, new Date()),
              eq(schema.deviceCodes.sessionId, state.session.session.id)
            )
          )
          .for("update")
        if (!pending) throw new Error("This code expired or was already used.")
        const grantId = randomUUID()
        await tx.insert(schema.delegationGrants).values({
          id: grantId,
          clientId: client.clientId,
          userId: state.session.user.id,
          organizationId: workspace.organizationId,
          scopes: (device.scope ?? "").split(/\s+/),
          resources: device.resources ?? [],
          selection,
          approvedAt: new Date(),
        })
        await tx
          .update(schema.deviceCodes)
          .set({ referenceId: grantId, status: "approved" })
          .where(eq(schema.deviceCodes.id, device.id))
      })
    }
  } catch (error) {
    redirect(
      `/device?user_code=${encodeURIComponent(code)}&error=${encodeURIComponent(
        error instanceof Error ? error.message : "Device authorization failed."
      )}`
    )
  }
  redirect(`/device?result=${result}`)
}
