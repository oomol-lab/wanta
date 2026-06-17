import * as React from "react"
import { useVoiceRecorder } from "./useVoiceRecorder.ts"
import {
  invalidateVoiceTranscription,
  isCurrentVoiceTranscription,
  startVoiceTranscription,
} from "./voice-transcription.ts"
import { useChatService } from "@/components/AppContext"

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
  const chatService = useChatService()
  const recorder = useVoiceRecorder()
  const transcriptionRef = React.useRef(0)
  const [transcribing, setTranscribing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [retryBlob, setRetryBlob] = React.useState<Blob | null>(null)

  const transcribeBlob = React.useCallback(
    async (blob: Blob) => {
      const transcriptionToken = startVoiceTranscription(transcriptionRef)
      setTranscribing(true)
      setError(null)
      setRetryBlob(blob)
      try {
        const audioBase64 = arrayBufferToBase64(await blob.arrayBuffer())
        const result = await chatService.invoke("transcribeVoice", { audioBase64 })
        if (!isCurrentVoiceTranscription(transcriptionRef, transcriptionToken)) {
          return
        }
        onTranscription(result.text)
        setRetryBlob(null)
        recorder.cancel()
      } catch (cause) {
        if (!isCurrentVoiceTranscription(transcriptionRef, transcriptionToken)) {
          return
        }
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (isCurrentVoiceTranscription(transcriptionRef, transcriptionToken)) {
          setTranscribing(false)
        }
      }
    },
    [chatService, onTranscription, recorder],
  )

  const stop = React.useCallback(async () => {
    const recorded = await recorder.stop()
    if (recorded) {
      await transcribeBlob(recorded.blob)
    }
  }, [recorder, transcribeBlob])

  const cancel = React.useCallback(() => {
    invalidateVoiceTranscription(transcriptionRef)
    setTranscribing(false)
    setError(null)
    setRetryBlob(null)
    recorder.cancel()
  }, [recorder])

  const start = React.useCallback(() => {
    setError(null)
    void recorder.start()
  }, [recorder])

  const retry = React.useCallback(() => {
    if (retryBlob) {
      void transcribeBlob(retryBlob)
    }
  }, [retryBlob, transcribeBlob])

  const busy = recorder.isRecording || transcribing

  return React.useMemo(
    () => ({
      active: busy,
      bars: recorder.bars,
      busy,
      cancel,
      durationMs: recorder.durationMs,
      error,
      recorderError: recorder.error,
      retry,
      retryBlob,
      start,
      stop,
      transcribing,
    }),
    [
      busy,
      cancel,
      error,
      recorder.bars,
      recorder.durationMs,
      recorder.error,
      retry,
      retryBlob,
      start,
      stop,
      transcribing,
    ],
  )
}
