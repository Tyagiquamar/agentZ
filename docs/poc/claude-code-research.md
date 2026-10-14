# Claude Code and AgentZ gateway research

Checked 2026-10-14 against official documentation and Anthropic's published Claude Code 2.1.299 Linux binary. This document records research, not completed integration testing.

## Feasibility

The proposed native `/login` experience is possible. Claude Code added a corporate gateway login in 2.1.195. It uses a device grant and a gateway bearer token. AgentZ can implement that gateway contract while retaining its existing identity and authorization rules. The browser can authenticate directly to AgentZ; running Anthropic's gateway server is optional. Public internet gateway addresses are a deployment constraint because native login expects a private network. [Claude apps gateway](https://code.claude.com/docs/en/claude-apps-gateway)

For a local PoC, use a loopback HTTP URL. For a deployed gateway, use private HTTPS. Native login fingerprints and pins the gateway's TLS certificate. An arbitrary public SaaS origin is not a supported default gateway login target. [Gateway deployment and operations](https://code.claude.com/docs/en/claude-apps-gateway-deploy)

## Client configuration

Claude Code 2.1.295 and later accepts these keys in the user's settings file. Managed settings can also distribute them. Project settings cannot select the gateway login. [Connect developers](https://code.claude.com/docs/en/claude-apps-gateway#connect-developers)

```json
{
  "forceLoginMethod": "gateway",
  "forceLoginGatewayUrl": "http://localhost:3000/claude"
}
```

Set `CLAUDE_CONFIG_DIR` to an isolated temporary directory for manual testing. That directory owns the test settings and saved credentials. A gateway session takes precedence over other saved login and inference credential sources. Avoid distributing `ANTHROPIC_AUTH_TOKEN` or `apiKeyHelper` alongside a policy requiring gateway login. [Authentication](https://code.claude.com/docs/en/authentication)

## Exact native wire contract

The following details come from the shipped 2.1.299 client and its embedded `/protocol` reference. The executable was downloaded from Anthropic's versioned npm package, verified with `--version`, and inspected locally. [Published native package](https://registry.npmjs.org/@anthropic-ai/claude-code-linux-x64/2.1.299)

| Request | Native client behavior |
| --- | --- |
| `GET {base}/.well-known/oauth-authorization-server` | Reads absolute same-origin `device_authorization_endpoint`, `token_endpoint`, and optional `revocation_endpoint`. |
| Device POST | Form body `surface=claude_code`. Sends neither `client_id` nor `scope`. |
| Device token POST | Form body containing `grant_type=urn:ietf:params:oauth:grant-type:device_code` and `device_code`. No `client_id`. |
| Refresh POST | Form body containing `grant_type=refresh_token` and `refresh_token`. No `client_id`. |
| Token response | Requires string `access_token` and numeric `expires_in`. Accepts optional `refresh_token` and `email`. |
| Inference | `POST {base}/v1/messages`, bearer authorization, Anthropic Messages format. |
| Policy | `GET {base}/managed/settings`. Return `{uuid, checksum, settings}` or `404`. |
| Models | `GET {base}/v1/models`, when gateway model discovery is enabled. |

The client refreshes when fewer than five minutes remain. An invalid refresh grant clears its stored refresh token. It does not inspect the access token payload. Therefore AgentZ owns user, organization, grant, scope, and revocation checks. [Published native package](https://registry.npmjs.org/@anthropic-ai/claude-code-linux-x64/2.1.299)

## AgentZ's device adapter

AgentZ already pins `@better-auth/oauth-provider` 1.7.7. Its installed source exports `oauthDeviceAuthorization()`. Pair it with `oauthProvider()` to exchange approved device codes through `/oauth2/token`. The ordinary `deviceAuthorization()` plugin's `/device/token` returns a first-party session credential instead of the delegated OAuth token set needed here. [Better Auth device authorization](https://better-auth.com/docs/plugins/device-authorization), [installed OAuth provider source](../../web/node_modules/@better-auth/oauth-provider/dist/index.mjs)

The native gateway omits OAuth client identification. An AgentZ route must supply a fixed, registered public client ID and allowed scopes, including `offline_access`, before calling Better Auth. The device request should also bind AgentZ's inference and MCP resources. Supply that same client ID for polling and refresh. Better Auth requires registered client validation, uses `offline_access` for refresh tokens, and supports resource-bound tokens. [OAuth provider](https://better-auth.com/docs/plugins/oauth-provider)

AgentZ's existing provider enables only authorization-code and refresh grants. Add the device grant and device schema without replacing existing delegation checks. Apply the same per-user grant checks to device-issued tokens as authorization-code tokens. This is an implementation conclusion from [AgentZ delegation configuration](../../web/lib/delegation.ts).

## Inference compatibility

Claude Code speaks the Anthropic Messages API. An OpenAI chat-completions endpoint alone does not satisfy it. Serve `/v1/messages` under the configured gateway base and forward streamed events as they arrive. Token counting is optional. Preserve `anthropic-version`, `anthropic-beta`, and body fields required by the upstream. Replace the user's AgentZ credential with the configured provider credential on the upstream leg. Native gateway login sends a restricted set of beta capabilities suited to cloud provider backends. [Gateway compatibility guide](https://code.claude.com/docs/en/llm-gateway-protocol)

The fallback integration uses `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN`, or `apiKeyHelper` for rotating credentials. That route can prove inference compatibility but does not exercise native gateway `/login`. [Connect to an LLM gateway](https://code.claude.com/docs/en/llm-gateway-connect)

## MCP is a separate connection

`/login` authenticates inference and gateway policy. `/mcp` authenticates remote MCP servers. Claude Code supports browser OAuth, stored access and refresh tokens, pre-registered public client IDs, and a fixed localhost callback port. A server can advertise its authorization server through protected-resource metadata and a `WWW-Authenticate` challenge. `claude mcp login <name>` runs the MCP login from a shell. [Claude Code MCP authentication](https://code.claude.com/docs/en/mcp#authenticate-with-remote-mcp-servers)

The PoC can either use AgentZ's existing MCP OAuth authorization-code flow or configure `headersHelper` to send the gateway access token to AgentZ's `/gateway` endpoint. The helper writes a JSON object containing the authorization header. The second option reuses a device-issued credential and avoids a second browser authorization, provided its scopes and resource bindings include MCP. It is a configuration choice, not automatic sharing by Claude Code. [Claude Code dynamic headers](https://code.claude.com/docs/en/mcp#use-dynamic-headers-for-custom-authentication)

OAuth MCP clients use PKCE and resource metadata discovery. A browser callback flow for MCP does not require the device grant. [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)

## Manual scenarios to prove

The device protocol defines pending, denied, expired, and slow-poll states. A `slow_down` response increases the interval by five seconds. A user must explicitly approve the code, including when the browser URL contains it. Codes must expire and redemption must be single-use. [RFC 8628](https://datatracker.ietf.org/doc/html/rfc8628)

For this PoC, record actual CLI and browser evidence for successful login, browser sign-in after a redirect, denial, wrong and expired codes, polling too soon, code replay, simultaneous redemption, refresh rotation and replay, revoked grants, and organization membership removal. Prove bearer identity reaches inference audit records. Exercise streamed text, a real file/tool interaction, MCP tool listing and execution, missing scopes, invalid bearer tokens, blocked models, upstream errors, and a restarted CLI using the saved login. These are proposed acceptance checks, not claims that they have passed.
