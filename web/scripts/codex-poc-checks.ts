import "dotenv/config"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { writeFileSync } from "node:fs"
import { importJWK, SignJWT } from "jose"
import { symmetricDecrypt } from "better-auth/crypto"
import { Client } from "pg"
import { getAuth } from "../lib/auth"

// A separate signed fixture keeps the browser-approved native grant immutable.
const issuer = process.env.BETTER_AUTH_URL!
const databaseURL = process.env.DATABASE_URL!
if (!new URL(databaseURL).pathname.includes("poc")) throw new Error("Use a PoC database.")
const db = new Client({ connectionString: databaseURL })
await db.connect()
const fixtureId = randomUUID()
const results: { name: string; status: number }[] = []
const clientId = process.env.CODEX_POC_CLIENT_ID ?? "agentz-codex-anthropic-poc"
const parent = (
  await db.query(
    "select * from delegation_grants where client_id=$1 and revoked_at is null order by created_at desc limit 1",
    [clientId]
  )
).rows[0]
assert.ok(parent, "Approve the native inference client in the browser first.")
const key = (await db.query("select id,private_key,alg from jwks order by created_at desc limit 1"))
  .rows[0]
const jwk = await symmetricDecrypt({
  key: (await getAuth().$context).secretConfig,
  data: JSON.parse(key.private_key),
})
const signingKey = await importJWK(JSON.parse(jwk), key.alg)
const claims = {
  sub: parent.user_id,
  azp: clientId,
  client_id: clientId,
  agentz_grant_id: fixtureId,
  scope: parent.scopes.join(" "),
  iss: issuer,
  aud: `${issuer}/api/inference/v1`,
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
}
const sign = (overrides: Record<string, unknown> = {}) =>
  new SignJWT({ ...claims, ...overrides })
    .setProtectedHeader({ typ: "at+jwt", alg: key.alg, kid: key.id })
    .sign(signingKey)
const token = await sign()
const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
})
const form = (body: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(body),
})
async function check(
  name: string,
  path: string,
  expected: number,
  options: RequestInit = {},
  bearer: string | null = token
) {
  const headers = new Headers(options.headers)
  if (bearer) headers.set("X-AgentZ-Authorization", `Bearer ${bearer}`)
  const response = await fetch(`${issuer}${path}`, { ...options, headers, redirect: "manual" })
  const text = await response.text()
  assert.equal(response.status, expected, `${name}: ${text.slice(0, 500)}`)
  results.push({ name, status: response.status })
  console.log(`PASS ${name}: HTTP ${response.status}`)
  return { response, text }
}
const models = "/codex/v1/models",
  responses = "/codex/v1/responses"
const input = {
  model: "claude-haiku-4-5-20251001",
  store: false,
  input: "Reply exactly AGENTZ_HTTP_REAL_OK",
  max_output_tokens: 32,
}
try {
  await db.query(
    "insert into delegation_grants(id,client_id,user_id,organization_id,scopes,resources,selection,approved_at) values($1,$2,$3,$4,$5,$6,$7,now())",
    [
      fixtureId,
      parent.client_id,
      parent.user_id,
      parent.organization_id,
      parent.scopes,
      parent.resources,
      JSON.stringify(parent.selection),
    ]
  )
  await check("missing secondary bearer", models, 401, {}, null)
  await check(
    "primary bearer cannot authenticate",
    models,
    401,
    { headers: { Authorization: `Bearer ${token}` } },
    null
  )
  await check("malformed secondary bearer", models, 401, {}, "invalid")
  await check("changed token signature", models, 401, {}, token.slice(0, -3) + "abc")
  for (const [name, override, status] of [
    ["expired bearer", { exp: 1 }, 401],
    ["wrong issuer", { iss: "https://other.example" }, 401],
    ["wrong audience", { aud: `${issuer}/api/mcp` }, 401],
    ["missing required scope", { scope: "openid" }, 403],
    ["unknown grant", { agentz_grant_id: randomUUID() }, 403],
    ["wrong client binding", { azp: "other-client" }, 403],
    ["wrong user binding", { sub: "other-user" }, 403],
  ] as const)
    await check(name, models, status, {}, await sign(override))
  const catalogue = await check("selected model discovery", models, 200)
  assert.equal(JSON.parse(catalogue.text).data.length, 1)
  await check("irrelevant primary bearer is stripped", models, 200, {
    headers: { Authorization: "Bearer irrelevant", "x-api-key": "irrelevant" },
  })
  await check("unknown client API", "/codex/v1/unknown", 404)
  await check("wrong Responses method", responses, 405)
  await check("malformed JSON", responses, 400, { ...json(null), body: "{" })
  await check("duplicate model", responses, 400, {
    ...json(null),
    body: '{"model":"claude-haiku-4-5-20251001","model":"other","store":false,"input":"hi"}',
  })
  await check("unselected model", responses, 404, json({ ...input, model: "claude-sonnet-4-6" }))
  for (const [name, override] of [
    ["stored response", { store: true }],
    ["implicit stored response", { store: undefined }],
    ["previous response", { previous_response_id: "resp_other" }],
    ["stored conversation", { conversation: "conv_other" }],
    ["stored prompt", { prompt: { id: "prompt_other" } }],
    ["background work", { background: true }],
    ["hosted MCP", { tools: [{ type: "mcp", server_url: "https://example.com/mcp" }] }],
    ["hosted search", { tools: [{ type: "web_search" }] }],
    [
      "hosted namespace child",
      { tools: [{ type: "namespace", name: "x", tools: [{ type: "web_search" }] }] },
    ],
    [
      "provider file",
      { input: [{ role: "user", content: [{ type: "input_file", file_id: "file_other" }] }] },
    ],
    [
      "unsupported image bridge",
      {
        input: [
          {
            role: "user",
            content: [{ type: "input_image", image_url: "https://example.com/img" }],
          },
        ],
      },
    ],
    ["unsupported reasoning bridge", { input: [{ type: "reasoning", summary: [] }] }],
  ] as const)
    await check(name, responses, 400, json({ ...input, ...override }))
  let ready = false
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${issuer}${responses}`, {
      ...json(input),
      headers: { "Content-Type": "application/json", "X-AgentZ-Authorization": `Bearer ${token}` },
    })
    const text = await r.text()
    if (r.status === 200) {
      assert.match(text, /AGENTZ_HTTP_REAL_OK/)
      results.push({ name: "real non-streaming Anthropic Responses", status: 200 })
      ready = true
      break
    }
    assert.equal(r.status, 503, text)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  assert.ok(ready, "fixture route never became ready")
  const stream = await check(
    "real buffered Responses SSE",
    responses,
    200,
    json({ ...input, stream: true })
  )
  assert.match(stream.response.headers.get("content-type") ?? "", /event-stream/)
  assert.match(stream.text, /response.completed/)
  assert.match(stream.text, /AGENTZ_HTTP_REAL_OK/)
  for (const [name, change, restore, values] of [
    [
      "disabled application",
      "update oauth_clients set disabled=true where client_id=$1",
      "update oauth_clients set disabled=false where client_id=$1",
      [clientId],
    ],
    [
      "disabled organization delegation",
      "update organization_delegation set enabled=false where organization_id=$1",
      "update organization_delegation set enabled=true where organization_id=$1",
      [parent.organization_id],
    ],
    [
      "disabled member",
      "update members set disabled_at=now() where user_id=$1 and organization_id=$2",
      "update members set disabled_at=null where user_id=$1 and organization_id=$2",
      [parent.user_id, parent.organization_id],
    ],
    [
      "revoked fixture grant",
      "update delegation_grants set revoked_at=now() where id=$1",
      "update delegation_grants set revoked_at=null where id=$1",
      [fixtureId],
    ],
  ] as const) {
    await db.query(change, [...values])
    try {
      await check(name, models, 403)
    } finally {
      await db.query(restore, [...values])
    }
    await check(`${name} restored`, models, 200)
  }
  for (const [name, params] of [
    [
      "unknown refresh token",
      {
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: "unknown",
        resource: `${issuer}/api/inference/v1`,
      },
    ],
    [
      "unknown authorization code",
      {
        grant_type: "authorization_code",
        client_id: clientId,
        code: "unknown",
        redirect_uri: "http://127.0.0.1:1499/callback",
        code_verifier: "x".repeat(43),
      },
    ],
    ["unsupported password grant", { grant_type: "password", client_id: clientId }],
  ] as const)
    await check(name, "/api/auth/oauth2/token", 400, form(params), null)
  console.log(`${results.length} live checks passed`)
} finally {
  await db.query("delete from delegation_grants where id=$1", [fixtureId])
  await db.end()
  if (process.argv[2])
    writeFileSync(
      process.argv[2],
      JSON.stringify({ tested_at: new Date().toISOString(), results }, null, 2) + "\n"
    )
}
