# Manual testing report

Tested on 2026-10-14 with native Claude Code 2.1.299, the existing Kind cluster, the real Anthropic provider, and a separate PostgreSQL database. The browser used an isolated Chromium profile.

## Native client and browser

| Scenario | Result |
| --- | --- |
| Native /login opens AgentZ device flow | Passed |
| Signed-out browser redirects to AgentZ sign-in and returns to device approval | Passed |
| Credential sign-in | Passed |
| Prefilled code requires explicit confirmation | Passed |
| Approval shows account, code, scopes, resources and available models/MCP capabilities | Passed |
| Code claimed in another browser session | Rejected |
| Explicit approval stores selected resource snapshot | Passed |
| Native account confirmation and credential storage | Passed |
| Real inference through native CLI | CLAUDE_AGENTZ_NATIVE_OK |
| Real native MCP echo call in a fresh CLI process | AgentZ MCP: CLAUDE_MCP_NATIVE_OK |
| Automatic refresh after access token expiry | POC_NATIVE_REFRESH_OK |
| Final native inference after reconnecting cluster services | POC_FINAL_HEALTH_OK |
| Disabled PoC handler | 404, direct handler check |

The native MCP proof is recorded in [native-claude-result.json](evidence/native-claude-result.json). The expiry/refresh proof is in [native-refresh-result.json](evidence/native-refresh-result.json). [The approval screenshot](evidence/device-approval-mcp.png) shows the actual selected models, tool catalog, prompt and resource.

## Live HTTP and MCP checks

### manual-device-results.json

Executed at 2026-10-14T07:45:13.977Z.

| Scenario | HTTP result |
| --- | --- |
| native request without client ID | 200 |
| verification discloses no unauthenticated scope | 200 |
| unauthenticated approval | 401 |
| unauthenticated denial | 401 |
| pending authorization | 400 |
| polling too quickly | 400 |
| expired device code | 400 |
| unknown device code | 400 |
| missing device code | 400 |
| unknown public client | 400 |
| device endpoint wrong method | 405 |
| token endpoint wrong method | 405 |
| oversized authorization input | 413 |
| disabled device client | 400 |
| fresh device for denial | 200 |
| signed-in verification | 200 |
| signed-in denial | 200 |
| denied device cannot obtain token | 400 |
| throttling maps to RFC slow_down | 429 |

### manual-api-results.json

Executed at 2026-10-14T07:31:35.571Z.

| Scenario | HTTP result |
| --- | --- |
| unauthenticated discovery | 200 |
| missing bearer | 401 |
| malformed bearer | 401 |
| modified signature | 401 |
| expired bearer | 401 |
| wrong issuer | 401 |
| wrong audience | 401 |
| missing inference scope | 403 |
| authorized model discovery | 200 |
| managed policy fallback | 404 |
| unauthenticated telemetry | 401 |
| authenticated telemetry | 200 |
| unknown route | 404 |
| wrong Messages method | 405 |
| malformed Messages JSON | 400 |
| duplicate model | 400 |
| unselected model | 400 |
| hosted MCP denied | 400 |
| provider file denied | 400 |
| hosted search denied | 400 |
| real Anthropic token count | 200 |
| real non-streaming inference | 200 |
| real streaming inference | 200 |
| disabled application | 401 |
| disabled application restored | 200 |
| organization delegation disabled | 401 |
| organization delegation disabled restored | 200 |
| disabled member | 401 |
| disabled member restored | 200 |
| revoked grant | 401 |
| revoked grant restored | 200 |
| refresh rotation | 200 |
| refreshed bearer accepted | 200 |
| unknown refresh | 401 |
| unsupported grant | 400 |
| unknown revocation is idempotent | 200 |
| logout revokes access grant | 200 |
| revoked JWT immediately denied | 401 |
| revoked refresh denied | 401 |

### manual-mcp-results.json

Executed at 2026-10-14T08:46:16.457Z.

| Scenario | HTTP result |
| --- | --- |
| initialize | 200 |
| notifications/initialized | 202 |
| tools/list | 200 |
| tools/call | 200 |
| prompts/list | 200 |
| prompts/get | 200 |
| resources/list | 200 |
| resources/read | 200 |
| tools/list | 404 |
| initialize | 503 |
| initialize | 503 |
| initialize | 503 |
| initialize | 503 |
| initialize | 503 |
| initialize | 503 |
| initialize | 503 |
| initialize | 503 |
| initialize | 200 |
| tools/list | 200 |
| tools/call | 200 |
| tools/call | 400 |
| prompts/list | 200 |
| prompts/get | 400 |
| resources/list | 200 |
| resources/read | 400 |
| initialize | 200 |
| tools/call | 500 |
| sampling/createMessage | 200 |
| session deletion | 202 |
| tools/list | 404 |

MCP 503 responses during restricted-fixture initialization are expected while AgentZ creates and validates the new native routes. The check waits for readiness before testing its capabilities. The restricted fixture returns only echo in discovery, permits echo, and rejects the existing private_echo tool, prompt and resource. Each restricted fixture is removed after the check.

The inference checks validated the JWT signature, issuer, audience, access-token type and scope contract. They exercised current membership/application/grant revocation against the database, real token counting, complete SSE output, refresh rotation and immediate JWT rejection after logout.

The device checks verified 256 bit device codes, the base-20 user code alphabet, fixed client/scopes/resource binding, anonymous verification privacy, pending/slow_down/expired/denied outcomes, invalid clients, request methods and input limits. An additional live throttling check confirmed HTTP 429 carries OAuth slow_down rather than a generic Better Auth error.

## Build and code checks

- Optimized production Next.js build passed, including prerender generation.
- Web typecheck and ESLint passed for the changed implementation and PoC scripts.
- Go vet passed for inference, gateway, extauth and the MCP fixture.
- Go race tests passed for inference, gateway and extauth. The new Messages cases cover duplicate fields, inline files, local tools, hosted tools, containers, provider files and unknown optional fields.
- Existing OAuth revocation ownership test passed with Bun.
- Bun reinstalled the patched OAuth provider successfully.

## Failures fixed during the test

- Claude omits client ID and scopes. The gateway supplies a registered public client and resource audiences.
- Better Auth device issuance omitted grant/session references. The dependency patch preserves both.
- The web schema uses plural adapter model names. The device model now maps to deviceCodes/device_codes.
- The owner authorization container required a static executable and the manual upstream CA.
- The host firewall blocked the existing MCP endpoint. A rule limited to the Kind node and fixture port restored access.
- Copied refresh tokens competed with native token rotation. Independent test grants and a bounded replay window address the PoC client behavior.
- The provider rate limiter returned a generic 429 body. The adapter maps it to OAuth slow_down.
- JWT revocation alone did not stop the Go gateway. Native logout now revokes the underlying resource grant and its refresh tokens.
- The UI automation originally clicked before scrolling settled. The final approval verifies checkbox state before submitting.
- The native CLI retained an earlier empty MCP tool catalog after re-login. A fresh process loaded the newly selected capabilities and completed the tool call.
- Memory exhaustion interrupted the Kubernetes API and port-forwards. Additional swap and fresh gateway/port-forward connections restored the final checks.

## PoC limits

This verifies the configured credential login and the selected Anthropic provider. The device page grants all currently listed capabilities of each selected MCP connection. Exact capability restrictions are enforced and tested through separate restricted grant fixtures.

The Linux MCP helper reads the native file credential store. Other operating systems need secure-store integration. Managed settings and telemetry collection are placeholders in this branch. Unknown MCP tools currently yield the upstream gateway error; restricted known capabilities are rejected.

Public SaaS gateway URLs are outside the native default network policy. See [the primary-source research](claude-code-research.md) for private HTTPS deployment requirements.
