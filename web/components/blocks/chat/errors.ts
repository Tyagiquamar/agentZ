import type {
  AssistantMessage,
  PermissionListError,
  PermissionReplyError,
  QuestionListError,
  QuestionRejectError,
  QuestionReplyError,
  SessionAbortError,
  SessionCreateError,
  SessionGetError,
  SessionListError,
  SessionMessagesError,
  SessionPromptAsyncError,
  SessionRevertError,
  SessionUnrevertError,
} from "@opencode-ai/sdk/v2"
import type { GuardrailOutcome } from "@/lib/gateway/client"
import { zGuardrailErrorEnvelope } from "@/lib/gateway/client/zod.gen"

/** Read the gateway's structured outcome without interpreting provider error text. */
export function guardrailMessageOutcome(
  error: AssistantMessage["error"]
): GuardrailOutcome | undefined {
  if (error?.name !== "APIError" || !error.data.responseBody) return undefined
  if (new Headers(error.data.responseHeaders).get("x-agentz-guardrail-outcome") !== "1")
    return undefined
  try {
    const parsed = zGuardrailErrorEnvelope.safeParse(JSON.parse(error.data.responseBody))
    if (!parsed.success) return undefined
    const outcome = parsed.data.error.guardrail
    if (
      (error.data.statusCode === 422 && outcome.code === "guardrail_denied") ||
      (error.data.statusCode === 503 && outcome.code === "guardrail_unavailable")
    )
      return outcome
  } catch {
    return undefined
  }
  return undefined
}

type OpenCodeClientError =
  | PermissionListError
  | PermissionReplyError
  | QuestionListError
  | QuestionRejectError
  | QuestionReplyError
  | SessionAbortError
  | SessionCreateError
  | SessionGetError
  | SessionListError
  | SessionMessagesError
  | SessionPromptAsyncError
  | SessionRevertError
  | SessionUnrevertError

export function opencodeErrorMessage(
  error: OpenCodeClientError | undefined,
  fallback: string
): string {
  if (!error) return fallback
  if ("message" in error) return error.message
  if ("data" in error) return error.data.message
  return fallback
}

// AssistantMessage carries an optional error discriminated by name. Keep the
// provider detail while giving every SDK variant a stable user-facing label.
export function describeMessageError(error: AssistantMessage["error"]): {
  body: string
  label: string
  guardrail?: GuardrailOutcome
} {
  const guardrail = guardrailMessageOutcome(error)
  if (guardrail) {
    return {
      body: `${guardrail.explanation} Reference ${guardrail.referenceId}`,
      label:
        guardrail.code === "guardrail_denied"
          ? "Blocked by guardrail"
          : "Guardrail service unavailable",
      guardrail,
    }
  }
  if (!error) {
    return {
      body: "An unexpected error occurred",
      label: "Session error",
    }
  }

  switch (error.name) {
    case "MessageAbortedError": {
      return {
        body: error.data.message || "Run stopped",
        label: "Interrupted",
      }
    }
    case "ProviderAuthError": {
      return {
        body: error.data.message || "Check provider credentials",
        label: "Authentication failed",
      }
    }
    case "ContextOverflowError": {
      return {
        body: error.data.message || "Compact the session to continue",
        label: "Context limit exceeded",
      }
    }
    case "MessageOutputLengthError":
      return {
        body: "Response exceeded the model output limit",
        label: "Output limit hit",
      }
    case "ContentFilterError": {
      return {
        body: error.data.message || "Blocked by provider safety filter",
        label: "Content filtered",
      }
    }
    case "StructuredOutputError": {
      return {
        body: error.data.message || "Schema validation retry exhausted",
        label: "Structured output failed",
      }
    }
    case "APIError": {
      return {
        body: error.data.message || "The provider rejected the request",
        label: error.data.statusCode ? `Provider error ${error.data.statusCode}` : "Provider error",
      }
    }
    case "UnknownError": {
      return {
        body: error.data.message || "An unexpected error occurred",
        label: "Session error",
      }
    }
  }
}
