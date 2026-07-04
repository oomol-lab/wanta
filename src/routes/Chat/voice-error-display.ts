import type { UserFacingError } from "@/lib/user-facing-error"

import { resolveUserFacingError } from "@/lib/user-facing-error"

export type VoiceInputErrorKind = "no_speech" | "transcription_failed"

export interface VoiceErrorNotice {
  error: UserFacingError
  showDiagnosticsCopy: boolean
}

const microphonePermissionPatterns = [
  "notallowederror",
  "permission denied",
  "permission dismissed",
  "permissiondeniederror",
]

export function getVoiceErrorNotice({
  recorderError,
  transcriptionError,
  transcriptionErrorKind,
}: {
  recorderError?: string
  transcriptionError: string | null
  transcriptionErrorKind: VoiceInputErrorKind | null
}): VoiceErrorNotice | null {
  if (transcriptionError) {
    if (transcriptionErrorKind === "no_speech") {
      return {
        error: {
          area: "voice",
          kind: "no_input",
          severity: "info",
          titleKey: "error.voiceNoSpeech.title",
          descriptionKey: "error.voiceNoSpeech.description",
        },
        showDiagnosticsCopy: false,
      }
    }

    return {
      error: normalizeVoiceFailure(
        resolveUserFacingError(transcriptionError, {
          area: "voice",
          fallbackDescriptionKey: "error.voiceTranscriptionUnavailable.description",
          fallbackTitleKey: "error.voiceTranscriptionUnavailable.title",
        }),
        "error.voiceTranscriptionUnavailable.title",
        "error.voiceTranscriptionUnavailable.description",
      ),
      showDiagnosticsCopy: true,
    }
  }

  if (!recorderError) {
    return null
  }

  if (isMicrophonePermissionError(recorderError)) {
    return {
      error: {
        area: "voice",
        diagnostics: recorderError,
        kind: "permission_denied",
        severity: "warning",
        titleKey: "error.voicePermission.title",
        descriptionKey: "error.voicePermission.description",
      },
      showDiagnosticsCopy: false,
    }
  }

  return {
    error: normalizeVoiceFailure(
      resolveUserFacingError(recorderError, {
        area: "voice",
        fallbackDescriptionKey: "error.voiceMicrophone.description",
        fallbackTitleKey: "error.voiceMicrophone.title",
      }),
      "error.voiceMicrophone.title",
      "error.voiceMicrophone.description",
    ),
    showDiagnosticsCopy: true,
  }
}

function isMicrophonePermissionError(message: string): boolean {
  const normalized = message.toLowerCase()
  return microphonePermissionPatterns.some((pattern) => normalized.includes(pattern))
}

function normalizeVoiceFailure(
  error: UserFacingError,
  fallbackTitleKey: UserFacingError["titleKey"],
  fallbackDescriptionKey: UserFacingError["descriptionKey"],
): UserFacingError {
  if (error.kind !== "operation_failed") {
    return error
  }
  return {
    ...error,
    severity: "warning",
    titleKey: fallbackTitleKey,
    descriptionKey: fallbackDescriptionKey,
  }
}
