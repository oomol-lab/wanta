import type { RecordedWav } from "./voice-wav.ts"

import * as React from "react"
import voiceRecorderWorkletUrl from "./voice-recorder-worklet.ts?worker&url"
import { encodePcm16Wav } from "./voice-wav.ts"

const barIntervalMs = 50
const maxBars = 240

export type VoiceRecorderStatus = "idle" | "requesting-permission" | "recording" | "stopping" | "error"

export interface VoiceRecorderControls {
  status: VoiceRecorderStatus
  bars: number[]
  durationMs: number
  error?: string
  isRecording: boolean
  start: () => Promise<void>
  stop: () => Promise<RecordedWav | undefined>
  cancel: () => void
}

interface RecorderRuntime {
  stream: MediaStream
  context: AudioContext
  source: MediaStreamAudioSourceNode
  analyser: AnalyserNode
  worklet: AudioWorkletNode
  silentGain: GainNode
  chunks: Float32Array[]
  startedAt: number
  lastBarAt: number
  smoothedLevel: number
  animationFrame: number
}

export function useVoiceRecorder(): VoiceRecorderControls {
  const runtimeRef = React.useRef<RecorderRuntime | undefined>(undefined)
  const [state, setState] = React.useState({
    status: "idle" as VoiceRecorderStatus,
    bars: [] as number[],
    durationMs: 0,
    error: undefined as string | undefined,
  })

  const cleanupRuntime = React.useCallback(() => {
    const runtime = runtimeRef.current
    if (!runtime) {
      return
    }
    runtimeRef.current = undefined
    cancelAnimationFrame(runtime.animationFrame)
    runtime.worklet.port.onmessage = null
    runtime.worklet.disconnect()
    runtime.silentGain.disconnect()
    runtime.source.disconnect()
    runtime.stream.getTracks().forEach((track) => track.stop())
    void runtime.context.close().catch(() => undefined)
  }, [])

  const start = React.useCallback(async () => {
    cleanupRuntime()
    setState({ status: "requesting-permission", bars: [], durationMs: 0, error: undefined })

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone capture is not available in this environment.")
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      const context = new AudioContext()
      await context.audioWorklet.addModule(voiceRecorderWorkletUrl)

      const source = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      const worklet = new AudioWorkletNode(context, "voice-recorder-processor")
      const silentGain = context.createGain()
      silentGain.gain.value = 0
      const chunks: Float32Array[] = []
      const now = performance.now()
      const runtime: RecorderRuntime = {
        stream,
        context,
        source,
        analyser,
        worklet,
        silentGain,
        chunks,
        startedAt: now,
        lastBarAt: now,
        smoothedLevel: 0,
        animationFrame: 0,
      }
      runtimeRef.current = runtime

      worklet.port.onmessage = (event) => {
        if (event.data instanceof Float32Array) {
          chunks.push(event.data)
        }
      }
      source.connect(analyser)
      source.connect(worklet)
      worklet.connect(silentGain)
      silentGain.connect(context.destination)

      const samples = new Float32Array(analyser.fftSize)
      const update = () => {
        const currentRuntime = runtimeRef.current
        if (!currentRuntime) {
          return
        }

        const currentTime = performance.now()
        currentRuntime.analyser.getFloatTimeDomainData(samples)
        const level = getNormalizedRms(samples)
        currentRuntime.smoothedLevel = currentRuntime.smoothedLevel * 0.72 + level * 0.28

        setState((previous) => {
          const elapsedMs = currentTime - currentRuntime.startedAt
          if (currentTime - currentRuntime.lastBarAt < barIntervalMs) {
            return { ...previous, durationMs: elapsedMs }
          }
          currentRuntime.lastBarAt = currentTime
          return {
            status: "recording",
            bars: [...previous.bars, currentRuntime.smoothedLevel].slice(-maxBars),
            durationMs: elapsedMs,
            error: undefined,
          }
        })

        currentRuntime.animationFrame = requestAnimationFrame(update)
      }

      setState({ status: "recording", bars: [], durationMs: 0, error: undefined })
      runtime.animationFrame = requestAnimationFrame(update)
    } catch (error) {
      cleanupRuntime()
      setState({
        status: "error",
        bars: [],
        durationMs: 0,
        error: error instanceof Error ? error.message : "Failed to start microphone recording.",
      })
    }
  }, [cleanupRuntime])

  const stop = React.useCallback(async (): Promise<RecordedWav | undefined> => {
    const runtime = runtimeRef.current
    if (!runtime) {
      return undefined
    }
    setState((previous) => ({ ...previous, status: "stopping" }))
    const chunks = runtime.chunks.slice()
    const sampleRate = runtime.context.sampleRate
    cleanupRuntime()
    const wav = encodePcm16Wav(chunks, sampleRate)
    setState((previous) => ({ ...previous, status: "idle", durationMs: wav.durationMs }))
    return wav
  }, [cleanupRuntime])

  const cancel = React.useCallback(() => {
    cleanupRuntime()
    setState({ status: "idle", bars: [], durationMs: 0, error: undefined })
  }, [cleanupRuntime])

  React.useEffect(() => cleanupRuntime, [cleanupRuntime])

  return React.useMemo(
    () => ({
      ...state,
      isRecording:
        state.status === "recording" || state.status === "requesting-permission" || state.status === "stopping",
      start,
      stop,
      cancel,
    }),
    [cancel, start, state, stop],
  )
}

function getNormalizedRms(samples: Float32Array): number {
  let sum = 0
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0
    sum += sample * sample
  }
  const rms = Math.sqrt(sum / samples.length)
  const withoutNoiseFloor = Math.max(0, rms - 0.012)
  return Math.min(1, withoutNoiseFloor * 8)
}
