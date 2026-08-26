import type { AgentEvent } from "../contract/event.ts"

import { describe, expect, test } from "vitest"
import { redactExternalAgentEvent } from "./transcript-redaction.ts"
import { ExternalTranscriptRecorder } from "./transcript.ts"

describe("external transcript credential boundary", () => {
  test("redacts provider-shaped keys and embedded shell output before history exposure", () => {
    const recorder = new ExternalTranscriptRecorder()
    const sessionId = "wanta-ext:codex:test"
    const messageId = "assistant-1"
    const events: AgentEvent[] = [
      { event: "messageStarted", data: { sessionId, messageId, role: "assistant" } },
      {
        event: "toolCallResult",
        data: {
          sessionId,
          messageId,
          partId: "tool-1",
          callId: "tool-1",
          tool: "execute",
          status: "completed",
          input: {
            api_token: "secret-input",
            command: `oo connector run posthog --data '{"personal_api_key":"secret-json"}'`,
          },
          output: `Script completed\n{"data":{"api_token":"secret-output","nested":{"client_secret":"secret"}}}`,
          error: "Request failed with Authorization: Bearer raw-header-secret; X-API-Key: raw-api-key-secret",
          metadata: {
            rawInput: { authorization: "Bearer secret" },
            formatted_output: String.raw`{\"api_token\":\"escaped-secret\"}`,
          },
        },
      },
    ]
    for (const event of events) recorder.record(event)

    const part = recorder.messages(sessionId)[0]?.parts[0]
    expect(part?.input).toEqual({
      api_token: "[redacted]",
      command: `oo connector run posthog --data '{"personal_api_key":"[redacted]"}'`,
    })
    expect(part?.output).toContain('"api_token":"[redacted]"')
    expect(part?.output).toContain('"client_secret":"[redacted]"')
    expect(part?.error).not.toContain("raw-header-secret")
    expect(part?.error).not.toContain("raw-api-key-secret")
    expect(part?.error).toContain("[redacted]")
    expect(part?.metadata).toEqual({
      rawInput: { authorization: "[redacted]" },
      formatted_output: String.raw`{\"api_token\":\"[redacted]\"}`,
    })
  })

  test("the adapter-safe recording path is behaviorally identical to recorder-owned redaction", () => {
    const event: AgentEvent = {
      event: "toolCallResult",
      data: {
        sessionId: "wanta-ext:codex:test",
        messageId: "assistant-equivalence",
        partId: "tool-equivalence",
        callId: "tool-equivalence",
        tool: "execute",
        status: "completed",
        input: { authorization: "Bearer input-secret", nested: { api_key: "nested-secret" } },
        output: `{"refresh_token":"output-secret"}`,
      },
    }
    const recorderOwned = new ExternalTranscriptRecorder()
    const adapterOwned = new ExternalTranscriptRecorder()

    recorderOwned.record(event)
    adapterOwned.recordSafe(redactExternalAgentEvent(event))

    const withoutCreationTime = (recorder: ExternalTranscriptRecorder) =>
      recorder.messages(event.data.sessionId).map(({ createdAt: _createdAt, ...message }) => message)
    expect(withoutCreationTime(adapterOwned)).toEqual(withoutCreationTime(recorderOwned))
  })
})
