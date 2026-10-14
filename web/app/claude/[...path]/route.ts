import { getAuth } from "@/lib/auth"
import { getEnv } from "@/lib/env"
import { getDB, schema } from "@/db"
import { and, eq } from "drizzle-orm"
import { createHash } from "node:crypto"
import { createLocalJWKSet, jwtVerify } from "jose"

const noStore = { "Cache-Control": "no-store" }

/** handleClaudeRequest adapts Claude's client-less gateway contract to registered OAuth. */
async function handleClaudeRequest(request: Request): Promise<Response> {
  const env = getEnv()
  if (!env.ENABLE_CLAUDE_GATEWAY_POC) return new Response(null, { status: 404 })
  const path = new URL(request.url).pathname.slice("/claude".length)
  const base = `${env.BETTER_AUTH_URL}/claude`
  if (path === "/.well-known/oauth-authorization-server" && request.method === "GET") {
    return Response.json(
      {
        issuer: env.BETTER_AUTH_URL,
        device_authorization_endpoint: `${base}/oauth/device_authorization`,
        token_endpoint: `${base}/oauth/token`,
        revocation_endpoint: `${base}/oauth/revoke`,
        grant_types_supported: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
      },
      { headers: noStore }
    )
  }
  const endpoint = {
    "/oauth/device_authorization": "/device/code",
    "/oauth/token": "/oauth2/token",
    "/oauth/revoke": "/oauth2/revoke",
  }[path]
  if (endpoint) {
    if (request.method !== "POST") return new Response(null, { status: 405 })
    if (Number(request.headers.get("content-length")) > 8192)
      return new Response(null, { status: 413 })
    const raw = await request.text()
    if (raw.length > 8192) return new Response(null, { status: 413 })
    const incoming = new URLSearchParams(raw)
    const body = new URLSearchParams({ client_id: env.CLAUDE_GATEWAY_CLIENT_ID })
    let userId: string | null = null
    let revokedGrant: { id: string; userId: string } | undefined
    if (endpoint === "/device/code") {
      body.set("scope", "openid profile email offline_access inference:use mcp:use")
      body.append("resource", `${env.BETTER_AUTH_URL}/api/inference/v1`)
      body.append("resource", `${env.BETTER_AUTH_URL}/api/mcp`)
    } else {
      for (const key of [
        "grant_type",
        "device_code",
        "refresh_token",
        "token",
        "token_type_hint",
      ]) {
        const value = incoming.get(key)
        if (value !== null) body.set(key, value)
      }
      if (body.has("device_code")) {
        const [device] = await getDB()
          .select({ userId: schema.deviceCodes.userId })
          .from(schema.deviceCodes)
          .where(
            and(
              eq(schema.deviceCodes.deviceCode, body.get("device_code")!),
              eq(schema.deviceCodes.clientId, env.CLAUDE_GATEWAY_CLIENT_ID)
            )
          )
        userId = device?.userId ?? null
      }
      if (endpoint === "/oauth2/revoke") {
        const token = incoming.get("token") ?? ""
        const [refresh] = await getDB()
          .select()
          .from(schema.oauthRefreshTokens)
          .where(
            and(
              eq(
                schema.oauthRefreshTokens.token,
                createHash("sha256").update(token).digest("base64url")
              ),
              eq(schema.oauthRefreshTokens.clientId, env.CLAUDE_GATEWAY_CLIENT_ID)
            )
          )
        if (refresh?.referenceId) revokedGrant = { id: refresh.referenceId, userId: refresh.userId }
        if (!revokedGrant) {
          try {
            const { payload } = await jwtVerify(
              token,
              createLocalJWKSet(await getAuth().api.getJwks()),
              {
                issuer: env.BETTER_AUTH_URL,
                audience: `${env.BETTER_AUTH_URL}/api/inference/v1`,
                algorithms: ["ES256"],
              }
            )
            if (
              payload.client_id === env.CLAUDE_GATEWAY_CLIENT_ID &&
              typeof payload.agentz_grant_id === "string" &&
              payload.sub
            )
              revokedGrant = { id: payload.agentz_grant_id, userId: payload.sub }
          } catch {
            // RFC 7009 treats unknown and expired tokens as already revoked.
          }
        }
        if (revokedGrant)
          await getDB()
            .update(schema.delegationGrants)
            .set({ revokedAt: new Date() })
            .where(
              and(
                eq(schema.delegationGrants.id, revokedGrant.id),
                eq(schema.delegationGrants.userId, revokedGrant.userId),
                eq(schema.delegationGrants.clientId, env.CLAUDE_GATEWAY_CLIENT_ID)
              )
            )
      }
    }
    const response = await getAuth().handler(
      new Request(`${env.BETTER_AUTH_URL}/api/auth${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": request.headers.get("user-agent") ?? "claude-code",
          "X-Forwarded-For": request.headers.get("x-forwarded-for") ?? "127.0.0.1",
        },
        body,
      })
    )
    const data = await response.json()
    if (response.status === 429 && endpoint !== "/oauth2/revoke") {
      return Response.json(
        {
          error: "slow_down",
          error_description: "Too many sign-in requests. Wait before retrying.",
        },
        {
          status: 429,
          headers: { ...noStore, "Retry-After": response.headers.get("retry-after") ?? "5" },
        }
      )
    }
    if (endpoint === "/oauth2/revoke") {
      if (revokedGrant) {
        for (const table of [schema.oauthRefreshTokens, schema.oauthAccessTokens]) {
          await getDB()
            .delete(table)
            .where(
              and(
                eq(table.referenceId, revokedGrant.id),
                eq(table.clientId, env.CLAUDE_GATEWAY_CLIENT_ID)
              )
            )
        }
      }
      return new Response(null, { status: 200, headers: noStore })
    }
    if (response.ok && userId && endpoint === "/oauth2/token") {
      const [user] = await getDB()
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
      if (user) data.email = user.email
    }
    const status =
      body.get("grant_type") === "refresh_token" && data.error === "invalid_grant"
        ? 401
        : response.status
    return Response.json(data, { status, headers: noStore })
  }

  const gateway = process.env.INTERNAL_GATEWAY_BASE_URL ?? process.env.GATEWAY_BASE_URL
  if (!gateway) return anthropicError(503, "api_error", "AgentZ gateway is unavailable.")
  const target = path === "/mcp" ? "/api/mcp" : `/api/inference${path}`
  const inference = ["/v1/messages", "/v1/messages/count_tokens", "/v1/models"].includes(path)
  const optional = ["/managed/settings", "/v1/metrics", "/v1/logs", "/v1/traces"].includes(path)
  if (!inference && path !== "/mcp" && !optional) return new Response(null, { status: 404 })
  const headers = new Headers(request.headers)
  for (const key of ["cookie", "host", "connection", "x-api-key", "content-length", "origin"])
    headers.delete(key)
  headers.set("accept-encoding", "identity")
  let upstream: Response
  try {
    upstream = await fetch(
      new URL(
        optional ? "/api/inference/v1/models" : `${target}${new URL(request.url).search}`,
        gateway
      ),
      {
        method: optional ? "GET" : request.method,
        headers,
        body: !optional && request.method === "POST" ? request.body : undefined,
        // Node requires duplex when streaming an incoming request body.
        ...(!optional && request.method === "POST" ? { duplex: "half" } : {}),
        cache: "no-store",
        redirect: "manual",
        signal: request.signal,
      }
    )
  } catch {
    return anthropicError(503, "api_error", "AgentZ gateway is unavailable.")
  }
  if (!upstream.ok) {
    const data = await upstream.json().catch(() => null)
    const status =
      upstream.status === 403 && data?.error?.code === "access_denied"
        ? 401
        : upstream.status === 404 && data?.error?.code === "model_not_found"
          ? 400
          : upstream.status
    return anthropicError(
      status,
      status === 401
        ? "authentication_error"
        : status === 403
          ? "permission_error"
          : status === 429
            ? "rate_limit_error"
            : status < 500
              ? "invalid_request_error"
              : "api_error",
      data?.error?.message ?? "AgentZ could not complete this request."
    )
  }
  if (optional) {
    await upstream.body?.cancel()
    return new Response(null, {
      status: path === "/managed/settings" ? 404 : 200,
      headers: noStore,
    })
  }
  if (path === "/v1/models") {
    const models = (await upstream.json()) as {
      data: { id: string; supported_endpoints: string[] }[]
    }
    return Response.json(
      {
        data: models.data
          .filter((model) => model.supported_endpoints.includes("/messages"))
          .map((model) => ({
            id: model.id.split("/").at(-1),
            display_name: model.id.split("/").at(-1),
          })),
        has_more: false,
      },
      { headers: noStore }
    )
  }
  const responseHeaders = new Headers(upstream.headers)
  responseHeaders.delete("content-encoding")
  responseHeaders.delete("content-length")
  responseHeaders.delete("set-cookie")
  responseHeaders.set("Cache-Control", "no-store, no-transform")
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders })
}

function anthropicError(status: number, type: string, message: string): Response {
  return Response.json(
    { type: "error", error: { type, message } },
    {
      status,
      headers: {
        ...noStore,
        ...(status === 401 || status === 403 ? { "x-should-retry": "false" } : {}),
      },
    }
  )
}

export { handleClaudeRequest as GET, handleClaudeRequest as POST, handleClaudeRequest as DELETE }
