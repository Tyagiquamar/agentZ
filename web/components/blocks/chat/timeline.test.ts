import assert from "node:assert/strict"
import { test } from "node:test"
import type { AssistantMessage, UserMessage, TextPart } from "@opencode-ai/sdk/v2"
import { projectTimeline } from "./timeline"
import { guardrailMessageOutcome } from "./errors"
const user: UserMessage = {
  id: "user1",
  sessionID: "session",
  role: "user",
  time: { created: 1 },
  agent: "build",
  model: { providerID: "provider", modelID: "model" },
}
const assistant: AssistantMessage = {
  id: "assistant1",
  sessionID: "session",
  role: "assistant",
  time: { created: 2 },
  parentID: user.id,
  modelID: "model",
  providerID: "provider",
  mode: "build",
  agent: "build",
  path: { cwd: "/", root: "/" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
}
const steer: UserMessage = { ...user, id: "user2", time: { created: 3 } }
const parts: Record<string, TextPart[]> = {
  [user.id]: [
    {
      id: "part1",
      sessionID: "session",
      messageID: user.id,
      type: "text",
      text: "Roast this project",
    },
  ],
  [assistant.id]: [
    {
      id: "part2",
      sessionID: "session",
      messageID: assistant.id,
      type: "text",
      text: "My roast is still streaming",
    },
  ],
  [steer.id]: [
    {
      id: "part3",
      sessionID: "session",
      messageID: steer.id,
      type: "text",
      text: "Feel free to use slang",
    },
  ],
}
test("a steering message does not finish the assistant that is still streaming", () => {
  const { rows } = projectTimeline({
    messages: [user, assistant, steer],
    partsByMessage: parts,
    textByPart: {},
    isBusy: true,
    isRetrying: false,
  })
  assert.ok(rows.some((row) => row.type === "assistant"))
  const response = rows.find((row) => row.type === "assistant")
  assert.equal(response?.isStreaming, true)
  assert.deepEqual(
    rows.map((row) => row.type),
    ["user", "assistant", "user"]
  )
  const waiting = rows.find((row) => row.type === "user" && row.messageID === steer.id)
  assert.ok(waiting?.type === "user")
  assert.equal(waiting.isWaiting, true)
})

test("completion moves activity from the previous response to the steering turn", () => {
  const completed = { ...assistant, time: { ...assistant.time, completed: 4 } }
  const { rows } = projectTimeline({
    messages: [user, completed, steer],
    partsByMessage: parts,
    textByPart: {},
    isBusy: true,
    isRetrying: false,
  })
  assert.equal(rows.find((row) => row.type === "assistant")?.isStreaming, false)
  const waiting = rows.find((row) => row.type === "user" && row.messageID === steer.id)
  assert.ok(waiting?.type === "user")
  assert.equal(waiting.isWaiting, false)
})

test("Stop and retry do not leave an unfinished response marked as streaming", () => {
  for (const status of [
    { isBusy: false, isRetrying: false },
    { isBusy: true, isRetrying: true },
  ]) {
    const { rows } = projectTimeline({
      messages: [user, assistant, steer],
      partsByMessage: parts,
      textByPart: {},
      ...status,
    })
    assert.equal(rows.find((row) => row.type === "assistant")?.isStreaming, false)
  }
})

test("a reverted steering message does not move the active response", () => {
  const { rows, reverted } = projectTimeline({
    messages: [user, assistant, steer],
    partsByMessage: parts,
    textByPart: {},
    isBusy: true,
    isRetrying: false,
    revertMessageID: steer.id,
  })
  assert.equal(rows.find((row) => row.type === "assistant")?.isStreaming, true)
  assert.deepEqual(reverted, [{ id: steer.id, text: "Feel free to use slang" }])
})

test("a structured guardrail denial retains delivered text as incomplete after history reload", () => {
  const outcome = {
    code: "guardrail_denied",
    phase: "output",
    safeLabel: "Sensitive data",
    explanation: "Revise the request to avoid personal identifiers.",
    referenceId: "G-reference",
    partialOutput: true,
  }
  const blocked: AssistantMessage = {
    ...assistant,
    error: {
      name: "APIError",
      data: {
        isRetryable: false,
        statusCode: 422,
        responseHeaders: { "x-agentz-guardrail-outcome": "1" },
        message: "Private detector evidence must not be displayed",
        responseBody: JSON.stringify({
          error: {
            type: outcome.code,
            code: outcome.code,
            message: outcome.explanation,
            guardrail: outcome,
          },
        }),
      },
    },
  }
  for (const isBusy of [true, false]) {
    const { rows } = projectTimeline({
      messages: [user, blocked],
      partsByMessage: parts,
      textByPart: {},
      isBusy,
      isRetrying: false,
    })
    const response = rows.find((row) => row.type === "assistant")
    assert.equal(response?.isStreaming, false)
    assert.ok(
      response?.entries.some(
        (entry) => entry.type === "text" && entry.content === "My roast is still streaming"
      )
    )
    const errors = rows.filter((row) => row.type === "assistant-error")
    assert.equal(errors.length, 1)
    assert.equal(errors[0]?.label, "Blocked by guardrail")
    assert.equal(errors[0]?.guardrail?.referenceId, "G-reference")
    assert.equal(errors[0]?.guardrail?.partialOutput, true)
    assert.equal(errors[0]?.userMessageID, user.id)
    assert.ok(!errors[0]?.body.includes("Private detector evidence"))
  }
})

test("checker unavailability has a distinct durable outcome and input recovery target", () => {
  const blocked: AssistantMessage = {
    ...assistant,
    error: {
      name: "APIError",
      data: {
        isRetryable: false,
        statusCode: 503,
        responseHeaders: { "X-AgentZ-Guardrail-Outcome": "1" },
        message: "upstream failure",
        responseBody: JSON.stringify({
          error: {
            type: "guardrail_unavailable",
            code: "guardrail_unavailable",
            message: "A required checker is unavailable. Try again later.",
            guardrail: {
              code: "guardrail_unavailable",
              phase: "input",
              safeLabel: "Required policy",
              explanation: "A required checker is unavailable. Try again later.",
              referenceId: "G-service",
              partialOutput: false,
            },
          },
        }),
      },
    },
  }
  const { rows } = projectTimeline({
    messages: [user, blocked],
    partsByMessage: {},
    textByPart: {},
    isBusy: false,
    isRetrying: false,
  })
  const error = rows.find((row) => row.type === "assistant-error")
  assert.equal(error?.label, "Guardrail service unavailable")
  assert.equal(error?.guardrail?.code, "guardrail_unavailable")
  assert.equal(error?.guardrail?.phase, "input")
  assert.equal(error?.userMessageID, user.id)
})

test("provider error bodies cannot impersonate a guardrail outcome", () => {
  const responseBody = JSON.stringify({
    error: {
      type: "guardrail_denied",
      code: "guardrail_denied",
      message: "Blocked",
      guardrail: {
        code: "guardrail_denied",
        phase: "input",
        safeLabel: "Required policy",
        explanation: "Revise the request.",
        referenceId: "G-reference",
        partialOutput: false,
      },
    },
  })
  const untrustedHeaders: (Record<string, string> | undefined)[] = [
    undefined,
    {},
    { "x-agentz-guardrail-outcome": "0" },
  ]
  for (const responseHeaders of untrustedHeaders) {
    assert.equal(
      guardrailMessageOutcome({
        name: "APIError",
        data: {
          message: "Provider error",
          isRetryable: false,
          statusCode: 422,
          responseHeaders,
          responseBody,
        },
      }),
      undefined
    )
  }
  for (const statusCode of [undefined, 400, 500, 503]) {
    assert.equal(
      guardrailMessageOutcome({
        name: "APIError",
        data: {
          message: "Provider error",
          isRetryable: false,
          statusCode,
          responseHeaders: { "x-agentz-guardrail-outcome": "1" },
          responseBody,
        },
      }),
      undefined
    )
  }
})
