import type { ChatTurnState } from "./chat-turn-state.ts"
import type { ChatStatus } from "ai"

import { chatTurnAllowsStop, chatTurnShowsGenerating } from "./chat-turn-state.ts"

export type ComposerVoiceControlMode =
  | "idle"
  | "idle-error"
  | "recording"
  | "recording-error"
  | "starting"
  | "transcribing"
export type ComposerSubmitAria = "queue" | "send" | "sending" | "stop"

export interface ComposerSubmitState {
  aria: ComposerSubmitAria
  disabled: boolean
  stopsGeneration: boolean
  queuesMessage: boolean
  visualStatus?: ChatStatus
}

export function composerModeControlsDisabled({
  composerDisabled,
  modelRequired,
}: {
  composerDisabled: boolean
  modelRequired: boolean
}): boolean {
  return composerDisabled && !modelRequired
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
  turnState,
  willQueueMessage,
}: {
  canSubmit: boolean
  turnState: ChatTurnState
  willQueueMessage: boolean
}): ComposerSubmitState {
  const initialSendPending = turnState.status === "submitting" && turnState.initialSendPending
  const canStop = chatTurnAllowsStop(turnState)
  const showGenerating = chatTurnShowsGenerating(turnState)
  const queueSendAvailable = willQueueMessage && canSubmit && !initialSendPending
  return {
    aria: initialSendPending ? "sending" : queueSendAvailable ? "queue" : canStop ? "stop" : "send",
    disabled: initialSendPending ? true : queueSendAvailable ? false : canStop ? false : !canSubmit,
    queuesMessage: queueSendAvailable,
    stopsGeneration: canStop && !initialSendPending && !queueSendAvailable,
    visualStatus: showGenerating && !queueSendAvailable ? turnState.chatStatus : undefined,
  }
}
