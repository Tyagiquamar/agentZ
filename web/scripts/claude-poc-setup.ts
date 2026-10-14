import "dotenv/config"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { Client } from "pg"

// Run from web after creating a PoC user. Reuse a ready cluster Workspace and
// its providers; never seed the platform's ordinary database with test grants.
const workspaceName = process.argv[2]
const email = process.argv[3] ?? "claude-poc@example.com"
const url = process.env.DATABASE_URL
const issuer = process.env.BETTER_AUTH_URL
if (!url || !issuer || !new URL(url).pathname.includes("poc") || !workspaceName)
  throw new Error("Use a dedicated PoC database and supply the existing Workspace resource name.")
const workspace = JSON.parse(
  execFileSync("kubectl", ["get", "workspace", workspaceName, "-o", "json"], { encoding: "utf8" })
)
const organizationId: string = workspace.spec.organizationID
const workspaceId: string = workspace.spec.workspaceID
const clientId = process.env.CLAUDE_GATEWAY_CLIENT_ID ?? "agentz-claude-code-poc"
const scopes = ["openid", "profile", "email", "offline_access", "inference:use", "mcp:use"]
const db = new Client({ connectionString: url })
await db.connect()
try {
  const user = (await db.query("select id from users where email=$1", [email])).rows[0]
  if (!user) throw new Error("Create the PoC user through AgentZ sign-up first.")
  await db.query("begin")
  await db.query(
    "insert into organizations(id,name,slug,created_at) values($1,'Claude PoC','claude-poc',now()) on conflict(id) do nothing",
    [organizationId]
  )
  await db.query(
    "insert into workspaces(id,organization_id,name,slug,namespace,state) values($1,$2,'Existing cluster workspace','claude-poc',$3,'ready') on conflict(id) do nothing",
    [workspaceId, organizationId, workspaceName]
  )
  const memberId = `claude-poc-member-${user.id}`
  const roleId = `claude-poc-role-${organizationId}`
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
  await db.query(
    `insert into oauth_clients(id,client_id,name,scopes,grant_types,application_type,token_endpoint_auth_method,disabled,skip_consent,reference_id,redirect_uris)
    values($1,$2,'Claude Code PoC',$3,$4,'native','none',false,false,$5,'{}') on conflict(client_id) do update set disabled=false,scopes=excluded.scopes,grant_types=excluded.grant_types`,
    [
      randomUUID(),
      clientId,
      scopes,
      ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
      organizationId,
    ]
  )
  for (const resource of [`${issuer}/api/inference/v1`, `${issuer}/api/mcp`]) {
    await db.query(
      "insert into oauth_client_resources(id,client_id,resource_id,created_at) values($1,$2,$3,now()) on conflict(client_id,resource_id) do nothing",
      [randomUUID(), clientId, resource]
    )
  }
  await db.query("commit")
  console.log({
    clientId,
    organizationId,
    workspaceId,
    workspaceName,
    gatewayURL: `${issuer}/claude`,
  })
} catch (error) {
  await db.query("rollback")
  throw error
} finally {
  await db.end()
}
