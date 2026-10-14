# Direct public AgentZ access from Claude Code

Checked 2026-10-14 using official Claude Code documentation and Anthropic's published Linux CLI 2.1.299. The requirement is direct access to `https://agentzharness.ai` with only Claude Code installed. No VPN, local inference proxy, or installed AgentZ CLI helper is allowed.

## Acceptance boundary

Claude Code must own both the browser login to AgentZ and automatic refresh, and inference must go directly to public AgentZ. Only Claude Code may be installed. Under those requirements, there is currently no supported configuration for an independent public AgentZ deployment. Native public-host trust would require support from Anthropic. No substitute below counts as passing that acceptance requirement.

Direct public HTTPS inference accepts `ANTHROPIC_BASE_URL` and a configured `ANTHROPIC_AUTH_TOKEN`. Claude Code sends that bearer directly but does not obtain or refresh it. This is a transport compatibility fact, not a solution to the accepted login requirement. [Gateway connection guide](https://code.claude.com/docs/en/llm-gateway-connect)

Native `/mcp` OAuth can open AgentZ in the browser and manage MCP access and refresh tokens. There is no documented configuration connecting that token store to inference authorization. A successful MCP login alone does not sign the user into AgentZ inference. [MCP authentication](https://code.claude.com/docs/en/mcp#authenticate-with-remote-mcp-servers)

The public exceptions below do not provide self-service registration for arbitrary gateways.

## Native `/login` and public hosts

The documented cloud-gateway flow normally requires private addresses. `gatewayInternalNetworks` permits organization-owned public IPv4 numbering only when the client connection's local address and every gateway address are inside the same declared block. It is managed policy, and it does not permit arbitrary internet users to reach a public SaaS gateway. [Gateway network requirements](https://code.claude.com/docs/en/claude-apps-gateway#allow-a-gateway-on-public-address-space-you-own)

The current binary has narrower public-host exceptions that the gateway documentation does not list. It explicitly trusts `claude.fedstart.com` and `claude.palantirfedstart.com`. A public vanity hostname can also pass when one of those recognized deployments confirms that it serves the hostname and its DNS points at that deployment. The client asks `/gateway-api/gateway-hosts/check` on both hosts. AgentZ cannot make itself trusted by returning its own affirmative answer. This conclusion comes from the published binary's host-validation logic, not from a general vendor enrollment API. [Published CLI package](https://registry.npmjs.org/@anthropic-ai/claude-code-linux-x64/2.1.299)

Therefore native `/login` directly to public `agentzharness.ai` is unavailable under the current independent AgentZ deployment. A trusted vendor deployment would be a different hosting arrangement.

Anthropic describes FedStart as the hosting platform for Claude for Government. That explains the existing trusted deployment, but does not establish that Anthropic will admit AgentZ as another public gateway. No primary documentation found during this investigation exposes an arbitrary-gateway trust enrollment API or guarantees partner approval. Ask Anthropic whether it can support an independent public gateway before treating that as a product plan. [Claude for Government](https://claude.com/solutions/government)

An undocumented variable named `CLAUDE_CODE_CUSTOM_OAUTH_URL` does not provide an arbitrary IdP override either. The binary rejects URLs outside a fixed Anthropic/FedStart allowlist. It is not a supported AgentZ integration route. [Published CLI package](https://registry.npmjs.org/@anthropic-ai/claude-code-linux-x64/2.1.299)

## Other native authentication paths

The shipped binary exposes no `customIssuer` or `authProfiles` setting. Anthropic profiles support `user_oauth` and `oidc_federation`. The former is written by Console login or `ant auth login`; the latter supplies workload federation credentials. These are documented Anthropic account mechanisms. [Claude Code profiles](https://code.claude.com/docs/en/authentication#anthropic-profiles-and-federation-credentials)

A `user_oauth` profile's `base_url` can be custom HTTPS. The current runtime can refresh a preexisting profile credential by posting JSON containing `grant_type`, `refresh_token`, and `client_id` to `<base_url>/v1/oauth/token`. This means native refresh of a manually supplied compatible credential is technically possible. It does not create an initial browser login to an arbitrary issuer, and native Console login still uses approved authentication endpoints. Manually planting credentials or copying MCP credentials into that profile fails the requirement that Claude Code own initial AgentZ authentication. [Published CLI package](https://registry.npmjs.org/@anthropic-ai/claude-code-linux-x64/2.1.299)

Workload federation starts from an identity JWT supplied by an external environment, token file, or configuration. Anthropic exchanges it for an access token associated with an Anthropic service account and federation rule. It is not an interactive external-IdP browser login. Changing the transport base URL does not add browser authorization or renewal of the source identity JWT. [Workload Identity Federation](https://platform.claude.com/docs/en/manage-claude/workload-identity-federation), [WIF profile reference](https://platform.claude.com/docs/en/manage-claude/wif-reference)

A first-party Anthropic login alongside `ANTHROPIC_BASE_URL` also keeps Anthropic's account login and refresh. It does not mint an AgentZ login token or establish AgentZ's delegated user identity. [Authentication precedence](https://code.claude.com/docs/en/authentication#authentication-precedence)

## Helper behavior, if the constraint changes

`apiKeyHelper` is a supported extension, but it runs custom local code. An inline command in settings avoids installing a separate executable, yet still constitutes a shell helper. A plugin-bundled script has the same distinction. Neither is native external-provider `/login`, and neither should be presented as satisfying a prohibition on helper code.

| Credential source | Inference request headers |
| --- | --- |
| `ANTHROPIC_AUTH_TOKEN` | `Authorization: Bearer <token>` |
| `ANTHROPIC_API_KEY` | `x-api-key: <token>` |
| `apiKeyHelper` | Both `Authorization: Bearer <token>` and `x-api-key: <token>` |

The helper prints the raw token, with no `Bearer` prefix or JSON wrapper. Keep stdout to that token alone. It runs through the system shell and its value is cached for five minutes by default. `CLAUDE_CODE_API_KEY_HELPER_TTL_MS` changes that cache period. [Gateway credential guide](https://code.claude.com/docs/en/llm-gateway-connect#rotate-credentials-with-apikeyhelper)

Claude Code also reruns an active helper after inference `401` or `403`, and before sending a known-expired JWT. These paths require the helper to supply the active credential and `ANTHROPIC_AUTH_TOKEN` to be unset. A project-configured helper waits for workspace trust in interactive sessions. [Helper settings reference](https://code.claude.com/docs/en/settings-reference#apikeyhelper)

The inspected binary gives the helper process ten minutes. The warning after ten seconds is a UI notice, not the process deadline. Cache expiry can start a background helper run while an existing cached value remains in use; known JWT expiry can make the client wait instead. The helper must handle expiry and refresh itself. Do not assume the configured cache lifetime prevents every stale-token request. [Published CLI package](https://registry.npmjs.org/@anthropic-ai/claude-code-linux-x64/2.1.299), [Credential management](https://code.claude.com/docs/en/authentication#credential-management)

If inline helper code is explicitly acceptable, it could call AgentZ over HTTPS, retain a refresh token, and print the current bearer. This still needs an existing system shell and whichever HTTP/JSON facilities the command uses. The fact that Claude Code bundles a runtime does not establish that users have Node, curl, jq, or Python installed. No standalone helper is recommended under the current constraint.

Do not set `forceLoginMethod: "gateway"` for the static-token or helper connection. That policy requires native gateway login and blocks those credentials. `/logout` belongs to Claude Code's saved account login; it does not provide a documented lifecycle API for tokens supplied through settings. [Authentication](https://code.claude.com/docs/en/authentication#authentication-precedence)

## Plugin login experience

A plugin can provide a skill invoked as `/agentz:login`. Plugin command names include the plugin prefix, and command bodies are Markdown prompts. They are not an API for registering a new native OAuth login provider. Bundling an executable would add helper software and conflict with the current constraint. [Plugin manifest reference](https://code.claude.com/docs/en/plugins-reference#commands)

Skill shell injection runs a bundled login command before the rendered prompt reaches the model. That can start browser authorization. It still passes through shell permissions, and a normal injected command has the Bash tool's two-minute default timeout. `disable-model-invocation: true` prevents automatic selection of the skill; it does not turn the skill into a native command or eliminate the model turn. A login skill must never inject token values into its prompt. [Skills](https://code.claude.com/docs/en/skills#inject-dynamic-context)

Current documentation also allows a personal or project skill to shadow a built-in command in local terminal sessions. Installing a skill named `login` could make typing `/login` invoke AgentZ's custom skill. That would replace the user's command experience with a prompt workflow; it would not change native Claude Code authentication. Plugin skills remain namespaced, so a plugin alone does not replace native `/login`. Treat this as an optional custom command, not proof of native public gateway support. [Skill name precedence](https://code.claude.com/docs/en/skills#resolve-skills-that-share-a-name)

An AgentZ plugin could direct the user to native `/mcp` authentication or display a browser URL. A custom skill could also execute inline shell code before inference. However, the resulting OAuth and refresh-token handling would belong to custom code. Skill naming does not remove the native public-host restriction or make MCP credentials automatically apply to inference. A completely unauthenticated session's ability to reach a custom login skill before inference credentials fail also needs an actual CLI test.

MCP can independently use native `/mcp` browser OAuth against public AgentZ with only Claude Code installed. Automatic sharing of those credentials with inference would need a new native capability or custom helper logic. Reading Claude Code's private credentials file is not a documented inference-authentication interface. [MCP authentication](https://code.claude.com/docs/en/mcp#authenticate-with-remote-mcp-servers)

## Evidence status

The host-policy conclusions above were checked against the actual 2.1.299 binary and reproduced by connecting the native client to public AgentZ. The recorded rejection appears below.

Full acceptance still requires native AgentZ browser login and native inference-token refresh against public AgentZ with no additional helper or proxy. The present supported configuration does not provide that combination. Passing static-token inference, custom skill login, MCP OAuth, or refresh of a manually seeded profile cannot complete the requested PoC. Anthropic support for an approved hosted gateway or a new external-issuer login capability is needed; no public partner application process is asserted here.

## Actual native public-login check

Claude Code 2.1.299 was started with an isolated profile pointing native gateway login at `https://agentzharness.ai/claude`. It rejected the public address during host validation before requesting a device code. The recorded result is [native-public-login-result.json](evidence/native-public-login-result.json). This is a failed SaaS acceptance check, with the expected client-policy rejection.
