import "dotenv/config"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { Client } from "pg"

const issuer = process.env.BETTER_AUTH_URL!
const databaseURL = process.env.DATABASE_URL!
if (!databaseURL || !new URL(databaseURL).pathname.includes("poc"))
  throw new Error("Use a dedicated PoC database.")
const db = new Client({ connectionString: databaseURL })
await db.connect()
const results: { name: string; status: number }[] = []
const form = (body: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(body),
})
const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
})

async function check(name: string, path: string, expected: number, options: RequestInit = {}) {
  const response = await fetch(`${issuer}${path}`, { ...options, redirect: "manual" })
  const text = await response.text()
  assert.equal(response.status, expected, `${name}: ${text}`)
  results.push({ name, status: response.status })
  console.log(`PASS ${name}: HTTP ${response.status}`)
  return text ? JSON.parse(text) : null
}
const tokenPath = "/claude/oauth/token"
const poll = (deviceCode: string) =>
  form({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: deviceCode })
try {
  const device = await check(
    "native request without client ID",
    "/claude/oauth/device_authorization",
    200,
    form({
      surface: "claude_code",
      future_parameter: "ignored",
      client_id: "attacker",
      scope: "admin",
    })
  )
  assert.ok(Buffer.from(device.device_code, "base64url").length >= 32)
  assert.match(device.user_code, /^[BCDFGHJKLMNPQRSTVWXZ]{8}$/)
  assert.equal(device.interval, 5)
  const row = (
    await db.query("select * from device_codes where device_code=$1", [device.device_code])
  ).rows[0]
  assert.equal(row.client_id, process.env.CLAUDE_GATEWAY_CLIENT_ID ?? "agentz-claude-code-poc")
  assert.match(row.scope, /offline_access/)
  assert.ok(!row.scope.includes("admin"))
  assert.deepEqual(row.resources, [`${issuer}/api/inference/v1`, `${issuer}/api/mcp`])
  const anonymous = await check(
    "verification discloses no unauthenticated scope",
    `/api/auth/device?user_code=${device.user_code}`,
    200
  )
  assert.equal(anonymous.client_id, undefined)
  assert.equal(anonymous.scope, undefined)
  assert.equal(anonymous.resource, undefined)
  assert.equal(
    (await db.query("select user_id from device_codes where id=$1", [row.id])).rows[0].user_id,
    null
  )
  await check(
    "unauthenticated approval",
    "/api/auth/device/approve",
    401,
    json({ userCode: device.user_code })
  )
  await check(
    "unauthenticated denial",
    "/api/auth/device/deny",
    401,
    json({ userCode: device.user_code })
  )
  const pending = await check("pending authorization", tokenPath, 400, poll(device.device_code))
  assert.equal(pending.error, "authorization_pending")
  const slow = await check("polling too quickly", tokenPath, 400, poll(device.device_code))
  assert.equal(slow.error, "slow_down")
  await db.query(
    "update device_codes set expires_at='2000-01-01',last_polled_at=null where id=$1",
    [row.id]
  )
  const expired = await check("expired device code", tokenPath, 400, poll(device.device_code))
  assert.equal(expired.error, "expired_token")
  await check("unknown device code", tokenPath, 400, poll("unknown"))
  await check(
    "missing device code",
    tokenPath,
    400,
    form({ grant_type: "urn:ietf:params:oauth:grant-type:device_code" })
  )
  await check("unknown public client", "/api/auth/device/code", 400, form({ client_id: "unknown" }))
  await check("device endpoint wrong method", "/claude/oauth/device_authorization", 405)
  await check("token endpoint wrong method", tokenPath, 405)
  await check("oversized authorization input", "/claude/oauth/device_authorization", 413, {
    method: "POST",
    body: "x".repeat(9000),
  })
  await db.query("update oauth_clients set disabled=true where client_id=$1", [row.client_id])
  try {
    await check(
      "disabled device client",
      "/claude/oauth/device_authorization",
      400,
      form({ surface: "claude_code" })
    )
  } finally {
    await db.query("update oauth_clients set disabled=false where client_id=$1", [row.client_id])
  }
  const cookieFile = process.argv[2]
  if (cookieFile) {
    const cookie = readFileSync(cookieFile, "utf8")
      .split("\n")
      .filter((line) => line && (!line.startsWith("#") || line.startsWith("#HttpOnly_")))
      .map((line) => line.split("\t"))
      .map((parts) => `${parts[5]}=${parts[6]}`)
      .join("; ")
    const denied = await check(
      "fresh device for denial",
      "/claude/oauth/device_authorization",
      200,
      form({ surface: "claude_code" })
    )
    await check("signed-in verification", `/api/auth/device?user_code=${denied.user_code}`, 200, {
      headers: { Cookie: cookie },
    })
    await check("signed-in denial", "/api/auth/device/deny", 200, {
      ...json({ userCode: denied.user_code }),
      headers: { "Content-Type": "application/json", Cookie: cookie, Origin: issuer },
    })
    const denial = await check(
      "denied device cannot obtain token",
      tokenPath,
      400,
      poll(denied.device_code)
    )
    assert.equal(denial.error, "access_denied")
  }
} finally {
  await db.end()
  if (process.argv[3])
    writeFileSync(
      process.argv[3],
      JSON.stringify({ tested_at: new Date().toISOString(), results }, null, 2) + "\n"
    )
}
console.log(`${results.length} live device checks passed`)
