import "dotenv/config"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { decodeJwt, importJWK, SignJWT } from "jose"
import { symmetricDecrypt } from "better-auth/crypto"
import { Client } from "pg"
import { getAuth } from "../lib/auth"

// This exercises the live gateway, identity database and Anthropic provider.
// Run with Bun's react-server condition and an independently approved device
// token file. Do not share a refresh token with an active native CLI process.
const file = process.argv[2]
const report = process.argv[3]
const databaseURL = process.env.DATABASE_URL
const base = `${process.env.BETTER_AUTH_URL}/claude`
if (!file || !databaseURL || !new URL(databaseURL).pathname.includes("poc"))
  throw new Error("Supply an approved token file and use a dedicated PoC database.")
let tokens = JSON.parse(readFileSync(file, "utf8")) as {
  access_token: string
  refresh_token: string
}
const claims = decodeJwt(tokens.access_token)
const grantId = claims.agentz_grant_id
assert.equal(typeof grantId, "string")
const results: { name: string; status: number; duration_ms: number }[] = []
const db = new Client({ connectionString: databaseURL })
await db.connect()
const signingRow = (
  await db.query("select id,private_key,alg from jwks order by created_at desc limit 1")
).rows[0]
const privateJWK = await symmetricDecrypt({
  key: (await getAuth().$context).secretConfig,
  data: JSON.parse(signingRow.private_key),
})
const signingKey = await importJWK(JSON.parse(privateJWK), signingRow.alg)

async function request(
  path: string,
  options: RequestInit = {},
  token: string | null = tokens.access_token
) {
  const headers = new Headers(options.headers)
  if (token) headers.set("Authorization", `Bearer ${token}`)
  const started = performance.now()
  const response = await fetch(`${base}${path}`, { ...options, headers, redirect: "manual" })
  return { response, started }
}

async function check(
  name: string,
  path: string,
  expected: number,
  options: RequestInit = {},
  token: string | null = tokens.access_token
) {
  const { response, started } = await request(path, options, token)
  const text = await response.text()
  assert.equal(response.status, expected, `${name}: ${text}`)
  results.push({
    name,
    status: response.status,
    duration_ms: Math.round(performance.now() - started),
  })
  console.log(`PASS ${name}: HTTP ${response.status}`)
  return text ? JSON.parse(text) : null
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
  body: JSON.stringify(body),
})
const form = (body: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(body),
})
const model = "claude-haiku-4-5-20251001"
const message = {
  model,
  max_tokens: 32,
  messages: [{ role: "user", content: "Reply with exactly AGENTZ_POC_OK" }],
}

try {
  const metadata = await check(
    "unauthenticated discovery",
    "/.well-known/oauth-authorization-server",
    200,
    {},
    null
  )
  assert.equal(metadata.token_endpoint, `${base}/oauth/token`)
  await check("missing bearer", "/v1/models", 401, {}, null)
  await check("malformed bearer", "/v1/models", 401, {}, "invalid")
  await check("modified signature", "/v1/models", 401, {}, tokens.access_token.slice(0, -3) + "abc")
  for (const [name, overrides, expected] of [
    ["expired bearer", { exp: 1 }, 401],
    ["wrong issuer", { iss: "https://other.example" }, 401],
    ["wrong audience", { aud: "another-api" }, 401],
    ["missing inference scope", { scope: "openid mcp:use" }, 403],
  ] as const) {
    const signed = await new SignJWT({ ...claims, ...overrides })
      .setProtectedHeader({ alg: signingRow.alg, kid: signingRow.id, typ: "at+jwt" })
      .sign(signingKey)
    await check(name, "/v1/models", expected, {}, signed)
  }
  await check("authorized model discovery", "/v1/models", 200)
  await check("managed policy fallback", "/managed/settings", 404)
  await check("unauthenticated telemetry", "/v1/metrics", 401, { method: "POST", body: "{}" }, null)
  await check("authenticated telemetry", "/v1/metrics", 200, { method: "POST", body: "{}" })
  await check("unknown route", "/v1/unknown", 404)
  await check("wrong Messages method", "/v1/messages", 405)
  await check("malformed Messages JSON", "/v1/messages", 400, { ...json(null), body: "{" })
  await check("duplicate model", "/v1/messages", 400, {
    ...json(null),
    body: `{"model":"${model}","model":"other"}`,
  })
  await check(
    "unselected model",
    "/v1/messages",
    400,
    json({ ...message, model: "claude-opus-unselected" })
  )
  await check("hosted MCP denied", "/v1/messages", 400, json({ ...message, mcp_servers: [] }))
  await check(
    "provider file denied",
    "/v1/messages",
    400,
    json({
      ...message,
      messages: [
        {
          role: "user",
          content: [{ type: "document", source: { type: "file", file_id: "private-file" } }],
        },
      ],
    })
  )
  await check(
    "hosted search denied",
    "/v1/messages",
    400,
    json({ ...message, tools: [{ type: "web_search_20250305", name: "web_search" }] })
  )
  const count = await check(
    "real Anthropic token count",
    "/v1/messages/count_tokens",
    200,
    json({ model, messages: message.messages })
  )
  assert.ok(count.input_tokens > 0)
  const answer = await check("real non-streaming inference", "/v1/messages", 200, json(message))
  assert.ok(answer.content.some((part: { text?: string }) => part.text?.includes("AGENTZ_POC_OK")))
  const { response: stream, started } = await request(
    "/v1/messages",
    json({ ...message, stream: true })
  )
  assert.equal(stream.status, 200)
  assert.match(stream.headers.get("content-type") ?? "", /event-stream/)
  const reader = stream.body!.getReader()
  const first = await reader.read()
  assert.equal(first.done, false)
  let text = new TextDecoder().decode(first.value)
  assert.ok(!text.includes("event: message_stop"), "the gateway buffered the whole SSE response")
  while (true) {
    const next = await reader.read()
    if (next.done) break
    text += new TextDecoder().decode(next.value)
  }
  assert.match(text, /message_start/)
  assert.match(text, /message_stop/)
  const output = text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)).delta?.text ?? "")
    .join("")
  assert.equal(output, "AGENTZ_POC_OK")
  results.push({
    name: "real streaming inference",
    status: 200,
    duration_ms: Math.round(performance.now() - started),
  })
  console.log("PASS real streaming inference: complete Messages SSE")

  for (const [name, change, restore, values] of [
    [
      "disabled application",
      "update oauth_clients set disabled=true where client_id=$1",
      "update oauth_clients set disabled=false where client_id=$1",
      [claims.client_id],
    ],
    [
      "organization delegation disabled",
      "update organization_delegation set enabled=false where organization_id=(select organization_id from delegation_grants where id=$1)",
      "update organization_delegation set enabled=true where organization_id=(select organization_id from delegation_grants where id=$1)",
      [grantId],
    ],
    [
      "disabled member",
      "update members set disabled_at=now() where user_id=$1",
      "update members set disabled_at=null where user_id=$1",
      [claims.sub],
    ],
    [
      "revoked grant",
      "update delegation_grants set revoked_at=now() where id=$1",
      "update delegation_grants set revoked_at=null where id=$1",
      [grantId],
    ],
  ] as const) {
    await db.query(change, [...values])
    try {
      await check(name, "/v1/models", 401)
    } finally {
      await db.query(restore, [...values])
    }
    await check(`${name} restored`, "/v1/models", 200)
  }
  const refresh = await check(
    "refresh rotation",
    "/oauth/token",
    200,
    form({ grant_type: "refresh_token", refresh_token: tokens.refresh_token }),
    null
  )
  assert.notEqual(refresh.refresh_token, tokens.refresh_token)
  assert.equal(decodeJwt(refresh.access_token).agentz_grant_id, grantId)
  tokens = refresh
  writeFileSync(file, JSON.stringify(tokens), { mode: 0o600 })
  await check("refreshed bearer accepted", "/v1/models", 200)
  await check(
    "unknown refresh",
    "/oauth/token",
    401,
    form({ grant_type: "refresh_token", refresh_token: "unknown" }),
    null
  )
  await check("unsupported grant", "/oauth/token", 400, form({ grant_type: "password" }), null)
  await check(
    "unknown revocation is idempotent",
    "/oauth/revoke",
    200,
    form({ token: "unknown" }),
    null
  )
  await check(
    "logout revokes access grant",
    "/oauth/revoke",
    200,
    form({ token: tokens.access_token }),
    null
  )
  await check("revoked JWT immediately denied", "/v1/models", 401)
  await check(
    "revoked refresh denied",
    "/oauth/token",
    401,
    form({ grant_type: "refresh_token", refresh_token: tokens.refresh_token }),
    null
  )
} finally {
  await db.end()
  if (report)
    writeFileSync(
      report,
      JSON.stringify({ tested_at: new Date().toISOString(), results }, null, 2) + "\n"
    )
}
console.log(`${results.length} live checks passed`)
