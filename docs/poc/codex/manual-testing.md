# Codex manual test report

Tested on 2026-10-14 with unmodified Codex CLI 0.162.1, the existing Kind cluster and Anthropic provider, a dedicated PostgreSQL database, publicly trusted HTTPS, and AgentZ's existing authorization and MCP gateway. The server ran at a public `sslip.io` hostname on this host; the production SaaS deployment was not modified.

## Native client and browser results

| Scenario | Observed result |
| --- | --- |
| Public HTTPS gateway configuration with no OpenAI login, API key or resolver | Accepted by stock Codex |
| Native inference browser login, PKCE, AgentZ credential sign-in and capability selection | Passed |
| Browser-selected model stored as immutable grant | Only Claude Haiku 4.5 selected |
| Native encrypted gateway credential persistence | Passed with an unlocked OS session keyring |
| Final native turn after final gateway restart | `AgentZ MCP: AGENTZ_CODEX_FINAL_OK` |
| First real Anthropic inference | `AGENTZ_ANTHROPIC_PUBLIC_OK` |
| Native MCP browser login through `codex mcp login agentz` | Passed; separate audience and grant |
| MCP capability consent | `echo`, `poc_greeting`, `agentz-poc://status` selected; `private_echo` excluded |
| Model-selected native MCP round trip | Tool result and final answer: `AgentZ MCP: AGENTZ_CODEX_MCP_REAL_OK` |
| Local tool approval absent in noninteractive Codex | Client refused execution with “MCP tool call requires approval, but approval policy is never” |
| Exact fixture echo tool locally approved | Same request executed successfully; other tools did not receive a blanket approval |
| Native inference expiry and refresh | Original refresh token issued 10:10:52 UTC rotated at 10:16:25 UTC; new native turn returned `AGENTZ_CODEX_EXPIRED_REFRESH_OK` without a browser URL |
| Native MCP expiry and refresh | Rotations recorded at 10:08:44 and 10:14:22 UTC; later native sessions initialized MCP successfully |
| `codex logout` | Exit 0, “Not logged in”; gateway AGE file and MCP credentials unchanged |
| AgentZ Connected applications disconnect, inference | Actual browser action; next native request rejected with 403 |
| AgentZ Connected applications disconnect, MCP | Actual browser action; unexpired native MCP access rejected with 403, refresh rejected with 400 |
| Wrong state at native MCP callback | CLI rejected login with “Authorization state not found”; callback returned 200 before the CLI failure, not a credential issuance success |
| Wrong PKCE verifier at AgentZ token endpoint | 401, `invalid_request`, “code verification failed” |
| MCP reconnect after revocation | Fresh resource consent required; next native login succeeded |
| Gateway reconnect after expired revoked credential | Native refresh failed, then browser login requested; new consent and subsequent native login succeeded |
| Local browser and native callback on same host | Browser displayed “Sign-in complete”; native turn returned `AGENTZ_CODEX_LOCAL_BROWSER_OK`, without relaying callback URL through a separate request |
| Browser disconnect and login timeout | Two reconnect attempts failed while the shared browser was disconnected; final local-browser retry succeeded |
| OpenAI quota recheck requested by user | `ip-22653646905b`, `gpt-4.1-mini` still returned “Quota exceeded” through AgentZ |

The shared T3 browser ran on another machine. Initial successful logins required submitting its returned localhost callback URL on the CLI host; token exchange, persistence and refresh remained native. The later local-browser proof directly follows the redirect, removing that testing assistance.

Native results are in [the sanitized client traces](evidence/native-results.json), with [rotation timestamps](evidence/refresh-timestamps.json), [revocation checks](evidence/revocation-result.json), [logout behavior](evidence/logout-result.json), and [callback rejection](evidence/callback-check.json). The [inference consent screenshot](evidence/inference-consent.png) and [MCP consent screenshot](evidence/mcp-consent.png) show the selected resources.

## Live inference checks

The reproducible script creates a separate signed fixture from the browser-approved inference grant and removes it afterward. It does not mutate the native consent snapshot or manually rotate a native refresh token. It ran against the actual public web adapter, Go gateway, cluster authorization routes, OpenBao and funded Anthropic provider.

[API results](evidence/manual-api-results.json) record 43 checks:

- Missing or malformed secondary credentials, primary credentials alone, changed signature, expiration, wrong issuer/audience, missing scope and mismatched user/client/grant.
- Exact selected-model discovery, stripping unrelated primary credentials, unknown paths, wrong methods, malformed JSON, duplicate model fields and unselected models.
- Stored responses, implicit storage, previous responses, conversations, provider prompts/files, background work, hosted MCP/search and hosted tools inside a namespace.
- Unsupported image and reasoning input rejected by the Anthropic bridge.
- Real nonstreaming Responses JSON and complete buffered Responses SSE.
- Disabled application, organization delegation or membership, and revoked fixture grant; restored state admitted requests again.
- Unknown refresh/code and unsupported password grants rejected by the token endpoint.

The separately invoked disabled web adapter returned 404. The default Go provider validation still rejects Anthropic Responses without the explicit bridge flag.

## Live MCP checks

[Protocol results](evidence/manual-mcp-results.json) record initialization, notification, discovery, execution, session binding and deletion against the restored `shared-mcp` fixture. That fixture authenticates the provider-owner bearer supplied by AgentZ; it exposes synthetic capabilities rather than a customer's production tools.

The test passed approved echo execution, prompt retrieval and resource reading. A separate restricted grant exposed only echo, returned empty prompt/resource catalogs, and rejected the hidden tool, prompt and resource. An MCP session could not be reused by a different grant. Unknown tools and unsupported sampling failed, and a deleted session returned 404 on reuse. The test removed its restricted grant afterward. Initial 503 responses while its new cluster route reconciled are recorded, rather than counted as successful initialization.

## Automated verification

- `go test -race ./internal/inference ./internal/gateway ./internal/extauth` passed. New cases cover Responses function/custom/namespace resource validation and the buffered bridge's namespaced tool history, unsupported input, malformed upstream output, text and truncation.
- Go gateway binary build passed.
- ESLint passed for all changed TypeScript files.
- TypeScript checking passed.
- Next.js production build passed and includes `/codex/[...path]` as a dynamic route.
- `git diff --check` passed.

## Boundaries

These tests cover the implemented PoC's authentication, live authorization, selected model/tool execution, refresh, revocation, malformed input and recovery paths. They are not a claim that every possible Codex, OAuth, Responses or MCP scenario has been tested.

The OS keyring used an isolated ephemeral session collection. Persistence after host/keyring restart, macOS and Windows, locked corporate keyrings and remote workstation browser callbacks remain untested. Missing/locked keyring storage initially failed and was diagnosed; no gateway file fallback exists in this stock client.

The Anthropic bridge buffers output and rejects unsupported modalities. It is not a full production Responses implementation. Custom patch tools, deep namespace structures, structured output, long conversations, multi-session stress, full coding task performance and production load were not proved. The real-model proof covers generated text and a complete tool-result follow-up turn.

Governance does not control Codex's local shell or alternate providers. Upstream `gateway_oauth` is undocumented, native account logout does not revoke gateway access, and early revoked access does not automatically refresh before local expiry. These are product constraints, not failures to hide behind successful inference.
