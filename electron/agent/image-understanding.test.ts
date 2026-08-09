import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { understandAttachedImages } from "./image-understanding.ts"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("understandAttachedImages", () => {
  it("sends safe images to Qwen 3.7 Plus and returns normalized structured context", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "wanta-image-understanding-"))
    const imagePath = path.join(directory, "screen.png")
    await writeFile(imagePath, "image bytes")
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: '```json\n{"summary":"设置页","images":[],"task_relevant_details":[]}\n```' } },
            ],
          }),
          { status: 200 },
        ),
    )
    vi.stubGlobal("fetch", fetchMock)

    try {
      const result = await understandAttachedImages(
        [{ id: "image-1", mime: "image/png", name: "screen.png", path: imagePath, size: 11 }],
        "这个页面有什么问题？",
        "session-token",
      )

      expect(result).toBe('{"summary":"设置页","images":[],"task_relevant_details":[]}')
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toMatch(/\/chat\/completions$/)
      expect(init.headers).toMatchObject({ Authorization: "Bearer session-token" })
      const body = JSON.parse(String(init.body)) as {
        max_tokens: number
        messages: Array<{ content: Array<{ image_url?: { url: string }; text?: string; type: string }> }>
        model: string
        response_format: { type: string }
      }
      expect(body.model).toBe("qwen3.7-plus")
      expect(body.max_tokens).toBe(4_096)
      expect(body.response_format).toEqual({ type: "json_object" })
      expect(body.messages[1]?.content).toContainEqual(
        expect.objectContaining({ text: expect.stringContaining("这个页面有什么问题？"), type: "text" }),
      )
      expect(body.messages[1]?.content).toContainEqual({
        image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) },
        type: "image_url",
      })
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it("does not call the provider when no safe image can be embedded", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const result = await understandAttachedImages(
      [{ id: "image-1", mime: "image/svg+xml", name: "vector.svg", path: "/missing.svg", size: 10 }],
      "describe it",
      "session-token",
    )

    expect(result).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
