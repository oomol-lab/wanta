import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, test, vi } from "vitest"
import {
  buildVoiceAsrRequest,
  billingLogRanges,
  ChatServiceImpl,
  describeVoiceAsrFetchFailure,
  isAbortErrorMessage,
  parseVoiceAsrTranscript,
  readBillingLogs,
} from "./node.ts"

afterEach(() => {
  vi.unstubAllGlobals()
})

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

test("readBillingLogs accepts common response envelope shapes", () => {
  const log = {
    debitCredit: "0.1",
    eventID: "event-1",
    userID: "user-1",
    source: "SERVICE_LLM",
    subject: "oopilot",
    sourceType: "quota",
    serviceScope: "general",
    traceID: "trace-1",
    payload: {},
    createdAt: Date.now(),
  }

  assert.deepEqual(readBillingLogs({ items: [log] }), [log])
  assert.deepEqual(readBillingLogs({ data: { items: [log] } }), [log])
  assert.deepEqual(readBillingLogs([log]), [log])
  assert.deepEqual(readBillingLogs({ records: [log] }), [log])
  assert.deepEqual(readBillingLogs({ items: [null, log] }), [log])
})

test("billingLogRanges splits long record queries into backend-safe windows", () => {
  const dayMs = 24 * 60 * 60 * 1000
  const endTime = Date.UTC(2026, 5, 15)

  assert.deepEqual(billingLogRanges(7, endTime), [{ endTime, startTime: endTime - 7 * dayMs }])
  assert.deepEqual(billingLogRanges(90, endTime), [
    { endTime, startTime: endTime - 30 * dayMs },
    { endTime: endTime - 30 * dayMs, startTime: endTime - 60 * dayMs },
    { endTime: endTime - 60 * dayMs, startTime: endTime - 90 * dayMs },
  ])
  assert.deepEqual(billingLogRanges(Number.NaN, endTime), [{ endTime, startTime: endTime - 30 * dayMs }])
})

test("getBillingSummary caches the lightweight billing requests", async () => {
  const paths: string[] = []
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url)
    paths.push(url.pathname)
    if (url.pathname === "/v1/balance/available") {
      return Response.json({
        data: {
          items: [],
          total: { currentCredit: "10", originalCredit: "10" },
          deficit: "0",
        },
      })
    }
    if (url.pathname === "/v1/stats/billing" || url.pathname === "/v1/stats/metering") {
      return Response.json({
        data: {
          items: [],
          sourceTotals: {},
          total: { totalCredit: "0", eventCount: 0, totalUsage: "0" },
        },
      })
    }
    throw new Error(`Unexpected billing endpoint: ${url.pathname}`)
  })

  const service = new ChatServiceImpl(null)
  service.setBillingAccountContext({ token: "oomol-token", userId: "user-1" })

  const first = await service.getBillingSummary({ days: 30 })
  assert.equal(first.logs.length, 0)
  assert.equal(first.subscription, null)
  assert.equal(first.schedules.length, 0)
  assert.deepEqual([...paths].sort(), ["/v1/balance/available", "/v1/stats/billing", "/v1/stats/metering"].sort())

  await service.getBillingSummary({ days: 30 })
  assert.equal(paths.length, 3)

  await service.getBillingSummary({ days: 30, forceRefresh: true })
  assert.equal(paths.length, 6)
})

test("resolveLocalArtifacts resolves an explicit artifact root without scanning unrelated text paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumo-artifacts-"))
  const artifactRoot = path.join(root, "turn")
  const staleRoot = path.join(root, "stale")
  await mkdir(artifactRoot, { recursive: true })
  await mkdir(staleRoot, { recursive: true })
  await writeFile(path.join(artifactRoot, "fresh.png"), "fresh")
  await writeFile(path.join(staleRoot, "stale.png"), "stale")

  const service = new ChatServiceImpl(null)
  const result = await service.resolveLocalArtifacts({
    artifactRoot,
    text: `ignore ${staleRoot}`,
  })

  assert.equal(result.groups.length, 1)
  assert.equal(result.groups[0]?.root?.path, artifactRoot)
  assert.deepEqual(
    result.groups[0]?.items.map((item) => item.name),
    ["fresh.png"],
  )
})
