import type { ChatMessage } from "../../chat/common.ts"

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { mintExternalSessionId } from "./session-id.ts"
import { ExternalTranscriptStore } from "./transcript-store.ts"

describe("external transcript store redaction", () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
  })

  test("redacts legacy files during load and migrates the sanitized content to disk", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "wanta-transcript-redaction-"))
    roots.push(directory)
    const sessionId = mintExternalSessionId("codex")
    const uuid = sessionId.split(":").at(-1)!
    const filePath = path.join(directory, `${uuid}.json`)
    const messages: ChatMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        createdAt: 1,
        parts: [
          {
            kind: "tool",
            partId: "tool-1",
            output: '{"api_token":"legacy-secret"}',
            metadata: { authorization: "Bearer legacy-secret" },
          },
        ],
      },
    ]
    await writeFile(filePath, JSON.stringify({ version: 1, messages }), "utf8")

    const loaded = await new ExternalTranscriptStore(directory).load(sessionId)

    expect(loaded?.[0]?.parts[0]?.output).toBe('{"api_token":"[redacted]"}')
    expect(loaded?.[0]?.parts[0]?.metadata).toEqual({ authorization: "[redacted]" })
    const migrated = await readFile(filePath, "utf8")
    expect(migrated).not.toContain("legacy-secret")
  })
})
