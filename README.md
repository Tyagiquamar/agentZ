<div align="center">
    <img src=".github/assets/agentz-logo-horizontal.png" alt="AgentZ" width="360">
    <h3>Zero Trust Agentic AI Platform</h3>
    <p><b>Build, run, and govern AI agents. Secure by design.</b></p>
    <p>
        Every agent runs inside a default-deny sandbox and never receives a
        credential.<br/>
        Every agent action is traceable.
    </p>
    <a href="https://www.producthunt.com/products/agentz?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-agentz" target="_blank" rel="noopener noreferrer"><img alt="AgentZ - Zero Trust Platform to Build, Run Govern AI Agents | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1216150&theme=light&t=1787120477230"></a>
    <br/><br/>
</div>

AgentZ is a multi-tenant platform for running AI agents. It provides strong
isolation guarantees, zero credential exposure to agents, default-deny network
posture and control over the software packages your agents have access to.

**[Website](https://accuknox.com/platform/agentz/)**: the AgentZ landing page.
**[DeepWiki](https://deepwiki.com/accuknox/agentZ)**: chat with the repo and contribute fast.

![](./.github/assets/organisation.png)

## Building Blocks

![](./.github/assets/building-blocks.png)

1. **Inference Providers**: We support a range of providers (derived from
   [OpenCode](https://opencode.ai/)), including Amazon Bedrock, GCP Vertex,
   Azure AI Foundry, OpenAI Codex subscription. We also support configuring
   custom OpenAI/Anthropic endpoints.

2. **Skills**: There are two kinds of skills - mutable and immutable. Mutable
   skills are those that can be modified by the agents, and in fact, are often
   produced by the agents themselves. Immutable skills are user uploaded and
   supporting versioning and rollbacks.

3. **MCP tools**: Similar to inference providers, we also provide a catalog
   for MCP servers. If there's a provider we do not support, you can add a
   custom server.

4. **Sandbox**: A set of reusable configuration (models, skills, mcp tools,
   software packages and allowed hosts). Agents inherit all the properties of
   their sandbox. An agent's sandbox can be swapped / re-configured anytime,
   resulting in its properties to also change.

5. **Agents**: An agent is a Kubernetes Pod that runs an OpenCode server with
   custom plugins and tools under the hood. AgentZ uses Cilium network policies
   to implement a default-deny posture. An agent pod cannot send traffic to any
   destination unless an explicit rule permits it.

   Agents are stateful, and must be treated as such. Their home directory is
   backed by a Kubernetes PVC i.e. it persists across restarts.

6. **Secrets**: MCP is not without its problems. Often, using a CLI tool is
   simpler and more effective. CLI tools that connect to external services,
   such as Gmail and Google Calendar, require authentication tokens or API keys.
   This is where the secret injection proxy comes into play.

   When you create a secret in AgentZ, instead of injecting the actual
   credential, we inject a placeholder, such as `agentz:resolve:env:API_KEY`.
   When your agents call Gmail APIs, the injection proxy replaces the
   placeholder with the actual credential. Your agents never get direct access
   to the credential.

   Furthermore, when creating a secret, you must explicitly provide a set of
   hosts for which the secret is valid. This helps prevent secret
   exfiltration.

![](./.github/assets/secret-injection.png)

## Workflows

- You can ask your agents to develop workflows for repeated tasks
- Workflows can run on a schedule or can be invoked through a webhook. Check [#40](https://github.com/accuknox/agentZ/pull/40).
- Workflow supports typed fields and arbitrary JSON (check [#48](https://github.com/accuknox/agentZ/pull/48)) as inputs.

## OpenCode Interoperability

There are dozens of AI agents out there. We did not want to reinvent our own.
We believe meta-harness is the right way to go.

The Gateway's OpenCode API is interoperable with the OpenCode TUI client. You
can connect to the agent using:

```
opencode attach https://agentzharness.ai/api/opencode/{AGENT_NAME}/
```

## External coding agents

Open **Workspace settings > External agents**, choose Claude Code or Codex, and
give the agent a name. Members with **Use externally** permission for inference
providers or MCP connections can onboard their own agents. Workspace admins can
manage every registration in the workspace. Each registration creates a public
native OAuth client, bound to its owner and workspace, with the required scopes,
login methods and callback URLs. No client secret is needed.

Agents can approve resources only from their workspace, including organization
resources selected for inheritance by that workspace. Consent, token issuance
and refresh, and gateway requests recheck current permissions and inheritance.

Install the desktop `agentz` binary and create its configuration:

```yaml
serverURL: https://agentzharness.ai
externalAgents:
  - myCodex:
      provider: codex
      clientID: YOUR_CODEX_CLIENT_ID
  - myClaude:
      provider: claude
      clientID: YOUR_CLAUDE_CLIENT_ID
  - workClaude:
      provider: claude
      serverUrl: https://another-agentz.example.com
      clientID: YOUR_WORK_CLIENT_ID
```

Use `$XDG_CONFIG_HOME/agentz/config.yaml` or `~/.config/agentz/config.yaml` on
Linux, `~/Library/Application Support/agentz/config.yaml` on macOS, and
`%APPDATA%\agentz\config.yaml` on Windows. `agentz --config FILE` selects another
configuration file. Add agents to the existing `externalAgents` list. An entry's
optional `serverUrl` overrides the shared `serverURL`.

`--profile NAME` selects an AgentZ profile. Without it, the launcher selects the
first entry for the requested provider, in YAML list order. Omit the provider to
infer it from the selected profile. With neither, the first entry is used.
Unknown profiles and provider mismatches fail before login. Profile names must
be unique in the configuration file.

```sh
agentz launch claude --profile myClaude -- --dangerously-skip-permissions
agentz launch --profile myCodex
agentz --profile myClaude relay status
```

AgentZ reads `--profile` before native arguments. Use `--` to pass a native
`--profile` to Codex, for example
`agentz launch codex --profile myCodex -- --profile nativePreferences`.
Existing single-agent configurations using `server_url` and `client_id` must
be changed to the format above. Keep the same server and client ID to retain
native credentials and settings.

```sh
agentz launch claude --your-claude-flags
```

Claude Code 2.1.299 or later handles browser login, credential storage and
refresh. Choose models during AgentZ consent. A persistent loopback relay
connects Claude's private gateway protocol to the public AgentZ service. Native
flags pass through unchanged. The launcher uses a separate Claude profile for
each AgentZ server and client ID. Renaming or reordering entries keeps that
profile. `agentz --profile NAME relay status` and
`agentz --profile NAME relay stop` manage a selected profile's relay.
A healthy relay remains available after the coding agent exits. A failed or
cancelled relay startup terminates and reaps the new child before returning.
Listeners that cannot prove profile ownership are reported without being stopped.

MCP uses a separate native OAuth login. Follow the agent's setup Sheet to add
Claude's MCP server and sign in. Choose tools, prompts and resources during
consent. Provider credentials remain on AgentZ. The **Access** tab shows approved
identity and resource access. Disconnecting the agent revokes all of its grants
and refresh tokens. Personal **Settings > Connected applications** also supports
revocation. Organization resource delegation must be enabled before models or
MCP capabilities can be granted.

AgentGateway 1.6.0 translates supported inference formats and streams responses.
Consent shows conversion warnings and disables unsupported models for the
selected API. Delegated inference uses inline conversation history. Stored
provider files, hosted tools and stored Responses are unavailable.

After disconnecting, run `agentz launch claude auth logout` and launch again to
grant fresh access. Claude's managed model settings choose the first approved
model as the default on each launch; `/model` selects another approved model.

Codex's browser callbacks are registered during onboarding.
Codex 0.162.1 or later performs login and
refresh and keeps its credentials encrypted using the OS credential store.
The credential store must be available and unlocked, including on headless Linux.
Its browser callback must reach the machine running Codex. Remote SSH sessions
need callback port forwarding; this native flow has no device-code fallback.
Codex's browser login expires after three minutes. Rerun `agentz login codex`
to retry an expired login.

```sh
agentz launch codex --your-codex-flags
```

The launcher starts Codex's native app-server login on first use and writes a
local catalog containing approved models. Codex sends inference directly to
AgentZ's public `/api/inference/v1/responses` endpoint with its scoped bearer in
`X-AgentZ-Authorization`. AgentZ accepts the standard `Authorization` bearer
header too. Neither credential reaches the model provider. The local relay
forwards OAuth exchanges and saves approved model metadata; Codex alone stores
and refreshes tokens. Inference remains streamed through AgentGateway.

Codex's custom and namespaced client tools require a native Responses provider.
Responses-to-Chat conversion cannot support those tools. The launcher includes
only approved native Responses models that support tool calls. Each launch
selects the first approved model by default; `/model` can select another.
Provider-hosted web search and Responses WebSockets are disabled. After
disconnecting, or to change approved models, run `agentz login codex`.

Codex MCP uses a separate native OAuth grant. Use the agent's setup Sheet to
sign in. The launcher configures the MCP server with its resource-specific
scopes. MCP commands do not require an inference login. Tool, prompt and
resource grants use the same AgentZ consent and revocation controls as Claude.

## Open-Source Projects

This project wouldn't have been possible without the many excellent open-source libraries and projects it builds on.

- [OpenCode](http://opencode.ai/)
- [AgentGateway](https://agentgateway.dev/)
- [OpenBao](https://openbao.org/)
- [Cilium](https://cilium.io/)
- [KubeArmor](https://kubearmor.io/)
- [Better Auth](https://better-auth.com/)
