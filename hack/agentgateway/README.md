# AgentGateway runtime

The Nix package pins upstream AgentGateway and applies `telemetry.patch` for the existing AgentZ tracing integration. Prompt guardrails use upstream native policies; there is no guardrail runtime patch or private guardrail metadata protocol.

AgentZ resolves mandatory organization checks before Sandbox/client additions, projects provider credentials, and compiles native guard types, scopes, audit actions and failure modes. Native content denials use a static safe explanation and HTTP 422 where the API controls the rejection. Custom webhooks implement AgentGateway's `/request` and `/response` contract and author their own rejection body/status. Use 422 and safe explanations in those responses.

Checked streaming evaluates overlapping windows before forwarding them. It does not validate the entire response before delivery, and previously delivered text cannot be retracted. AgentZ rejects output mutations on managed streaming clients, including enforcing Bedrock/webhook checks whose native verdict can mutate content. Model Armor and regex rejection remain windowed checks. Enforcing output regexes must have a bounded match of at most 256 bytes and cannot use anchors or word boundaries. Full-context guarantees, exact inspected-content capture, per-check latency and stable runtime check identifiers are not provided.

Optional enforcing mutations cannot follow mandatory organization checks in the same phase. This includes regex masking and enforcing Bedrock/webhook checks. Use audit mode or a non-mutating detector for those additions. Native enforcement of a cloud policy may anonymize content; AgentZ does not override cloud-defined detection rules.

Native telemetry exports phase, guard kind, action and available provider resource metadata through CEL `guardrails`. The effective AgentZ configuration revision is exported separately. A native record's position does not identify a configured policy/check. Trace and span IDs correlate native events with requests. No runtime-generated support UUID or trusted marker header is available; user feedback must not treat a model-authored error body as an authoritative audit verdict.

Native failures retain upstream semantics. FailOpen/failClosed and audit are independent choices. A detector outage can affect passive model health; model Pools and ordinary model retry behavior remain enabled. Content denials use 422 to avoid the configured 401/403/429/5xx retry/health predicates. The webhook parser accepts some malformed action objects as Pass and does not enforce a 4xx Reject status. Custom providers are trusted implementations of the upstream contract, not a guarantee of strict validation of every malformed future verdict. These generic upstream limitations must not be hidden behind local adapters or protocol guessing.

AgentZ's Codex launcher disables native client request and stream retries through Codex's provider configuration. This prevents an unrecognized late stream block from being resubmitted as a transport failure. Gateway model routing remains enabled. Independently configured external clients own their retry behavior. OpenCode and Codex stop on native late output blocks, but their displayed error can lose the configured explanation; protocol fixture results document this limitation.

Run protocol fixtures against the compiled upstream candidate:

```sh
AGENTGATEWAY_BINARY=/path/to/agentgateway python3 hack/agentgateway/tests/native-fixtures.py
OPENCODE_BINARY=/path/to/opencode AGENTGATEWAY_BINARY=/path/to/agentgateway python3 hack/agentgateway/tests/native-fixtures.py --opencode
```

The suite runs actual proxy/model/webhook processes and records native behavior, including known malformed-webhook and streaming-masking limitations. It tests HTTP protocol frames; the optional OpenCode probe additionally exercises its real SDK. Passing the fixture suite alone does not establish UI or every external-client compatibility. Research and the removal plan are under `docs/research/guardrails-native-*.md`.
