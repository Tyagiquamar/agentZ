"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import {
  createExternalAgent,
  changeExternalAgent,
  listExternalAgents,
} from "@/data/external-agents"
import type { externalAgentInput } from "@/data/schema"

export async function listExternalAgentsAction(orgSlug: string, workspaceSlug: string) {
  const result = await listExternalAgents(orgSlug, workspaceSlug)
  return result?.agents ?? []
}

export async function createExternalAgentAction(
  orgSlug: string,
  workspaceSlug: string,
  input: z.input<typeof externalAgentInput>
) {
  try {
    const result = await createExternalAgent(orgSlug, workspaceSlug, input)
    revalidatePath("/orgs", "layout")
    return result
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The agent could not be created." }
  }
}

export async function changeExternalAgentAction(
  orgSlug: string,
  workspaceSlug: string,
  clientId: string,
  operation: "rename" | "disconnect" | "delete",
  name?: string
) {
  try {
    await changeExternalAgent(orgSlug, workspaceSlug, clientId, operation, name)
    revalidatePath("/orgs", "layout")
    revalidatePath("/settings/applications")
    return { updated: true }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The agent could not be updated." }
  }
}
