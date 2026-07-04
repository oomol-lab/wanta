import { describe, expect, it } from "vitest"
import { getVoiceErrorNotice } from "./voice-error-display.ts"

describe("voice error display", () => {
  it("treats empty speech recognition as an informational notice without diagnostics", () => {
    const notice = getVoiceErrorNotice({
      recorderError: undefined,
      transcriptionError: "No speech was recognized.",
      transcriptionErrorKind: "no_speech",
    })

    expect(notice).toMatchObject({
      error: {
        kind: "no_input",
        severity: "info",
        titleKey: "error.voiceNoSpeech.title",
      },
      showDiagnosticsCopy: false,
    })
  })

  it("keeps service failures retryable with diagnostics but lowers the visual severity", () => {
    const notice = getVoiceErrorNotice({
      recorderError: undefined,
      transcriptionError: "Voice transcription failed with status 400: bad audio",
      transcriptionErrorKind: "transcription_failed",
    })

    expect(notice).toMatchObject({
      error: {
        severity: "warning",
        titleKey: "error.voiceTranscriptionUnavailable.title",
      },
      showDiagnosticsCopy: true,
    })
  })

  it("shows microphone permission errors without diagnostics copy", () => {
    const notice = getVoiceErrorNotice({
      recorderError: "NotAllowedError: Permission denied",
      transcriptionError: null,
      transcriptionErrorKind: null,
    })

    expect(notice).toMatchObject({
      error: {
        kind: "permission_denied",
        severity: "warning",
        titleKey: "error.voicePermission.title",
      },
      showDiagnosticsCopy: false,
    })
  })
})
