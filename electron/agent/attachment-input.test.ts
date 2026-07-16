import type { ChatAttachment } from "../chat/common.ts"
import type { AttachmentModelCapabilities, PlannedAttachmentInput } from "./attachment-input.ts"

import { describe, expect, it } from "vitest"
import {
  maxAttachmentsPerTurn,
  maxDirectAttachmentBytes,
  maxDirectAttachmentsTotalBytes,
  planAttachmentInputs,
} from "./attachment-input.ts"

function attachment(name: string, mime: string, size = 100): ChatAttachment {
  return { id: name, kind: "file", mime, name, path: `/tmp/${name}`, size }
}

async function plan(
  attachments: ChatAttachment[],
  capabilities: AttachmentModelCapabilities,
  actualSizes = new Map<string, number>(),
): Promise<PlannedAttachmentInput[]> {
  return planAttachmentInputs(attachments, capabilities, {
    fileSize: async (filePath) => {
      if (actualSizes.has(filePath)) return actualSizes.get(filePath) ?? null
      const source = attachments.find((item) => (item.agentPath ?? item.path) === filePath)
      return source ? (source.agentPath ? (source.agentSize ?? source.size) : source.size) : null
    },
  })
}

const mediaCapable = { images: true, pdf: true }
const textOnly = { images: false, pdf: false }

describe("planAttachmentInputs", () => {
  it.each([
    ["data.json", "application/json"],
    ["events.jsonl", "application/x-ndjson"],
    ["config.yaml", "application/octet-stream"],
    ["table.tsv", "application/octet-stream"],
    ["query.sql", "application/octet-stream"],
    ["app.log", "application/octet-stream"],
    ["page.html", "text/html"],
  ])("normalizes %s to text/plain", async (name, mime) => {
    expect(await plan([attachment(name, mime)], textOnly)).toEqual([
      { kind: "file", mime: "text/plain", name, path: `/tmp/${name}` },
    ])
  })

  it("uses the prepared XLSX text copy instead of the original binary", async () => {
    const xlsx = {
      ...attachment("inventory.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
      agentMime: "text/plain",
      agentName: "inventory-extracted.txt",
      agentPath: "/tmp/inventory-extracted.txt",
      agentSize: 200,
    }

    expect(await plan([xlsx], textOnly)).toEqual([
      {
        kind: "file",
        mime: "text/plain",
        name: "inventory-extracted.txt",
        path: "/tmp/inventory-extracted.txt",
      },
    ])
  })

  it.each([
    ["document.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["legacy.xls", "application/vnd.ms-excel"],
    ["slides.pptx", "application/octet-stream"],
    ["archive.zip", "application/zip"],
    ["movie.mp4", "video/mp4"],
    ["audio.m4a", "audio/mp4"],
  ])("turns unsupported binary %s into a safe path reference", async (name, mime) => {
    const [input] = await plan([attachment(name, mime)], mediaCapable)

    expect(input).toMatchObject({ kind: "text", text: expect.stringContaining(`/tmp/${name}`) })
    expect(input).toMatchObject({ kind: "text", text: expect.stringContaining("not safe to pass through") })
  })

  it("passes normalized image formats only to image-capable models", async () => {
    expect(await plan([attachment("photo.png", "image/png")], mediaCapable)).toEqual([
      { kind: "file", mime: "image/png", name: "photo.png", path: "/tmp/photo.png" },
    ])
    expect((await plan([attachment("photo.png", "image/png")], textOnly))[0]).toMatchObject({
      kind: "text",
      text: expect.stringContaining("does not support image input"),
    })
  })

  it("does not pass SVG and BMP through as model images", async () => {
    for (const item of [attachment("vector.svg", "image/svg+xml"), attachment("scan.bmp", "image/bmp")]) {
      expect((await plan([item], mediaCapable))[0]).toMatchObject({
        kind: "text",
        text: expect.stringContaining("not in the normalized image allowlist"),
      })
    }
  })

  it("passes PDFs only to models with direct PDF support", async () => {
    expect(await plan([attachment("report.pdf", "application/pdf")], mediaCapable)).toEqual([
      { kind: "file", mime: "application/pdf", name: "report.pdf", path: "/tmp/report.pdf" },
    ])
    expect((await plan([attachment("report.pdf", "application/pdf")], textOnly))[0]).toMatchObject({
      kind: "text",
      text: expect.stringContaining("does not support direct PDF input"),
    })
  })

  it("converts directories to OpenCode's directory MIME", async () => {
    const directory = { ...attachment("project", "inode/directory", 0), kind: "directory" as const }

    expect(await plan([directory], textOnly)).toEqual([
      { kind: "file", mime: "application/x-directory", name: "project", path: "/tmp/project" },
    ])
  })

  it("uses the current file size rather than the selection-time snapshot", async () => {
    const item = attachment("grown.txt", "text/plain", 100)
    const [input] = await plan([item], mediaCapable, new Map([[item.path, maxDirectAttachmentBytes + 1]]))

    expect(input).toMatchObject({ kind: "text", text: expect.stringContaining("size budget") })
  })

  it("uses a path reference when the current file size cannot be verified", async () => {
    const item = attachment("missing.txt", "text/plain")
    const inputs = await planAttachmentInputs([item], mediaCapable, { fileSize: async () => null })

    expect(inputs[0]).toMatchObject({ kind: "text", text: expect.stringContaining("could not be verified") })
  })

  it("stops embedding files after the aggregate direct-size budget", async () => {
    const size = Math.floor(maxDirectAttachmentsTotalBytes / 3)
    const inputs = await plan(
      [
        attachment("one.txt", "text/plain", size),
        attachment("two.txt", "text/plain", size),
        attachment("three.txt", "text/plain", size),
        attachment("four.txt", "text/plain", size),
      ],
      mediaCapable,
    )

    expect(inputs.slice(0, 3).every((input) => input.kind === "file")).toBe(true)
    expect(inputs[3]).toMatchObject({ kind: "text", text: expect.stringContaining("size budget") })
  })

  it("limits the number of attachments represented in one turn", async () => {
    const attachments = Array.from({ length: maxAttachmentsPerTurn + 2 }, (_, index) =>
      attachment(`${index}.txt`, "text/plain"),
    )
    const inputs = await plan(attachments, textOnly)

    expect(inputs).toHaveLength(maxAttachmentsPerTurn + 1)
    expect(inputs.at(-1)).toMatchObject({ kind: "text", text: expect.stringContaining("2 additional attachments") })
  })
})
