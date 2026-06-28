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
        status: "streaming",
      }),
    ).toEqual({
      aria: "stop",
      disabled: false,
      stopsGeneration: true,
      visualStatus: "streaming",
    })
  })

  it("shows the send control while streaming when a queued message can be sent", () => {
    expect(
      composerSubmitState({
        canSubmit: true,
        initialSendPending: false,
        isGenerating: true,
        status: "streaming",
      }),
    ).toEqual({
      aria: "send",
      disabled: false,
      stopsGeneration: false,
      visualStatus: undefined,
    })
  })

  it("keeps submitted submit disabled while the initial send is pending", () => {
    expect(
      composerSubmitState({
        canSubmit: true,
        initialSendPending: true,
        isGenerating: true,
        status: "submitted",
      }),
    ).toEqual({
      aria: "sending",
      disabled: true,
      stopsGeneration: false,
      visualStatus: "submitted",
    })
  })

  it("keeps submitted submit clickable as an explicit stop control after send starts", () => {
    expect(
      composerSubmitState({
        canSubmit: false,
        initialSendPending: false,
        isGenerating: true,
        status: "submitted",
      }),
    ).toEqual({
      aria: "stop",
      disabled: false,
      stopsGeneration: true,
      visualStatus: "submitted",
    })
  })

  it("disables submit while empty", () => {
    expect(
      composerSubmitState({
        canSubmit: false,
        initialSendPending: false,
        isGenerating: false,
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
