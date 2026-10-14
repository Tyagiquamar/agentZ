# External app telemetry

AgentZ Agents continue to export OpenCode plugin telemetry. External OAuth apps
use native agentgateway telemetry on the delegation port, 8080. Lens shares its
selector, chart, trace inspector and MCP graph between Agents and apps. Apps do
not require an OpenCode session and do not expose runtime telemetry.

## Build and version requirements

The Dockerfile builds agentgateway v1.6.0 at
`ea5608642b9d5c94c5baf5fd9f2f9849b808e963`, applies `telemetry.patch`, and retains
upstream default features and the embedded admin UI. The runtime base is pinned
by digest. Its version is `1.6.0-agentz.1`.

```sh
docker build --build-arg CARGO_BUILD_JOBS=2 -t agentz-agentgateway:telemetry agentgateway
```

The build runs the 416 LLM tests and four focused native request-finalization
and MCP error tests before compiling the shipping binary. The builder consumes
the tested source; a failing test does not trigger the release build, which took
17 to 18 minutes on the development host. The test stage disables LTO and uses
16 code-generation units; whole-program test LTO measured 6.3 GiB peak resident
memory plus about 8 GiB of swap. The shipping build retains
its upstream release profile. CI builds amd64 and arm64 images in the existing
image pipeline. Manager flags
`--delegation-image-registry`, `--delegation-image-repository` and
`--delegation-image-tag` select this image. The Helm manager configuration
exposes the same settings.

The controller and CRDs must also be v1.6.0, as specified in the
[self-hosting guide](../docs/self-hosting-guide/README.md). The development
cluster currently has v1.5.0. Its CRD rejects `parentNotSampled` and cannot
validate this feature's complete tracing policy. A public OAuth request through
the upgraded controller was therefore not exercised in that cluster. Native
requests, observer ingestion, authenticated Lens access and generated policies
were validated separately. The generated policy passes
v1.6.0 Kubernetes schema and CEL validation. HTTP buffering and tracing target
port 8080, while Agent traffic uses its existing port.

## Capture and storage

The gateway projects trusted grant, app, user, organization, Workspace and
selected-resource identity into route metadata. Caller headers cannot replace
that identity. Only attributed inference operations and MCP `tools/call`
operations enter the app store. OAuth admission failures, unknown outer MCP
targets and aggregate discovery have no selected Workspace operation.

The patch extends existing native provider parsing, context and stream
callbacks. It captures semantic provider errors, partial completions and tool
arguments, cancellation, normal EOF and locally generated MCP error payloads.
Chat streaming keeps each choice and its tool calls under their actual indices
until global completion or interruption. Refusal prose is retained. Responses
capture indexed text and refusal parts, done-event and terminal output snapshots,
and known usage on completed, failed and incomplete outcomes. Final snapshots
replace their own partial parts without duplicating text; empty output arrays
retain already observed content.
For early route-policy failures it captures the requested body within existing
size and deadline limits, then evaluates unapplied metadata. Streaming
passthrough preserves response bytes. Buffered serialization, format translation,
authorization order and other request transformations retain their existing
behavior.

App operations include full inference request JSON, assembled completion and
tool calls, MCP arguments, results and error data, request IDs, model, known
usage, cache and reasoning tokens, cost, timestamps and status. Unknown usage
stays unknown. App finish reasons are deliberately omitted.

The observer uses its existing event queue and PostgreSQL batch writer. One
atomic statement inserts each operation and its payload. Scoped operation
identity makes exporter replay idempotent. Metadata and payloads live in
separate tables; lists, charts and MCP graphs never load prompt or result
columns. History retains the app name and remains readable after revocation or
client deletion, subject to current Workspace membership and Lens permission.

App detail content is serialized JSON text in the generated API contract. This
preserves integers such as `9007199254740993` through browser rendering without
JavaScript numeric coercion. Large documents use the existing shared editor's
virtual viewport with the complete document, selection and search available.
Small documents retain the existing JSON highlighting.

## Transport limits

Delegated HTTP buffering is 32 MiB. Native inference requests use the same
32 MiB bound; native MCP requests retain their existing 4 MiB bound. The observer
accepts 128 MiB OTLP/gRPC messages, configurable through
`--otlp-trace-max-message-size` and Helm. Delegated exporters use
`OTEL_BSP_MAX_EXPORT_BATCH_SIZE=1`, so a large operation is not combined with
other large operations in one export. The manager saves and restores its owned
image and batch environment setting when the last app route disappears,
including manager image changes immediately before revocation.

The final full-content replay produced a 98,568,016-byte export after adding
trusted test attribution. All six boundary operations and warm-up persisted
through the real observer. The HTTP exporter failed at its
64 MiB transport limit; gRPC with the configured 128 MiB limit succeeded.
Streaming output has no fixed total bound. Exceeding an export limit is an
explicit export failure, not intentional clipping.

## Validation and measurements

Reference checkouts, fixtures and raw results are under ignored `.ref/`.
No provider credentials or paid inference calls were used for native fixtures.
The exact shipping release image passed 82 scoped live operations: 25 new
choice/refusal/Responses cases, the original 14 inference/MCP operations and
11 provider cases, three local MCP operations and 29 selected-route
operations. Coverage includes streaming and buffered responses, format
translation, semantic errors, partial output, cancellation and successful EOF.
All 25 new responses match the pinned stock image byte for byte, including
received cancellation prefixes; passthrough streams also match upstream bytes.
Selected-route RBAC and HTTP ext-auth denials retained exact 3 MiB request
bodies, the 32 MiB
inference boundary and the 4 MiB MCP boundary. Unfinished uploads, deadlines,
body limits and already-applied metadata retained their original denial
behavior. Sampled and unsampled incoming parent traces both exported scoped
operations with their original trace and parent IDs.

Real authenticated viewer tests cover Workspace/client isolation, revoked and
deleted app history, current membership enforcement, cursors, dates, independent
chart totals, MCP graphs and full payload inspection. Real existing Agent and
Sandbox resources exported OpenCode prompts, completions, cache usage and
finish reasons into the same observer and Lens inspector. Native MCP request
IDs, arguments and error data preserve `9007199254740993`, and the precision
regression passes in the browser. Rapid inspector switching and a 390-pixel
viewport also pass. Temporary Workspace status changes and test forwarding
rules were restored after testing. Final native exports also passed 57
authenticated Lens API readback checks: the 50 regular operations and all
seven boundary exports. Input, completion, tool calls, MCP content and request
IDs, known usage, model and status match the native exports.

On isolated PostgreSQL 18, a 500,000-operation metadata dataset with 50 apps
produced these warmed results over 30 measured queries:

| Query | Median | p95 |
| --- | ---: | ---: |
| App catalog | 77.988 ms | 91.182 ms |
| Selected app | 147.92 us | 179.44 us |
| Trace page | 9.18 ms | 17.98 ms |
| Chart | 2.313 ms | 3.749 ms |
| MCP graph | 3.032 ms | 4.44 ms |

The selected-app lookup replaces the measured expensive catalog scan on each
app endpoint. Query plans use scoped indexes and exclude payload tables from
metadata reads. No trace-page or chart speedup is claimed from these numbers.

Five observer capture benchmark runs with Go 1.27 and GOMAXPROCS=3 measured
11.389 to 13.792 us and 65 allocations for a small operation, and 1.126 to 1.237 ms
with 69 to 70 allocations for a 1 MiB input. These are capture baselines, not
end-to-end ingestion throughput. Serialized detail JSON adds allocation and
escaping cost to preserve content precision. Full capture is not free.

A separate default observer run used batch size 500 and a one-second flush
interval. It accepted 1,000 operations with 4 KiB prompts in 328 ms and 100
operations with 1 MiB prompts in 429 ms. Export RPC p50/p95 were 0.252/0.580 ms
and 3.699/7.692 ms, respectively. Complete database readback and exact-integer
validation finished 0.511 and 2.363 seconds after each burst started; those
times include readback, not just persistence. Peak observer RSS sampled every
50 ms was 704.7 MiB. This is one burst measurement, not a sustained throughput
or capacity guarantee. Shutdown also persisted all 35 accepted operations
with a deliberately unflushed batch.

The final native release benchmark alternated three full-capture runs with
three runs with capture disabled, using one concurrent request and an untimed
warm-up. Each measured run sent six boundary operations, including 32 MiB
inference input, 31 MiB output, 4 MiB MCP arguments and an 8 MiB MCP result.
All seven SERVER spans, including warm-up, exported in each run. Without
capture, elapsed times were 4.780 to 5.035 seconds (median 4.794), with median
peak RSS 245.0 MiB. Full capture took 5.682 to 5.802 seconds (median 5.716),
with median peak RSS 457.5 MiB. The 19.2% elapsed-time difference describes
capture cost in this fixture, not a speedup or production capacity guarantee.
The largest final protobuf was 98,567,716 bytes; full boundary content and
hashes passed verification.

Browser profiling found unbounded highlighting and full DOM text layout could
exhaust renderer memory on the largest payload. The shared virtual editor keeps
that document inspectable. Three production browser runs opened the complete
33,554,466-character input and 65,011,764-character output in 3.13 to 4.18
seconds, including retrieval and rendering. Each editor rendered roughly
2,200 characters; observed main-thread long tasks were 62 to 64 ms. Complete
selection, read-only behavior and viewport navigation to both long-string
tails passed. Full-document literal search scans
the whole document; its measured worst case is about five seconds on the 65-million-
character fixture. No content was truncated and no custom parser, queue,
exporter, worker or rollup was added to hide those costs.
