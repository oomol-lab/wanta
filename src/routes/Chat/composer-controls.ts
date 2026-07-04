import type { ChatStatus } from "ai"

export type ComposerVoiceControlMode =
  | "idle"
  | "idle-error"
  | "recording"
  | "recording-error"
  | "starting"
  | "transcribing"
export type ComposerSubmitAria = "send" | "sending" | "stop"

export interface ComposerSubmitState {
  aria: ComposerSubmitAria
  disabled: boolean
  stopsGeneration: boolean
  visualStatus?: ChatStatus
}

export function composerVoiceControlMode({
  voiceActive,
  voiceStarting,
  voiceTranscribing,
  visibleVoiceError,
}: {
  voiceActive: boolean
  voiceStarting: boolean
  voiceTranscribing: boolean
  visibleVoiceError?: string | null
}): ComposerVoiceControlMode {
  if (voiceTranscribing) {
    return "transcribing"
  }
  if (voiceStarting) {
    return "starting"
  }
  if (voiceActive && visibleVoiceError) {
    return "recording-error"
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
  status,
}: {
  canSubmit: boolean
  initialSendPending: boolean
  isGenerating: boolean
  status: ChatStatus
}): ComposerSubmitState {
  const canStop = status === "submitted" || status === "streaming"
  const queueSendAvailable = canStop && canSubmit && !initialSendPending
  return {
    aria: initialSendPending ? "sending" : queueSendAvailable ? "send" : canStop ? "stop" : "send",
    disabled: initialSendPending ? true : queueSendAvailable ? false : canStop ? false : !canSubmit,
    stopsGeneration: canStop && !initialSendPending && !queueSendAvailable,
    visualStatus: isGenerating && !queueSendAvailable ? status : undefined,
  }
}
