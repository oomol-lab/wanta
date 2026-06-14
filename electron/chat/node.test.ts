import assert from "node:assert/strict"
import { test } from "vitest"
import {
  buildVoiceAsrRequest,
  describeVoiceAsrFetchFailure,
  isAbortErrorMessage,
  parseVoiceAsrTranscript,
} from "./node.ts"

test("buildVoiceAsrRequest matches Studio voice ASR request shape", () => {
  const init = buildVoiceAsrRequest("oomol-token", "wav-base64", "request-1")
  const headers = new Headers(init.headers)

  assert.equal(init.method, "POST")
  assert.equal(init.credentials, "include")
  assert.equal(headers.get("Accept"), "application/json")
  assert.equal(headers.get("Authorization"), "Bearer oomol-token")
  assert.equal(headers.get("Content-Type"), "application/json")
  assert.equal(headers.get("Cookie"), "oomol-token=oomol-token")
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

test("isAbortErrorMessage recognizes controlled stop errors only", () => {
  assert.equal(isAbortErrorMessage("Aborted"), true)
  assert.equal(isAbortErrorMessage("AbortError"), true)
  assert.equal(isAbortErrorMessage("AbortError: The operation was aborted."), true)
  assert.equal(isAbortErrorMessage("The operation was aborted."), true)
  assert.equal(isAbortErrorMessage("Task failed"), false)
  assert.equal(isAbortErrorMessage("Remote service cancelled the request"), false)
})

test("describeVoiceAsrFetchFailure includes network cause details", () => {
  const error = new TypeError("fetch failed", {
    cause: Object.assign(new Error("Client network socket disconnected"), { code: "ECONNRESET" }),
  })

  assert.equal(describeVoiceAsrFetchFailure(error), "fetch failed (ECONNRESET: Client network socket disconnected)")
})
