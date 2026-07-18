import type { VoiceInputErrorKind } from "./voice-error-display.ts"

import * as React from "react"
import { useVoiceRecorder } from "./useVoiceRecorder.ts"
import { isVoiceNoSpeechError, transcribeVoice } from "./voice-asr.ts"
import {
  invalidateVoiceTranscription,
  isCurrentVoiceTranscription,
  startVoiceTranscription,
} from "./voice-transcription.ts"

const minimumTranscriptionDurationMs = 800

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ""
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

export function useVoiceComposerInput(onTranscription: (text: string) => void) {
  const recorder = useVoiceRecorder()
  const transcriptionRef = React.useRef(0)
  const transcriptionControllerRef = React.useRef<AbortController | null>(null)
  const [transcribing, setTranscribing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [errorKind, setErrorKind] = React.useState<VoiceInputErrorKind | null>(null)
  const [retryBlob, setRetryBlob] = React.useState<Blob | null>(null)

  const transcribeBlob = React.useCallback(
    async (blob: Blob) => {
      transcriptionControllerRef.current?.abort()
      const controller = new AbortController()
      transcriptionControllerRef.current = controller
      const transcriptionToken = startVoiceTranscription(transcriptionRef)
      setTranscribing(true)
      setError(null)
      setErrorKind(null)
      setRetryBlob(blob)
      try {
        const audioBase64 = arrayBufferToBase64(await blob.arrayBuffer())
        if (!isCurrentVoiceTranscription(transcriptionRef, transcriptionToken)) {
          return
        }
        const text = await transcribeVoice(audioBase64, controller.signal)
        if (!isCurrentVoiceTranscription(transcriptionRef, transcriptionToken)) {
          return
        }
        onTranscription(text)
        setRetryBlob(null)
        recorder.cancel()
      } catch (cause) {
        if (!isCurrentVoiceTranscription(transcriptionRef, transcriptionToken)) {
          return
        }
        setErrorKind(isVoiceNoSpeechError(cause) ? "no_speech" : "transcription_failed")
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (transcriptionControllerRef.current === controller) {
          transcriptionControllerRef.current = null
        }
        if (isCurrentVoiceTranscription(transcriptionRef, transcriptionToken)) {
          setTranscribing(false)
        }
      }
    },
    [onTranscription, recorder],
  )

  const stop = React.useCallback(async () => {
    const recorded = await recorder.stop()
    if (!recorded) {
      return
    }
    if (recorded.durationMs < minimumTranscriptionDurationMs) {
      setError(null)
      setErrorKind(null)
      setRetryBlob(null)
      return
    }
    await transcribeBlob(recorded.blob)
  }, [recorder, transcribeBlob])

  const cancel = React.useCallback(() => {
    transcriptionControllerRef.current?.abort()
    transcriptionControllerRef.current = null
    invalidateVoiceTranscription(transcriptionRef)
    setTranscribing(false)
    setError(null)
    setErrorKind(null)
    setRetryBlob(null)
    recorder.cancel()
  }, [recorder])

  React.useEffect(
    () => () => {
      transcriptionControllerRef.current?.abort()
      invalidateVoiceTranscription(transcriptionRef)
    },
    [],
  )

  const start = React.useCallback(() => {
    setError(null)
    setErrorKind(null)
    void recorder.start()
  }, [recorder])

  const dismissError = React.useCallback(() => {
    setError(null)
    setErrorKind(null)
    setRetryBlob(null)
    if (recorder.error) {
      recorder.cancel()
    }
  }, [recorder])

  const retry = React.useCallback(() => {
    if (retryBlob) {
      void transcribeBlob(retryBlob)
    }
  }, [retryBlob, transcribeBlob])

  const busy = recorder.isBusy || transcribing

  return React.useMemo(
    () => ({
      active: busy,
      bars: recorder.bars,
      busy,
      cancel,
      durationMs: recorder.durationMs,
      error,
      errorKind,
      recorderError: recorder.error,
      dismissError,
      retry,
      retryBlob,
      start,
      starting: recorder.isStarting,
      stop,
      transcribing,
    }),
    [
      busy,
      cancel,
      dismissError,
      error,
      errorKind,
      recorder.bars,
      recorder.durationMs,
      recorder.error,
      recorder.isStarting,
      retry,
      retryBlob,
      start,
      stop,
      transcribing,
    ],
  )
}
