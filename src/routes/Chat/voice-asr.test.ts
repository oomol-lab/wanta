import { describe, expect, it } from "vitest"
import { buildVoiceAsrBody, describeVoiceAsrFetchFailure, parseVoiceAsrTranscript } from "./voice-asr.ts"

describe("voice-asr", () => {
  it("buildVoiceAsrBody matches the Studio voice ASR payload shape", () => {
    const body = buildVoiceAsrBody("wav-base64", "request-1")
    expect(JSON.parse(body)).toEqual({
      user: { uid: "request-1" },
      audio: { data: "wav-base64" },
      request: {
        model_name: "bigmodel",
        enable_itn: true,
        enable_punc: true,
      },
    })
  })

  it("parseVoiceAsrTranscript trims result text and rejects empty recognition", () => {
    expect(parseVoiceAsrTranscript({ result: { text: "  hello  " } })).toBe("hello")
    expect(() => parseVoiceAsrTranscript({ result: { text: "   " } })).toThrow(/No speech was recognized/)
    expect(() => parseVoiceAsrTranscript(undefined)).toThrow(/No speech was recognized/)
  })

  it("describeVoiceAsrFetchFailure includes network cause details", () => {
    const error = new Error("fetch failed")
    error.cause = { code: "ECONNRESET", message: "Client network socket disconnected" }
    expect(describeVoiceAsrFetchFailure(error)).toBe("fetch failed (ECONNRESET: Client network socket disconnected)")
  })
})
