import type { ChatMessage, ChatMessagePart } from "../../../electron/chat/common.ts"
import type { ComposerHistoryStorage } from "./composer-history.ts"

import { describe, expect, it } from "vitest"
import {
  appendStoredComposerHistory,
  buildComposerHistory,
  composerHistoryStorageKey,
  mergeComposerHistories,
  navigateComposerHistory,
  readStoredComposerHistory,
} from "./composer-history.ts"

function createStorage(): ComposerHistoryStorage & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    values,
  }
}

function message(
  createdAt: number,
  role: ChatMessage["role"],
  text: string,
): Pick<ChatMessage, "createdAt" | "parts" | "role"> {
  const parts: ChatMessagePart[] = text ? [{ kind: "text", partId: `text-${createdAt}`, text }] : []
  return { createdAt, parts, role }
}

describe("composer history", () => {
  it("builds chronological history from visible user and queued text", () => {
    expect(
      buildComposerHistory(
        [message(10, "user", "first"), message(20, "assistant", "ignored"), message(30, "user", "third")],
        [{ createdAt: 20, text: "second" }],
      ),
    ).toEqual(["first", "second", "third"])
  })

  it("strips synthetic attachment prelude and ignores empty entries", () => {
    expect(
      buildComposerHistory(
        [
          message(10, "user", 'Called the Read tool with the following input: {"filePath":"/tmp/a.png"}  describe it'),
          message(20, "user", 'Called the Read tool with the following input: {"filePath":"/tmp/b.png"}'),
        ],
        [{ createdAt: 30, text: "   " }],
      ),
    ).toEqual(["describe it"])
  })

  it("deduplicates consecutive prompts and keeps the newest limit", () => {
    expect(
      buildComposerHistory(
        [
          message(10, "user", "first"),
          message(20, "user", "same"),
          message(30, "user", "same"),
          message(40, "user", "last"),
        ],
        [],
        2,
      ),
    ).toEqual(["same", "last"])
    expect(buildComposerHistory([message(10, "user", "first")], [], 0)).toEqual([])
  })

  it("keeps the newest 20 prompts by default", () => {
    const messages = Array.from({ length: 25 }, (_, index) => message(index, "user", `prompt ${index + 1}`))

    const history = buildComposerHistory(messages, [])

    expect(history).toHaveLength(20)
    expect(history[0]).toBe("prompt 6")
    expect(history.at(-1)).toBe("prompt 25")
  })

  it("persists the newest 20 prompts within an account and workspace scope", () => {
    const storage = createStorage()
    const scope = "user-1:team:team-1"
    for (let index = 1; index <= 25; index += 1) {
      appendStoredComposerHistory(scope, `prompt ${index}`, storage)
    }

    expect(readStoredComposerHistory(scope, storage)).toEqual(
      Array.from({ length: 20 }, (_, index) => `prompt ${index + 6}`),
    )
    expect(readStoredComposerHistory("user-1:team:team-2", storage)).toEqual([])
    expect(readStoredComposerHistory("user-2:team:team-1", storage)).toEqual([])
  })

  it("deduplicates consecutive stored prompts and ignores invalid storage", () => {
    const storage = createStorage()
    const scope = "user-1:team:team-1"

    expect(appendStoredComposerHistory(scope, " same ", storage)).toEqual(["same"])
    expect(appendStoredComposerHistory(scope, "same", storage)).toEqual(["same"])
    storage.values.set(composerHistoryStorageKey(scope), "{broken")
    expect(readStoredComposerHistory(scope, storage)).toEqual([])
  })

  it("merges current-chat fallback with newer workspace history", () => {
    expect(mergeComposerHistories(["old", "shared", "current"], ["shared", "latest"])).toEqual([
      "old",
      "current",
      "shared",
      "latest",
    ])
  })

  it("wraps backward and navigates forward to an empty composer", () => {
    const history = ["first", "second", "third"]
    expect(navigateComposerHistory(history, null, "older")).toEqual({ index: 2, text: "third" })
    expect(navigateComposerHistory(history, 2, "older")).toEqual({ index: 1, text: "second" })
    expect(navigateComposerHistory(history, 0, "older")).toEqual({ index: 2, text: "third" })
    expect(navigateComposerHistory(history, 1, "newer")).toEqual({ index: 2, text: "third" })
    expect(navigateComposerHistory(history, 2, "newer")).toEqual({ index: null, text: "" })
  })

  it("does not navigate forward before history browsing starts", () => {
    expect(navigateComposerHistory(["first"], null, "newer")).toBeNull()
    expect(navigateComposerHistory([], null, "older")).toBeNull()
  })
})
