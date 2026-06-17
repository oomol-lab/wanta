import type { ChatStatus } from "ai"

export type ComposerVoiceControlMode = "idle" | "idle-error" | "recording" | "recording-error" | "transcribing"
export type ComposerSubmitAria = "send" | "sending" | "stop"

export interface ComposerSubmitState {
  aria: ComposerSubmitAria
  disabled: boolean
  stopsGeneration: boolean
  visualStatus?: ChatStatus
}

export function composerVoiceControlMode({
  voiceActive,
  voiceTranscribing,
  visibleVoiceError,
}: {
  voiceActive: boolean
  voiceTranscribing: boolean
  visibleVoiceError?: string | null
}): ComposerVoiceControlMode {
  if (voiceActive && visibleVoiceError) {
    return "recording-error"
  }
  if (voiceTranscribing) {
    return "transcribing"
  }
  if (voiceActive) {
    return "recording"
  }
  return visibleVoiceError ? "idle-error" : "idle"
}

export function composerSubmitState({
  canSubmit,
  initialSendPending,
  isGenerating,
  isSubmitted,
  status,
}: {
  canSubmit: boolean
  initialSendPending: boolean
  isGenerating: boolean
  isSubmitted: boolean
  status: ChatStatus
}): ComposerSubmitState {
  return {
    aria: initialSendPending ? "sending" : status === "streaming" ? "stop" : "send",
    disabled: isSubmitted ? true : status === "streaming" ? false : !canSubmit,
    stopsGeneration: status === "streaming",
    visualStatus: isGenerating ? status : undefined,
  }
}
