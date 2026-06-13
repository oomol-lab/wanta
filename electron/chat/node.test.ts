import assert from "node:assert/strict"
import { test } from "vitest"
import { buildVoiceAsrRequest, parseVoiceAsrTranscript } from "./node.ts"

test("buildVoiceAsrRequest matches Studio voice ASR request shape", () => {
  const init = buildVoiceAsrRequest("oomol-token", "wav-base64", "request-1")
  const headers = new Headers(init.headers)

  assert.equal(init.method, "POST")
  assert.equal(init.credentials, "include")
  assert.equal(headers.get("Accept"), "application/json")
  assert.equal(headers.get("Authorization"), "Bearer oomol-token")
  assert.equal(headers.get("Content-Type"), "application/json")
  assert.equal(headers.get("X-Api-Request-Id"), "request-1")
  assert.deepEqual(JSON.parse(init.body as string), {
    user: { uid: "request-1" },
    audio: { data: "wav-base64" },
    request: {
      model_name: "bigmodel",
      enable_itn: true,
      enable_punc: true,
    },
  })
})

test("parseVoiceAsrTranscript trims result text and rejects empty recognition", () => {
  assert.equal(parseVoiceAsrTranscript({ result: { text: "  hello  " } }), "hello")
  assert.throws(() => parseVoiceAsrTranscript({ result: { text: "   " } }), /No speech was recognized/)
  assert.throws(() => parseVoiceAsrTranscript(undefined), /No speech was recognized/)
})
