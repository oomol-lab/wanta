import { describe, expect, it } from "vitest"
import { composerSubmitState, composerVoiceControlMode } from "./composer-controls.ts"

describe("composer controls", () => {
  it("selects the voice control mode from active and error state", () => {
    expect(composerVoiceControlMode({ voiceActive: false, voiceTranscribing: false })).toBe("idle")
    expect(
      composerVoiceControlMode({ voiceActive: false, voiceTranscribing: false, visibleVoiceError: "No mic" }),
    ).toBe("idle-error")
    expect(composerVoiceControlMode({ voiceActive: true, voiceTranscribing: false })).toBe("recording")
    expect(composerVoiceControlMode({ voiceActive: true, voiceTranscribing: false, visibleVoiceError: "Failed" })).toBe(
      "recording-error",
    )
    expect(composerVoiceControlMode({ voiceActive: true, voiceTranscribing: true })).toBe("transcribing")
  })

  it("keeps streaming submit clickable as an explicit stop control", () => {
    expect(
      composerSubmitState({
        canSubmit: false,
        initialSendPending: false,
        isGenerating: true,
        isSubmitted: false,
        status: "streaming",
      }),
    ).toEqual({
      aria: "stop",
      disabled: false,
      stopsGeneration: true,
      visualStatus: "streaming",
    })
  })

  it("disables submit while submitted and while empty", () => {
    expect(
      composerSubmitState({
        canSubmit: true,
        initialSendPending: true,
        isGenerating: true,
        isSubmitted: true,
        status: "submitted",
      }),
    ).toEqual({
      aria: "sending",
      disabled: true,
      stopsGeneration: false,
      visualStatus: "submitted",
    })

    expect(
      composerSubmitState({
        canSubmit: false,
        initialSendPending: false,
        isGenerating: false,
        isSubmitted: false,
        status: "ready",
      }),
    ).toEqual({
      aria: "send",
      disabled: true,
      stopsGeneration: false,
      visualStatus: undefined,
    })
  })
})
