import "server-only"

import type { Route } from "next"
import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import { after } from "next/server"
import { RestoredRoute } from "@/components/scope-transition"
import { and, eq, isNull, like, lte, or, sql } from "drizzle-orm"
import { getDB, schema } from "@/db"
import { getAuthSession } from "@/lib/auth"
import { routeFallback } from "@/lib/page-selection"

/** Only successful pages record visits; prefetch and delayed responses cannot replace newer visits. */
export async function RememberRoute() {
  const [requestHeaders, auth] = await Promise.all([headers(), getAuthSession()])
  if (
    !auth ||
    requestHeaders.has("next-router-prefetch") ||
    requestHeaders.get("purpose") === "prefetch"
  )
    return
  const requested = requestHeaders.get("x-agentz-pathname")
  const started = requestHeaders.get("x-agentz-visit-start")
  if (!requested || !started) return
  const url = new URL(requested, "http://agentz.local")
  const parts = url.pathname.split("/")
  const orgSlug = parts[2]
  if (parts[1] !== "orgs" || !orgSlug) return
  const workspaceSlug =
    parts[3] === "workspaces" && parts[4] !== "new" && parts[4] !== "manage" ? parts[4] : undefined
  let route = url.pathname
  const root = workspaceSlug ? `/orgs/${orgSlug}/workspaces/${workspaceSlug}` : `/orgs/${orgSlug}`
  if (route.startsWith(`${root}/event-trail/`)) route = `${root}/event-trail`
  const visited = new Date(started)
  const userId = auth.session.user.id

  after(async () => {
    const db = getDB()
    // The same statement checks the scope, including a workspace deleted while rendering.
    const visit = db
      .select({
        userId: sql<string>`${userId}`.as("user_id"),
        organizationId: schema.organizations.id,
        workspaceId: schema.workspaces.id,
        route: sql<string>`${route}`.as("route"),
        updatedAt: sql<Date>`${visited}`.as("updated_at"),
      })
      .from(schema.organizations)
      .leftJoin(
        schema.workspaces,
        and(
          eq(schema.workspaces.organizationId, schema.organizations.id),
          eq(schema.workspaces.slug, workspaceSlug ?? "")
        )
      )
      .where(
        and(
          eq(schema.organizations.slug, orgSlug),
          workspaceSlug
            ? and(eq(schema.workspaces.slug, workspaceSlug), isNull(schema.workspaces.deletedAt))
            : undefined
        )
      )
    await db
      .insert(schema.lastAccessibleContexts)
      .select(visit)
      .onConflictDoUpdate({
        target: [
          schema.lastAccessibleContexts.userId,
          schema.lastAccessibleContexts.organizationId,
        ],
        set: { route, workspaceId: sql`excluded.workspace_id`, updatedAt: visited },
        setWhere: lte(schema.lastAccessibleContexts.updatedAt, visited),
      })
  })
  if (url.searchParams.has("__restore") || url.searchParams.has("__recovered"))
    return <RestoredRoute />
  return null
}

/** Clear only this user's matching destination, retaining a timestamp against late visit writes. */
export async function invalidateRoute(path: string, before = new Date()) {
  const auth = await getAuthSession()
  const fallback = routeFallback(path)
  if (!auth) return fallback
  const parts = path.split("/")
  const db = getDB()
  const organization = db
    .select({ id: schema.organizations.id })
    .from(schema.organizations)
    .where(eq(schema.organizations.slug, parts[2] ?? ""))
  // LIKE metacharacters can occur in resource IDs and must remain literal.
  const descendants =
    path.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_") + "/%"
  await db
    .update(schema.lastAccessibleContexts)
    .set({
      route: fallback,
      updatedAt: new Date(),
      ...(!fallback.includes("/workspaces/") ? { workspaceId: null } : {}),
    })
    .where(
      and(
        eq(schema.lastAccessibleContexts.userId, auth.session.user.id),
        eq(schema.lastAccessibleContexts.organizationId, organization),
        lte(schema.lastAccessibleContexts.updatedAt, before),
        or(
          eq(schema.lastAccessibleContexts.route, path),
          like(schema.lastAccessibleContexts.route, descendants)
        )
      )
    )
  return fallback
}

/** Recover at the resource lookup so automatic restoration never renders a missing page. */
export async function missingRoute(path?: string): Promise<never> {
  const requestHeaders = await headers()
  const url = new URL(requestHeaders.get("x-agentz-pathname") ?? "/orgs", "http://agentz.local")
  if (requestHeaders.has("next-router-prefetch") || requestHeaders.get("purpose") === "prefetch")
    notFound()
  const visited = new Date(requestHeaders.get("x-agentz-visit-start") ?? Date.now())
  const fallback = await invalidateRoute(path ?? url.pathname, visited)
  if (url.searchParams.has("__restore")) redirect(`${fallback}?__recovered=1` as Route)
  notFound()
}
