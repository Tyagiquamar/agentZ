# AgentZ AgentGateway build

`default.nix` fetches the pinned upstream revision, applies `telemetry.patch` and then `guardrails.patch`, and builds the proxy. Reference checkouts are research aids and are not build inputs.

```sh
nix build .#agentgateway
nix build .#agentgatewayImage
```

The guardrails patch uses AgentGateway's existing transformation metadata extension. AgentZ emits a constant, trusted `metadata.agentz_guardrails` object before backend authentication. The runtime rejects unknown fields, unsupported versions, invalid scopes and mismatched check counts. No custom Kubernetes or protobuf fields are required.

The version 1 object contains `version`, `retentionDays`, `request`, `response`, `capture` and `delivery`. Request and response arrays contain check contexts in the same order as native prompt guards. Context fields are `policyId`, `checkId`, `revision`, `connectionId`, `attachment`, `mandatory`, `scopes`, `safeLabel` and `safeExplanation`. Capture is `off`, `findings` or `all`; delivery is `checkedStreaming` or `wholeOutput`. Scope strings use AgentZ's `instructions`, `conversation`, `toolResults` and `toolArguments` names.

Detailed CEL `guardrails` entries include an `agentz` object with stable event/reference IDs, check identity, scopes, timing, retention and optional inspected text. Capture off does not collect inspected text. Findings mode discards passing content. Provider free-text reasons are removed from protected structured events. Configure full `guardrails` CEL export explicitly; upstream's built-in minimal `agw.ai.guardrails` projection does not include these details.


Safe HTTP outcomes carry `x-agentz-guardrail-outcome: 1`. The proxy strips that header from actual model responses before translating them, so downstream code may use it to distinguish a runtime-produced envelope. External proxying must validate and reconstruct the safe outcome before removing the internal marker. SSE errors use the client's protocol envelope and preserve the typed `guardrail` object.

The marker is removed at the LLM provider boundary for every response status. Transparent internal HTTP relays preserve outcomes already produced by the owner inference gateway. Public marker trust remains scoped to AgentZ's authorized, generated inference route; it does not make arbitrary HTTP destinations trusted. Two-process fixtures verify typed input/output denials through this relay and removal of markers from complete forged provider envelopes at both HTTP422 and503.

Locally generated guardrail outcomes also carry an internal Rust response extension. They are terminal across configured retries and do not record model endpoint health or latency samples. A closed checker failure must not evict a healthy Pool member; real model failures retain normal retry and failover behavior. The native fixture suite checks both cases with separate primary and alternate model servers.

Full-output streaming buffers the original SSE frames through complete protocol termination before evaluation and release. Validation completes before HTTP headers are sent. A locally recorded denial becomes a marked HTTP 422 or 503, preserving native SDK error handling. It keeps Codex upstream requests streamed. The adapter never silently applies streamed masking. A checker mask on SSE becomes an explicit service error. Input tool-argument masks and message-list masks that would discard structured message identity are also rejected. These restrictions need capability validation before users save incompatible assignments.

Protected requests reject known image/audio/file/video content before text projection. Buffered and streamed responses reject unsupported media descriptors before release. This is text guardrail support, not moderation of media or encrypted content. OpenAI moderation remains input-only in the native catalog. Non-chat endpoints require AgentZ admission checks because the upstream runtime has separate paths for embeddings, reranking, token counting and Realtime.

Full inspected capture admits at most one MiB per check. Exceeding the bound records a capture-limit error without invoking the checker. Strict streams also have a total sixteen MiB limit and the configured held-body limit; malformed, incomplete or overflowing streams stop explicitly. These are admission limits, not evidence truncation.

Any mutation triggers one final non-mutating validation pass of mandatory checks. A further requested mask blocks instead of restarting the chain. Final-pass events carry `validationPass: mandatoryFinal` and distinct IDs.

Audit-only checker failures record an audit event with an error code and continue. Enforcing checks use their configured failure mode. Webhooks receive incoming headers only through the native explicit header allowlist, or configured CEL expressions. Model backend credentials are excluded from the original request snapshot. Remote checks have a ten-second deadline that also bounds response body reads.

Run the local protocol fixtures against a compiled binary:

```sh
AGENTGATEWAY_BINARY=/path/to/agentgateway python3 hack/agentgateway/tests/native-fixtures.py
OPENCODE_BINARY=/path/to/opencode AGENTGATEWAY_BINARY=/path/to/agentgateway python3 hack/agentgateway/tests/native-fixtures.py --opencode
```

The optional OpenCode test records the client's translated outcomes. OpenCode 1.18.16 preserves typed whole-output HTTP failures. Its SDK drops the typed context from late checked-stream failures, so managed OpenCode requests require whole-output delivery.

The patch's Rust tests cover strict webhook decoding, mask identity checks, mandatory validation after mutation, capture privacy, protocol-specific terminal errors, whole-output withholding and incomplete stream rejection. Development validation must also exercise the actual proxy and clients; parser/unit checks alone do not prove UI or SDK compatibility.
