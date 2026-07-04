import type { RecordedWav } from "./voice-wav.ts"

import * as React from "react"
import voiceRecorderWorkletUrl from "./voice-recorder-worklet.ts?worker&url"
import { encodePcm16Wav } from "./voice-wav.ts"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"

const barIntervalMs = 50
const durationIntervalMs = 125
const firstAudioChunkTimeoutMs = 3_000
const maxBars = 240

export type VoiceRecorderStatus = "idle" | "requesting-permission" | "starting" | "recording" | "stopping" | "error"

export interface VoiceRecorderControls {
  status: VoiceRecorderStatus
  bars: number[]
  durationMs: number
  error?: string
  isBusy: boolean
  isRecording: boolean
  isStarting: boolean
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
  lastStateAt: number
  smoothedLevel: number
  animationFrame: number
}

function disposeRuntime(runtime: RecorderRuntime): void {
  cancelAnimationFrame(runtime.animationFrame)
  runtime.worklet.port.onmessage = null
  runtime.worklet.disconnect()
  runtime.silentGain.disconnect()
  runtime.source.disconnect()
  runtime.stream.getTracks().forEach((track) => track.stop())
  void runtime.context.close().catch((error: unknown) => {
    reportRendererHandledError("voice", "audio context close failed", error)
  })
}

function stopStream(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop())
}

function closeAudioContext(context: AudioContext): void {
  void context.close().catch((error: unknown) => {
    reportRendererHandledError("voice", "audio context close failed", error)
  })
}

function waitForFirstAudioChunk(worklet: AudioWorkletNode, chunks: Float32Array[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timeout = window.setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      reject(new Error("Microphone did not start producing audio."))
    }, firstAudioChunkTimeoutMs)

    worklet.port.onmessage = (event) => {
      if (!(event.data instanceof Float32Array)) {
        return
      }
      chunks.push(event.data)
      if (settled) {
        return
      }
      settled = true
      window.clearTimeout(timeout)
      resolve()
    }
  })
}

export function useVoiceRecorder(): VoiceRecorderControls {
  const runtimeRef = React.useRef<RecorderRuntime | undefined>(undefined)
  const startTokenRef = React.useRef(0)
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
    disposeRuntime(runtime)
  }, [])

  const start = React.useCallback(async () => {
    const startToken = startTokenRef.current + 1
    startTokenRef.current = startToken
    cleanupRuntime()
    setState({ status: "requesting-permission", bars: [], durationMs: 0, error: undefined })

    let pendingStream: MediaStream | undefined
    let pendingContext: AudioContext | undefined
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
      pendingStream = stream
      if (startTokenRef.current !== startToken) {
        stopStream(stream)
        return
      }
      setState({ status: "starting", bars: [], durationMs: 0, error: undefined })
      const context = new AudioContext()
      pendingContext = context
      await context.audioWorklet.addModule(voiceRecorderWorkletUrl)
      if (startTokenRef.current !== startToken) {
        stopStream(stream)
        closeAudioContext(context)
        return
      }

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
        lastStateAt: now,
        smoothedLevel: 0,
        animationFrame: 0,
      }
      runtimeRef.current = runtime
      pendingStream = undefined
      pendingContext = undefined

      source.connect(analyser)
      source.connect(worklet)
      worklet.connect(silentGain)
      silentGain.connect(context.destination)
      if (context.state !== "running") {
        await context.resume()
      }
      await waitForFirstAudioChunk(worklet, chunks)
      if (startTokenRef.current !== startToken || runtimeRef.current !== runtime) {
        return
      }

      const startedAt = performance.now()
      runtime.startedAt = startedAt
      runtime.lastBarAt = startedAt
      runtime.lastStateAt = startedAt

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

        const shouldAppendBar = currentTime - currentRuntime.lastBarAt >= barIntervalMs
        const shouldUpdateDuration = currentTime - currentRuntime.lastStateAt >= durationIntervalMs
        if (shouldAppendBar || shouldUpdateDuration) {
          const elapsedMs = currentTime - currentRuntime.startedAt
          currentRuntime.lastStateAt = currentTime
          setState((previous) => {
            if (!shouldAppendBar) {
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
        }

        currentRuntime.animationFrame = requestAnimationFrame(update)
      }

      setState({ status: "recording", bars: [], durationMs: 0, error: undefined })
      runtime.animationFrame = requestAnimationFrame(update)
    } catch (error) {
      if (pendingStream) {
        stopStream(pendingStream)
      }
      if (pendingContext) {
        closeAudioContext(pendingContext)
      }
      if (startTokenRef.current !== startToken) {
        return
      }
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
    if (!runtime || state.status !== "recording") {
      return undefined
    }
    setState((previous) => ({ ...previous, status: "stopping" }))
    const chunks = runtime.chunks.slice()
    const sampleRate = runtime.context.sampleRate
    cleanupRuntime()
    const wav = encodePcm16Wav(chunks, sampleRate)
    setState((previous) => ({ ...previous, status: "idle", durationMs: wav.durationMs }))
    return wav
  }, [cleanupRuntime, state.status])

  const cancel = React.useCallback(() => {
    startTokenRef.current += 1
    cleanupRuntime()
    setState({ status: "idle", bars: [], durationMs: 0, error: undefined })
  }, [cleanupRuntime])

  React.useEffect(
    () => () => {
      startTokenRef.current += 1
      cleanupRuntime()
    },
    [cleanupRuntime],
  )

  return React.useMemo(
    () => ({
      ...state,
      isBusy:
        state.status === "requesting-permission" ||
        state.status === "starting" ||
        state.status === "recording" ||
        state.status === "stopping",
      isRecording: state.status === "recording" || state.status === "stopping",
      isStarting: state.status === "requesting-permission" || state.status === "starting",
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
