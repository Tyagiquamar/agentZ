import "dotenv/config"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { decodeJwt, importJWK, SignJWT } from "jose"
import { symmetricDecrypt } from "better-auth/crypto"
import { Client } from "pg"
import { getAuth } from "../lib/auth"

const tokenFile = process.argv[2]
if (!tokenFile) throw new Error("Supply a native Claude credential file or approved token file.")
const saved = JSON.parse(readFileSync(tokenFile, "utf8"))
const token: string = saved.enterpriseGateway?.jwt ?? saved.access_token
assert.equal(typeof token, "string")
const base = `${process.env.BETTER_AUTH_URL}/claude/mcp`
const headers = new Headers({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
})
let id = 0
const results: { name: string; status: number }[] = []

async function rpc(method: string, params: unknown = {}, notification = false) {
  const currentId = ++id
  const response = await fetch(base, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      ...(notification ? {} : { id: currentId }),
      method,
      params,
    }),
    redirect: "manual",
  })
  const sessionId = response.headers.get("mcp-session-id")
  if (sessionId) headers.set("mcp-session-id", sessionId)
  const text = await response.text()
  const data = text.startsWith("{")
    ? JSON.parse(text)
    : text
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => JSON.parse(line.slice(6)))
        .find((message) => message.id === currentId)
  results.push({ name: method, status: response.status })
  console.log(`MCP ${method}: HTTP ${response.status}`)
  return { status: response.status, data }
}

try {
  const initialized = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    clientInfo: { name: "agentz-poc-checks", version: "1" },
    capabilities: {},
  })
  assert.equal(initialized.status, 200)
  assert.ok(initialized.data.result)
  headers.set("mcp-protocol-version", "2025-06-18")
  await rpc("notifications/initialized", {}, true)
  const tools = await rpc("tools/list")
  assert.equal(tools.status, 200)
  const echo = tools.data.result.tools.find(
    (tool: { name: string }) => tool.name.endsWith("echo") && !tool.name.endsWith("private_echo")
  )
  assert.ok(echo, "the approved echo tool is absent")
  const called = await rpc("tools/call", {
    name: echo.name,
    arguments: { message: "MCP_PROTOCOL_OK" },
  })
  assert.equal(called.status, 200)
  assert.equal(called.data.result.content[0].text, "AgentZ MCP: MCP_PROTOCOL_OK")
  const prompts = await rpc("prompts/list")
  assert.ok(prompts.data.result.prompts.length > 0)
  const prompt = await rpc("prompts/get", { name: prompts.data.result.prompts[0].name })
  assert.equal(
    prompt.data.result.messages[0].content.text,
    "Verify AgentZ delegated prompt access."
  )
  const resources = await rpc("resources/list")
  assert.ok(resources.data.result.resources.length > 0)
  const resource = await rpc("resources/read", { uri: resources.data.result.resources[0].uri })
  assert.equal(resource.data.result.contents[0].text, "AgentZ delegated resource is available.")
  // Create a separate restricted fixture to test exact capability enforcement.
  // The grant approved in the browser remains immutable.
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  assert.ok(new URL(process.env.DATABASE_URL!).pathname.includes("poc"))
  await db.connect()
  const fixtureId = randomUUID()
  const originalClaims = decodeJwt(token)
  const parent = (
    await db.query("select * from delegation_grants where id=$1", [originalClaims.agentz_grant_id])
  ).rows[0]
  const selection = structuredClone(parent.selection)
  selection.mcp = selection.mcp.map(
    (connection: { tools: string[]; prompts: string[]; resources: string[] }) => ({
      ...connection,
      tools: ["echo"],
      prompts: [],
      resources: [],
    })
  )
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
        JSON.stringify(selection),
      ]
    )
    const key = (
      await db.query("select id,private_key,alg from jwks order by created_at desc limit 1")
    ).rows[0]
    const jwk = await symmetricDecrypt({
      key: (await getAuth().$context).secretConfig,
      data: JSON.parse(key.private_key),
    })
    const now = Math.floor(Date.now() / 1000)
    const restrictedToken = await new SignJWT({
      ...originalClaims,
      agentz_grant_id: fixtureId,
      iat: now,
      exp: now + 600,
    })
      .setProtectedHeader({ typ: "at+jwt", kid: key.id, alg: key.alg })
      .sign(await importJWK(JSON.parse(jwk), key.alg))
    headers.set("Authorization", `Bearer ${restrictedToken}`)
    const crossGrant = await rpc("tools/list")
    assert.equal(crossGrant.status, 404, "an MCP session cannot move to another grant")
    headers.delete("mcp-session-id")
    let init
    for (let attempt = 0; attempt < 30; attempt++) {
      init = await rpc("initialize", {
        protocolVersion: "2025-06-18",
        clientInfo: { name: "restricted-poc", version: "1" },
        capabilities: {},
      })
      if (init.status === 200) break
      assert.equal(init.status, 503)
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    assert.equal(init!.status, 200)
    const restrictedTools = await rpc("tools/list")
    assert.deepEqual(
      restrictedTools.data.result.tools.map((tool: { name: string }) => tool.name),
      [echo.name]
    )
    const allowed = await rpc("tools/call", {
      name: echo.name,
      arguments: { message: "RESTRICTED_ALLOWED" },
    })
    assert.equal(allowed.data.result.content[0].text, "AgentZ MCP: RESTRICTED_ALLOWED")
    const privateTool = tools.data.result.tools.find((tool: { name: string }) =>
      tool.name.endsWith("private_echo")
    )
    const privateDenied = await rpc("tools/call", {
      name: privateTool.name,
      arguments: { message: "must not run" },
    })
    assert.ok([400, 403, 404].includes(privateDenied.status), "ungranted tool was admitted")
    const noPrompts = await rpc("prompts/list")
    assert.deepEqual(noPrompts.data.result.prompts, [])
    const promptDenied = await rpc("prompts/get", { name: prompts.data.result.prompts[0].name })
    assert.ok([400, 403, 404].includes(promptDenied.status), "ungranted prompt was admitted")
    const noResources = await rpc("resources/list")
    assert.deepEqual(noResources.data.result.resources, [])
    const resourceDenied = await rpc("resources/read", {
      uri: resources.data.result.resources[0].uri,
    })
    assert.ok([400, 403, 404].includes(resourceDenied.status), "ungranted resource was admitted")
    await fetch(base, { method: "DELETE", headers })
  } finally {
    await db.query("delete from delegation_grants where id=$1", [fixtureId])
    await db.end()
    headers.set("Authorization", `Bearer ${token}`)
    headers.delete("mcp-session-id")
    const reinitialized = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      clientInfo: { name: "poc-restored", version: "1" },
      capabilities: {},
    })
    assert.equal(reinitialized.status, 200)
  }
  const denied = await rpc("tools/call", { name: "ungranted_tool", arguments: {} })
  assert.ok(denied.status >= 400 || denied.data?.error || denied.data?.result?.isError)
  const unsupported = await rpc("sampling/createMessage", {})
  assert.ok(unsupported.data?.error || unsupported.status >= 400)
  const deleted = await fetch(base, { method: "DELETE", headers })
  assert.ok([200, 202, 204].includes(deleted.status))
  results.push({ name: "session deletion", status: deleted.status })
  const stale = await rpc("tools/list")
  assert.ok(stale.status >= 400)
} finally {
  if (process.argv[3])
    writeFileSync(
      process.argv[3],
      JSON.stringify({ tested_at: new Date().toISOString(), results }, null, 2) + "\n"
    )
}
console.log("Live MCP checks passed")
