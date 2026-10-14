import { getEnv } from "@/lib/env"

// Codex reserves Authorization for primary credentials and delivers native
// gateway OAuth through a configured secondary header. AgentZ owns that token.
async function handleCodexRequest(request: Request): Promise<Response> {
  if (!getEnv().ENABLE_CODEX_GATEWAY_POC) return new Response(null, { status: 404 })
  const url = new URL(request.url)
  const path = url.pathname.slice("/codex".length)
  const target = {
    "/v1/responses": "/api/inference/v1/responses",
    "/v1/models": "/api/inference/v1/models",
  }[path]
  if (!target) return new Response(null, { status: 404 })
  if (request.method !== (path === "/v1/models" ? "GET" : "POST"))
    return new Response(null, { status: 405 })
  const authorization = request.headers.get("x-agentz-authorization")
  if (!authorization?.startsWith("Bearer ") || authorization.length <= 7)
    return errorResponse(401, "invalid_token", "Sign in to AgentZ before using this gateway.")
  const gateway = process.env.INTERNAL_GATEWAY_BASE_URL ?? process.env.GATEWAY_BASE_URL
  if (!gateway) return errorResponse(503, "service_unavailable", "AgentZ gateway is unavailable.")
  const headers = new Headers(request.headers)
  for (const key of [
    "authorization",
    "x-agentz-authorization",
    "cookie",
    "host",
    "connection",
    "content-length",
    "x-api-key",
    "chatgpt-account-id",
    "origin",
  ])
    headers.delete(key)
  headers.set("authorization", authorization)
  headers.set("accept-encoding", "identity")
  let upstream: Response
  try {
    upstream = await fetch(new URL(`${target}${url.search}`, gateway), {
      method: request.method,
      headers,
      body: request.method === "POST" ? request.body : undefined,
      ...(request.method === "POST" ? { duplex: "half" } : {}),
      signal: request.signal,
      cache: "no-store",
      redirect: "manual",
    })
  } catch {
    return errorResponse(503, "service_unavailable", "AgentZ gateway is unavailable.")
  }
  const responseHeaders = new Headers(upstream.headers)
  for (const key of ["content-encoding", "content-length", "connection", "set-cookie"])
    responseHeaders.delete(key)
  responseHeaders.set("cache-control", "no-store, no-transform")
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders })
}

function errorResponse(status: number, code: string, message: string) {
  return Response.json(
    { error: { message, type: code, code, param: null } },
    { status, headers: { "Cache-Control": "no-store" } }
  )
}

export { handleCodexRequest as GET, handleCodexRequest as POST }
