import { describe, expect, it } from "vitest"
import { composerSubmitState, composerVoiceControlMode } from "./composer-controls.ts"

describe("composer controls", () => {
  it("selects the voice control mode from active and error state", () => {
    expect(composerVoiceControlMode({ voiceActive: false, voiceStarting: false, voiceTranscribing: false })).toBe(
      "idle",
    )
    expect(
      composerVoiceControlMode({
        voiceActive: false,
        voiceStarting: false,
        voiceTranscribing: false,
        visibleVoiceError: "No mic",
      }),
    ).toBe("idle-error")
    expect(composerVoiceControlMode({ voiceActive: true, voiceStarting: true, voiceTranscribing: false })).toBe(
      "starting",
    )
    expect(composerVoiceControlMode({ voiceActive: true, voiceStarting: false, voiceTranscribing: false })).toBe(
      "recording",
    )
    expect(
      composerVoiceControlMode({
        voiceActive: true,
        voiceStarting: false,
        voiceTranscribing: false,
        visibleVoiceError: "Failed",
      }),
    ).toBe("recording-error")
    expect(composerVoiceControlMode({ voiceActive: true, voiceStarting: true, voiceTranscribing: true })).toBe(
      "transcribing",
    )
  })

  it("keeps streaming submit clickable as an explicit stop control", () => {
    expect(
      composerSubmitState({
        canSubmit: false,
        initialSendPending: false,
        isGenerating: true,
        status: "streaming",
        willQueueMessage: false,
      }),
    ).toEqual({
      aria: "stop",
      disabled: false,
      queuesMessage: false,
      stopsGeneration: true,
      visualStatus: "streaming",
    })
  })

  it("shows the queue control while streaming when a queued message can be sent", () => {
    expect(
      composerSubmitState({
        canSubmit: true,
        initialSendPending: false,
        isGenerating: true,
        status: "streaming",
        willQueueMessage: true,
      }),
    ).toEqual({
      aria: "queue",
      disabled: false,
      queuesMessage: true,
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
        willQueueMessage: true,
      }),
    ).toEqual({
      aria: "sending",
      disabled: true,
      queuesMessage: false,
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
        willQueueMessage: false,
      }),
    ).toEqual({
      aria: "stop",
      disabled: false,
      queuesMessage: false,
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
        willQueueMessage: false,
      }),
    ).toEqual({
      aria: "send",
      disabled: true,
      queuesMessage: false,
      stopsGeneration: false,
      visualStatus: undefined,
    })
  })
})
