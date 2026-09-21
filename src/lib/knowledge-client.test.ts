import { afterEach, expect, it, vi } from "vitest"
import { knowledgeUploadError, knowledgeUploadMaxBytes } from "../../electron/knowledge/common.ts"
import { knowledgeBaseUrl } from "./domain.ts"
import { listKnowledgeFiles, uploadKnowledgeFile, deleteKnowledgeFile, retrieveKnowledge } from "./knowledge-client.ts"
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
it("sends scoped cookie requests with encoded cursors and identifiers", async () => {
  const mock = vi.fn<typeof fetch>(async () => Response.json({ items: [], next_cursor: "" }))
  vi.stubGlobal("fetch", mock)
  await listKnowledgeFiles("team-1", "a+/b=")
  const url = new URL(String(mock.mock.calls[0][0]))
  expect(url.origin).toBe(knowledgeBaseUrl)
  expect(url.searchParams.get("cursor")).toBe("a+/b=")
  expect(new Headers(mock.mock.calls[0][1]?.headers).get("x-oo-team-id")).toBe("team-1")
  expect(mock.mock.calls[0][1]?.credentials).toBe("include")
  await deleteKnowledgeFile("team-1", "file/1")
  expect(new URL(String(mock.mock.calls[1][0])).pathname).toBe("/v1/files/file%2F1")
  expect(() => listKnowledgeFiles("")).toThrow(/team/)
})
it("does not impose the default deadline on uploads but preserves cancellation", async () => {
  const mock = vi.fn<typeof fetch>(async () => Response.json({}))
  const timeout = vi.spyOn(AbortSignal, "timeout")
  vi.stubGlobal("fetch", mock)
  const controller = new AbortController()
  await uploadKnowledgeFile("team-1", new File(["hello"], "guide.md"), controller.signal)
  const init = mock.mock.calls[0][1]!
  expect(init.body).toBeInstanceOf(FormData)
  expect(new Headers(init.headers).has("content-type")).toBe(false)
  expect(init.signal).toBe(controller.signal)
  expect(timeout).not.toHaveBeenCalled()
  controller.abort()
  expect(init.signal?.aborted).toBe(true)
})
it("uses HTTP retrieval field names and surfaces service failures", async () => {
  const mock = vi.fn<typeof fetch>(async () => Response.json({ request_id: "r", items: [] }))
  vi.stubGlobal("fetch", mock)
  await retrieveKnowledge("team-1", "policy")
  expect(JSON.parse(String(mock.mock.calls[0][1]?.body))).toEqual({ query: "policy", top_k: 5, enable_reranking: true })
  mock.mockResolvedValueOnce(new Response("service unavailable", { status: 503 }))
  await expect(retrieveKnowledge("team-1", "policy")).rejects.toThrow(/service unavailable/)
})
it("validates supported formats and the exact upload size boundary", () => {
  expect(knowledgeUploadError({ name: "SCAN.PDF", size: knowledgeUploadMaxBytes })).toBeNull()
  expect(knowledgeUploadError({ name: "scan.pdf", size: knowledgeUploadMaxBytes + 1 })).toBe("tooLarge")
  expect(knowledgeUploadError({ name: "data.csv", size: 10 })).toBe("unsupportedType")
  expect(knowledgeUploadError({ name: "pdf", size: 10 })).toBe("unsupportedType")
})
