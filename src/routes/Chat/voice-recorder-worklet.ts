declare class AudioWorkletProcessor {
  readonly port: MessagePort
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void

class VoiceRecorderProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]
    if (!input || input.length === 0 || !input[0]) {
      return true
    }

    const sampleCount = input[0].length
    const channelCount = input.length
    const mono = new Float32Array(sampleCount)

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      let sum = 0
      for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
        sum += input[channelIndex]?.[sampleIndex] ?? 0
      }
      mono[sampleIndex] = sum / channelCount
    }

    this.port.postMessage(mono, [mono.buffer])
    return true
  }
}

registerProcessor("voice-recorder-processor", VoiceRecorderProcessor)
