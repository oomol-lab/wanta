import { describe, expect, it } from "vitest"
import {
  invalidateVoiceTranscription,
  isCurrentVoiceTranscription,
  startVoiceTranscription,
} from "./voice-transcription.ts"

describe("voice transcription token", () => {
  it("invalidates an in-flight transcription after cancellation", () => {
    const ref = { current: 0 }
    const token = startVoiceTranscription(ref)

    expect(isCurrentVoiceTranscription(ref, token)).toBe(true)

    invalidateVoiceTranscription(ref)

    expect(isCurrentVoiceTranscription(ref, token)).toBe(false)
  })

  it("keeps only the latest transcription current", () => {
    const ref = { current: 0 }
    const first = startVoiceTranscription(ref)
    const second = startVoiceTranscription(ref)

    expect(isCurrentVoiceTranscription(ref, first)).toBe(false)
    expect(isCurrentVoiceTranscription(ref, second)).toBe(true)
  })
})
