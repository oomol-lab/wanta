import { describe, expect, it } from "vitest"
import { encodePcm16Wav } from "./voice-wav.ts"

describe("encodePcm16Wav", () => {
  it("writes a mono 16-bit PCM WAV header", async () => {
    const wav = encodePcm16Wav([new Float32Array(16000)], 16000)
    const buffer = await wav.blob.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    const view = new DataView(buffer)

    expect(text(bytes, 0, 4)).toBe("RIFF")
    expect(text(bytes, 8, 4)).toBe("WAVE")
    expect(text(bytes, 12, 4)).toBe("fmt ")
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint16(34, true)).toBe(16)
    expect(text(bytes, 36, 4)).toBe("data")
    expect(view.getUint32(40, true)).toBe(32000)
    expect(wav.sampleRate).toBe(16000)
    expect(wav.channels).toBe(1)
    expect(wav.durationMs).toBe(1000)
  })
})

function text(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}
