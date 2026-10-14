# syntax=docker/dockerfile:1.11
FROM rust:1.99.0-trixie AS source
RUN apt-get update \
    && apt-get install -y --no-install-recommends cmake pkg-config protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /source
ENV VERSION=1.6.0-agentz.1
ENV GIT_REVISION=ea5608642b9d5c94c5baf5fd9f2f9849b808e963-agentz.1
RUN git init . \
    && git remote add origin https://github.com/agentgateway/agentgateway.git \
    && git fetch --depth=1 origin ea5608642b9d5c94c5baf5fd9f2f9849b808e963 \
    && git checkout --detach FETCH_HEAD
COPY telemetry.patch /telemetry.patch
RUN git apply --check /telemetry.patch && git apply /telemetry.patch

FROM node:24.17.0-bookworm AS ui
WORKDIR /source/ui
COPY --from=source /source/ui ./
COPY --from=source /source/schema /source/schema
RUN corepack enable && pnpm install --frozen-lockfile && pnpm build

FROM source AS tested
ARG TARGETARCH
ARG CARGO_BUILD_JOBS=2
ENV CARGO_PROFILE_RELEASE_LTO=false
ENV CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/source/target \
    if [ "$TARGETARCH" = arm64 ]; then export JEMALLOC_SYS_WITH_LG_PAGE=16; fi; \
    cargo test --locked --release -p agent-llm \
    && cargo test --locked --release -p agentgateway --lib rejected_request \
    && cargo test --locked --release -p agentgateway --lib request_metadata_capture \
    && cargo test --locked --release -p agentgateway --lib generated_errors_preserve_typed_payload

FROM source AS builder
ARG TARGETARCH
ARG CARGO_BUILD_JOBS=2
COPY --from=tested /source /source
COPY --from=ui /source/ui/dist /source/ui/dist
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/source/target \
    if [ "$TARGETARCH" = arm64 ]; then export JEMALLOC_SYS_WITH_LG_PAGE=16; fi; \
    cargo build --locked -p agentgateway-app --release --features ui \
    && cp target/release/agentgateway /agentgateway

FROM cr.agentgateway.dev/agentgateway@sha256:9d3e6044ddcdc0878b1787f77bd401252b95e22684203fb5e874c4c42d2ed90c
COPY --from=builder /agentgateway /app/agentgateway
