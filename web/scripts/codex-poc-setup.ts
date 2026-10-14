import "dotenv/config"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { Client } from "pg"

// Server-side PoC setup only. The client needs stock Codex and this configuration,
// with no credential helper, proxy process, API key or preseeded OAuth token.
const workspaceName = process.argv[2]
const profile = process.argv[3]
const email = process.argv[4] ?? "codex-poc@example.com"
const databaseURL = process.env.DATABASE_URL
const issuer = process.env.BETTER_AUTH_URL
if (
  !databaseURL ||
  !issuer ||
  !new URL(databaseURL).pathname.includes("poc") ||
  !workspaceName ||
  !profile
)
  throw new Error(
    "Use a dedicated PoC database and supply Workspace name and isolated Codex profile."
  )
const workspace = JSON.parse(
  execFileSync("kubectl", ["get", "workspace", workspaceName, "-o", "json"], { encoding: "utf8" })
)
const organizationId: string = workspace.spec.organizationID
const workspaceId: string = workspace.spec.workspaceID
const clientId = process.env.CODEX_POC_CLIENT_ID ?? "agentz-codex-poc"
const mcpClientId = "agentz-codex-mcp-poc"
const db = new Client({ connectionString: databaseURL })
await db.connect()
try {
  const user = (await db.query("select id from users where email=$1", [email])).rows[0]
  if (!user) throw new Error("Create the PoC user through AgentZ sign-up first.")
  await db.query("begin")
  await db.query(
    "insert into organizations(id,name,slug,created_at) values($1,'Codex PoC','codex-poc',now()) on conflict(id) do nothing",
    [organizationId]
  )
  await db.query(
    "insert into workspaces(id,organization_id,name,slug,namespace,state) values($1,$2,'Existing cluster workspace','codex-poc',$3,'ready') on conflict(id) do nothing",
    [workspaceId, organizationId, workspaceName]
  )
  const memberId = `codex-poc-member-${user.id}`
  const roleId = `codex-poc-role-${organizationId}`
  await db.query(
    "insert into members(id,organization_id,user_id,role,created_at) values($1,$2,$3,'superadmin',now()) on conflict(id) do nothing",
    [memberId, organizationId, user.id]
  )
  await db.query(
    "insert into organization_roles(id,organization_id,role,permission) values($1,$2,'superadmin','{}') on conflict(id) do nothing",
    [roleId, organizationId]
  )
  await db.query(
    "insert into role_scopes(role_id,organization_id,display_name,system_role,immutable) values($1,$2,'PoC superadmin','superadmin',true) on conflict(role_id) do nothing",
    [roleId, organizationId]
  )
  await db.query(
    "insert into member_roles(member_id,organization_id,role_id) values($1,$2,$3) on conflict do nothing",
    [memberId, organizationId, roleId]
  )
  await db.query(
    "insert into organization_delegation(organization_id,enabled) values($1,true) on conflict(organization_id) do update set enabled=true",
    [organizationId]
  )
  for (const client of [
    {
      id: clientId,
      name: "Codex inference PoC",
      scopes: ["openid", "profile", "email", "offline_access", "inference:use"],
      resource: `${issuer}/api/inference/v1`,
      redirect: "http://127.0.0.1:1499/callback",
    },
    {
      id: mcpClientId,
      name: "Codex MCP PoC",
      scopes: ["openid", "profile", "email", "offline_access", "mcp:use"],
      resource: `${issuer}/api/mcp`,
      redirect: "http://127.0.0.1:1500/callback",
    },
  ]) {
    await db.query(
      `insert into oauth_clients(id,client_id,name,scopes,grant_types,application_type,token_endpoint_auth_method,disabled,skip_consent,reference_id,redirect_uris)
      values($1,$2,$3,$4,$5,'native','none',false,false,$6,$7)
      on conflict(client_id) do update set disabled=false,scopes=excluded.scopes,grant_types=excluded.grant_types,redirect_uris=excluded.redirect_uris`,
      [
        randomUUID(),
        client.id,
        client.name,
        client.scopes,
        ["authorization_code", "refresh_token"],
        organizationId,
        [client.redirect],
      ]
    )
    await db.query(
      "insert into oauth_client_resources(id,client_id,resource_id,created_at) values($1,$2,$3,now()) on conflict(client_id,resource_id) do nothing",
      [randomUUID(), client.id, client.resource]
    )
  }
  await db.query("commit")
  mkdirSync(profile, { recursive: true, mode: 0o700 })
  const quote = (value: string) => JSON.stringify(value)
  writeFileSync(
    resolve(profile, "models.json"),
    JSON.stringify({
      models: [
        {
          slug: "claude-haiku-4-5-20251001",
          display_name: "Claude Haiku 4.5",
          description: "Existing AgentZ Anthropic provider for the Codex PoC",
          supported_reasoning_levels: [],
          shell_type: "unified_exec",
          visibility: "list",
          supported_in_api: true,
          priority: 1,
          upgrade: null,
          model_messages: null,
          supports_reasoning_summary_parameter: false,
          default_reasoning_summary: "auto",
          support_verbosity: false,
          default_verbosity: null,
          apply_patch_tool_type: null,
          truncation_policy: { mode: "bytes", limit: 10000 },
          context_window: 200000,
          effective_context_window_percent: 95,
          experimental_supported_tools: [],
          input_modalities: ["text"],
          tool_mode: "direct",
          base_instructions:
            "You are a coding assistant. Follow the user's instructions and use available tools when requested.",
        },
      ],
    }),
    { mode: 0o600 }
  )
  writeFileSync(
    resolve(profile, "config.toml"),
    `model_provider = "agentz"
model = "claude-haiku-4-5-20251001"
model_catalog_json = ${quote(resolve(profile, "models.json"))}
model_reasoning_summary = "none"
web_search = "disabled"
mcp_oauth_credentials_store = "file"
mcp_oauth_callback_port = 1500
mcp_optional_startup_grace_ms = 0

[model_providers.agentz]
name = "AgentZ"
base_url = ${quote(`${issuer}/codex/v1`)}
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
request_max_retries = 0
stream_max_retries = 0

[model_providers.agentz.gateway_oauth]
authorization_url = ${quote(`${issuer}/api/auth/oauth2/authorize`)}
token_url = ${quote(`${issuer}/api/auth/oauth2/token`)}
client_id = ${quote(clientId)}
resource = ${quote(`${issuer}/api/inference/v1`)}
scopes = ["openid", "profile", "email", "offline_access", "inference:use"]
redirect_port = 1499
delivery = { kind = "header", name = "X-AgentZ-Authorization", scheme = "Bearer" }

[mcp_servers.agentz]
url = ${quote(`${issuer}/api/mcp`)}
scopes = ["openid", "profile", "email", "offline_access", "mcp:use"]
startup_timeout_sec = 30

[mcp_servers.agentz.tools."mcp-46e84b71984a95556d04e03491961c4a_echo"]
approval_mode = "approve"

[mcp_servers.agentz.oauth]
client_id = ${quote(mcpClientId)}
callback_url = "http://127.0.0.1/callback"
callback_port = 1500
`,
    { mode: 0o600 }
  )
  console.log({ clientId, mcpClientId, workspaceId, profile: resolve(profile), issuer })
} catch (error) {
  await db.query("rollback")
  throw error
} finally {
  await db.end()
}
