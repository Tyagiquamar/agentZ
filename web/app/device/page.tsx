import { Suspense } from "react"
import { and, eq, isNull } from "drizzle-orm"
import { getDB, schema } from "@/db"
import { getEnv } from "@/lib/env"
import { delegationCatalog } from "@/lib/delegation"
import { notFound } from "next/navigation"
import { decideDevice, reviewDevice } from "./actions"
import { loadDevice } from "@/lib/claude-device-review"

export const metadata = { title: "Authorize Claude Code", robots: { index: false, follow: false } }

export default function DevicePage({ searchParams }: PageProps<"/device">) {
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-6 px-6 py-12"
    >
      <p className="text-sm tracking-wide text-muted-foreground uppercase">
        AgentZ / Device authorization
      </p>
      <h1 className="text-3xl font-semibold">Connect Claude Code</h1>
      <Suspense fallback={<p>Loading authorization request...</p>}>
        <DeviceContent searchParams={searchParams} />
      </Suspense>
    </main>
  )
}

async function DeviceContent({ searchParams }: Pick<PageProps<"/device">, "searchParams">) {
  if (!getEnv().ENABLE_CLAUDE_GATEWAY_POC) notFound()
  const search = await searchParams
  const code =
    typeof search.user_code === "string"
      ? search.user_code.replace(/[^a-z0-9]/gi, "").toUpperCase()
      : ""
  if (search.result)
    return (
      <p role="status">
        {search.result === "approved"
          ? "Claude Code is authorized. Return to your terminal to finish signing in."
          : "Access denied. Claude Code will not receive an access token."}
      </p>
    )
  const inputClass = "border-input bg-background w-full rounded-md border px-3 py-2"
  const buttonClass = "bg-primary text-primary-foreground rounded-md px-4 py-2 font-medium"
  if (search.review !== "1")
    return (
      <>
        <p>
          Enter the code shown in your Claude Code terminal. Approve only a device you are signing
          in yourself.
        </p>
        {typeof search.error === "string" && (
          <p role="alert" className="text-destructive">
            {search.error}
          </p>
        )}
        <form action={reviewDevice} className="space-y-4">
          <label htmlFor="user_code" className="block">
            Device code
          </label>
          <input
            id="user_code"
            name="user_code"
            defaultValue={code}
            required
            maxLength={16}
            autoComplete="off"
            className={`${inputClass} font-mono text-xl tracking-widest`}
          />
          <button className={buttonClass}>Confirm code and review access</button>
        </form>
      </>
    )
  const review = await loadReview(code, search.workspace_id)
  if ("error" in review)
    return (
      <p role="alert" className="text-destructive">
        {review.error}
      </p>
    )
  const { device, state, workspaces, workspaceId, catalog } = review
  return (
    <>
      <p>
        Signed in as <span className="font-medium">{state.session.user.email}</span>
      </p>
      <p className="rounded-md border border-border p-4 font-mono text-2xl tracking-widest">
        {code.slice(0, 4)}-{code.slice(4)}
      </p>
      <p>
        Check that this matches your terminal. Claude Code will receive access only to the resources
        you select below.
      </p>
      <p className="text-sm text-muted-foreground">
        Scopes: {device.scope}
        <br />
        Resources: {device.resources?.join(", ")}
      </p>
      <form method="get" className="space-y-3">
        <input type="hidden" name="user_code" value={code} />
        <input type="hidden" name="review" value="1" />
        <label htmlFor="workspace_id" className="block">
          Workspace
        </label>
        <select
          id="workspace_id"
          name="workspace_id"
          defaultValue={workspaceId}
          className={inputClass}
        >
          {workspaces.map((item) => (
            <option key={item.id} value={item.id}>
              {item.organization} / {item.name}
            </option>
          ))}
        </select>
        <button className="rounded-md border border-input px-4 py-2">Load resources</button>
      </form>
      <form action={decideDevice} className="space-y-5">
        <input type="hidden" name="user_code" value={code} />
        <input type="hidden" name="workspace_id" value={workspaceId ?? ""} />
        <fieldset className="space-y-3">
          <legend className="mb-3 font-medium">Allowed models</legend>
          {catalog.models.map((model) => (
            <label key={model.id} className="flex items-start gap-3">
              <input type="checkbox" name="models" value={model.id} className="mt-1" />
              <span>
                {model.model}
                <span className="block text-sm text-muted-foreground">{model.provider}</span>
              </span>
            </label>
          ))}
          {!catalog.models.length && <p>No models available for delegation.</p>}
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="mb-3 font-medium">Allowed MCP connections</legend>
          {catalog.mcp.map((connection) => (
            <label key={connection.id} className="flex items-start gap-3">
              <input type="checkbox" name="mcps" value={connection.id} className="mt-1" />
              <span>
                {connection.connection}
                <span className="block text-sm text-muted-foreground">
                  Tools: {connection.tools.join(", ") || "none"}. Prompts:{" "}
                  {connection.prompts.join(", ") || "none"}. Resources:{" "}
                  {connection.resources.join(", ") || "none"}.
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="flex gap-3">
          <button name="decision" value="approve" className={buttonClass}>
            Approve selected access
          </button>
          <button name="decision" value="deny" className="rounded-md border border-input px-4 py-2">
            Deny access
          </button>
        </div>
      </form>
    </>
  )
}

async function loadReview(code: string, requestedWorkspace: unknown) {
  try {
    const { device, state } = await loadDevice(code)
    const workspaces = await getDB()
      .select({
        id: schema.workspaces.id,
        name: schema.workspaces.name,
        organization: schema.organizations.name,
      })
      .from(schema.workspaces)
      .innerJoin(
        schema.organizations,
        eq(schema.organizations.id, schema.workspaces.organizationId)
      )
      .innerJoin(
        schema.members,
        and(
          eq(schema.members.organizationId, schema.workspaces.organizationId),
          eq(schema.members.userId, state.session.user.id),
          isNull(schema.members.disabledAt)
        )
      )
      .innerJoin(
        schema.organizationDelegation,
        and(
          eq(schema.organizationDelegation.organizationId, schema.workspaces.organizationId),
          eq(schema.organizationDelegation.enabled, true)
        )
      )
      .where(isNull(schema.workspaces.deletedAt))
    const workspaceId =
      typeof requestedWorkspace === "string" ? requestedWorkspace : workspaces[0]?.id
    const workspace = workspaces.find((item) => item.id === workspaceId)
    const [record] = workspace
      ? await getDB().select().from(schema.workspaces).where(eq(schema.workspaces.id, workspace.id))
      : []
    const catalog = record
      ? await delegationCatalog(record.organizationId, record.id, state.session.user)
      : { models: [], mcp: [] }
    return { device, state, workspaces, workspaceId, catalog }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "This request is unavailable." }
  }
}
