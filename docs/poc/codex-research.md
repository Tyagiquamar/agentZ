# Codex and AgentZ research

Checked 2026-10-14. The acceptance requirement is a public AgentZ gateway at `https://agentzharness.ai`, with Codex owning browser authentication, credential storage, and refresh. No separate installed helper, local inference proxy, or VPN is allowed.

## Feasibility

Unmodified Codex CLI 0.162.1 implements native custom-provider `gateway_oauth`. It can open a public AgentZ authorization endpoint, exchange an authorization code with PKCE, save the resulting tokens, refresh them, and send the access token directly to AgentZ inference. It accepts opaque tokens and does not require OpenAI identity claims. Unlike Claude's gateway flow, this implementation has no private-address restriction. This conclusion comes from the released source and installed binary, not a documented custom-issuer promise. [Released provider configuration](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/model-provider-info/src/gateway_oauth.rs), [released OAuth manager](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/login/src/gateway_auth.rs)

Two limitations matter. The native gateway token must use a custom header or cookie because `Authorization` is reserved. AgentZ can accept `X-AgentZ-Authorization: Bearer <token>` and apply its ordinary bearer validation. Gateway login is initiated when inference needs authentication, or through app-server gateway OAuth RPCs. The terminal's ordinary account login and logout commands do not provide a complete gateway account lifecycle. [Delivery validation](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/model-provider-info/src/gateway_oauth.rs), [gateway RPC implementation](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/app-server/src/request_processors/account_processor/gateway_oauth.rs)

## Version and evidence

| Item | Value |
| --- | --- |
| Installed CLI | `codex-cli 0.162.1`, `/root/.local/bin/codex` |
| npm latest checked | `@openai/codex` 0.162.1 |
| Release tag | `rust-v0.162.1` |
| Release commit | `092d3acd6bec3e3a14bdc7e7a2810ab628ab759d` |
| Cloned source | `.ref/codex` |
| Initially cloned HEAD | `95273b84fbff40f9df7d71d50f1ca52c6489b25d` |
| HEAD timestamp | `2026-10-14T08:05:19Z` |

The release's `gateway_oauth.rs` and `gateway_auth.rs` have identical SHA-256 hashes to the cloned HEAD files. A configuration-only invocation of the installed binary rejected `delivery.name="Authorization"` with its gateway-specific validation error, confirming that the shipped binary reads this configuration. The public HTTPS browser login, native refresh, real Anthropic inference and native MCP round trip have now passed; see [the manual test report](codex/manual-testing.md). [Release source](https://github.com/openai/codex/tree/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d), [package metadata](https://registry.npmjs.org/@openai/codex/0.162.1)

Official documentation describes custom model providers and command-backed token resolvers. The current reference does not describe `gateway_oauth`; treat it as a shipped but undocumented configuration and pin the tested client version. A resolver is unnecessary for this PoC. [Official gateway configuration](https://learn.chatgpt.com/docs/enterprise/connect-to-a-gateway), [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)

## Exact native configuration

This example assumes AgentZ exposes the Codex adapter at `/codex/v1/responses`, and a registered public client named `agentz-codex-poc`. Use AgentZ's actual inference resource identifier. Register the callback exactly as `http://127.0.0.1:1499/callback`.

```toml
model = "claude-haiku-4-5-20251001"
model_provider = "agentz"
web_search = "disabled"

[model_providers.agentz]
name = "AgentZ"
base_url = "https://agentzharness.ai/codex/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false

[model_providers.agentz.gateway_oauth]
authorization_url = "https://agentzharness.ai/api/auth/oauth2/authorize"
token_url = "https://agentzharness.ai/api/auth/oauth2/token"
client_id = "agentz-codex-poc"
resource = "https://agentzharness.ai/api/inference/v1"
scopes = ["openid", "profile", "email", "offline_access", "inference:use"]
redirect_port = 1499
delivery = { kind = "header", name = "X-AgentZ-Authorization", scheme = "Bearer" }
```

The public client uses no secret. Do not add an API key, token environment variable, command resolver, or `requires_openai_auth=true`. With no primary authentication, the provider's empty primary headers compose with its native gateway token. [Primary credential resolution](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/model-provider/src/auth.rs), [combined gateway authentication](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/model-provider/src/combined_auth.rs)

The `openid`, `profile`, and `email` scopes are optional from Codex's perspective. AgentZ may need them for its delegated grant claims. `offline_access` is needed when AgentZ requires it to issue refresh tokens. The model must match an AgentZ inference route and Codex's model metadata; the example does not establish provider entitlement.

## Browser and refresh protocol

Codex creates a localhost listener, PKCE verifier/challenge, and random state. It opens `authorization_url` with `response_type=code`, `client_id`, `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, and `state`. It includes configured scopes and the optional resource. The listener binds `127.0.0.1`, uses `/callback`, and waits up to 180 seconds. [Authorization construction](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/login/src/oauth/authorization.rs), [callback listener](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/login/src/gateway_auth_callback.rs)

The code exchange is form encoded with `grant_type=authorization_code`, `client_id`, `code`, `redirect_uri`, `code_verifier`, and optional `resource`. Refresh uses `grant_type=refresh_token`, `client_id`, `refresh_token`, and optional `resource`. Requests have a 20-second deadline and do not follow redirects. Configured authorization and token URLs can be different public HTTPS origins. There is no discovery requirement. [OAuth HTTP client](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/login/src/oauth/client.rs), [gateway manager](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/login/src/gateway_auth.rs)

The token response requires a nonempty `access_token`. `token_type` can be absent or case-insensitive Bearer. `refresh_token` and `expires_in` are optional; if present, `expires_in` must be positive. Codex treats the token as usable until 30 seconds before expiry. Omit `expires_in` and it has no known local expiry. Return both lifetime and refresh token for this PoC. No ID token is required. [Token validation](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/login/src/gateway_auth_token.rs)

Credentials are separated from ChatGPT login and stored in the encrypted gateway secrets namespace. Exchanges hold a shared store lock, and the manager retains rotated credentials across persistence failure rather than blindly reusing a consumed refresh token. A rejected refresh grant can require browser reauthentication. [Credential storage](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/login/src/gateway_auth_storage.rs), [refresh state machine](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/login/src/gateway_auth.rs)

The manager exposes `refresh_access_token(rejected_token)`, but this checkout has no production call site for it. Do not claim that an early inference `401` transparently refreshes the gateway token. Expiry-based native refresh is connected to the inference authentication path. Test both cases separately. [Manager API](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/login/src/gateway_auth.rs), [provider composition](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/model-provider/src/combined_auth.rs)

## Login commands, device flow, and logout

The gateway's legacy CLI flow prints its authorization URL and tries to launch the browser when it needs a token. App-server exposes `account/gatewayOAuth/read`, `account/gatewayOAuth/login`, and `account/gatewayOAuth/cancel`, with progress notifications. An app-server host opting into explicit gateway OAuth must initiate login rather than expecting automatic browser launch. [Browser launch](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/login/src/gateway_auth_login.rs), [RPC names](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/app-server-protocol/src/protocol/common.rs)

`codex login --device-auth --experimental_issuer URL --experimental_client-id ID` exists, but it is a separate ChatGPT-oriented path. The hidden issuer option does not alter normal browser `codex login`. Its device wire uses OpenAI-specific JSON endpoints under `/api/accounts/deviceauth`, followed by an authorization-code exchange. It is not RFC 8628 and expects an ID token. A refresh endpoint override also exists. Those compatibility hooks are not needed for native `gateway_oauth`, and reproducing that protocol is a larger PoC. [CLI dispatch](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/cli/src/main.rs), [device implementation](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/login/src/device_code_auth.rs)

`codex logout` and the terminal `/logout` clear primary Codex account credentials. The native gateway manager has no credential deletion or revocation API, and the app-server gateway RPC set has no logout. Do not claim account logout revokes AgentZ gateway access. Server-side grant revocation remains available. [CLI logout](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/cli/src/login.rs), [gateway storage API](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/login/src/gateway_auth_storage.rs)

## MCP

Codex supports native OAuth for public HTTP MCP servers, public or pre-registered clients, PKCE, and stored refresh tokens. Add AgentZ's `/gateway` MCP server and use `codex mcp login agentz`. It is independent of model-provider gateway OAuth. The gateway token has no documented automatic path into MCP credentials. AgentZ's existing browser SSO can authenticate both flows as the same user, while each client obtains a resource-scoped token. [Official MCP authentication](https://developers.openai.com/plugins/build/auth), [MCP CLI implementation](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/cli/src/mcp_cmd.rs)

The configuration supports `mcp_servers.<name>.oauth.client_id`, callback settings, scopes, and resource. `auth="chatgpt"` means trusted first-party session use, not reuse of arbitrary gateway OAuth. Model and MCP credential lifecycles must be tested separately. [Configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)

## Smallest client changes if the exact command lifecycle is required

No Codex patch is required to prove native public browser login and expiry-based refresh with a custom AgentZ authentication header. If acceptance requires an explicit terminal gateway login and logout, the following would be narrow extensions, not implemented in this research task:

- Add provider login dispatch in `codex-rs/cli/src/main.rs` and `cli/src/login.rs`, using the selected provider's existing `GatewayAuthManager`.
- Add gateway credential deletion and optional RFC 7009 revocation in `login/src/gateway_auth_storage.rs` and `login/src/gateway_auth.rs`; expose it through app-server `account/gatewayOAuth/logout` and the terminal account controls.
- Connect bounded inference-auth rejection recovery to `GatewayAuthManager::refresh_access_token` through `model-provider/src/provider.rs` and its request recovery path.
- If the standard `Authorization` header is mandatory, relax `model-provider-info/src/gateway_oauth.rs` only when gateway OAuth is the sole credential, and retain header-conflict checks in `model-provider/src/combined_auth.rs`.

The acceptance tests must use the public AgentZ origin, actual Codex browser flow, saved credentials across restart, a real inference response, short-lived token refresh, refresh replay rejection, grant revocation, and native MCP tools. Source review alone does not pass those tests.
