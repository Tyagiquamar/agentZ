"use server"

import { and, eq, isNull } from "drizzle-orm"
import { getDB, schema } from "@/db"
import { getAuthSession } from "@/lib/auth"
import {
  delegationCatalog,
  delegationRequest,
  externalAgentAccess,
  type DelegationRequest,
} from "@/lib/delegation"
import { approveDelegation, denyDeviceDelegation } from "@/data/delegations"
import { zDelegationCatalog } from "@/lib/gateway/client/zod.gen"
import type { DelegationCatalog } from "@/lib/gateway/client"

export async function delegationWorkspaceAction(
  request: DelegationRequest,
  organizationId: string,
  workspaceId: string
) {
  const session = await getAuthSession()
  if (!session) throw new Error("Sign in to continue.")
  const transaction = await delegationRequest(
    request,
    session.session.user.id,
    session.session.session.id
  )
  const agent = await externalAgentAccess(transaction.clientId, session.session.user)
  if (agent && (agent.organizationId !== organizationId || agent.workspaceId !== workspaceId))
    throw new Error("This agent is restricted to its owner's workspace.")
  const [membership] = await getDB()
    .select({ id: schema.members.id })
    .from(schema.members)
    .innerJoin(
      schema.organizationDelegation,
      and(
        eq(schema.organizationDelegation.organizationId, schema.members.organizationId),
        eq(schema.organizationDelegation.enabled, true)
      )
    )
    .where(
      and(
        eq(schema.members.organizationId, organizationId),
        eq(schema.members.userId, session.session.user.id),
        isNull(schema.members.disabledAt)
      )
    )
  if (!membership) throw new Error("Resource delegation is unavailable for this organization.")
  return delegationCatalog(organizationId, workspaceId, session.session.user)
}

export async function approveConsentAction(
  request: DelegationRequest,
  organizationId: string | null,
  selection: DelegationCatalog
) {
  try {
    await approveDelegation(request, organizationId, zDelegationCatalog.parse(selection))
    return { approved: true }
  } catch (error) {
    return {
      error:
        error instanceof Error && error.message
          ? error.message
          : "Access could not be granted. Start again from the application.",
    }
  }
}

export async function denyDeviceConsentAction(
  request: Extract<DelegationRequest, { type: "device_code" }>
) {
  try {
    await denyDeviceDelegation(request)
    return { denied: true }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "This device request could not be declined.",
    }
  }
}
