import { expect, test } from "vitest"
import { MessageRunRegistry } from "./message-run-registry.ts"

test("message ownership survives completion, retry, and interleaved sessions", () => {
  const registry = new MessageRunRegistry()
  expect(registry.isCurrent("a", "message", "old")).toBe(true)
  expect(registry.isCurrent("a", "message", undefined)).toBe(false)
  expect(registry.isCurrent("a", "message", "new")).toBe(false)
  expect(registry.isCurrent("b", "message", "other")).toBe(true)
  expect(registry.isCurrent("a", "new-message", "new")).toBe(true)
})

test("a mismatched native parent makes subsequent parts stale as well", () => {
  const registry = new MessageRunRegistry()
  expect(registry.isCurrent("a", "late", "new", { parentMessageId: "old-user", userMessageId: "new-user" })).toBe(false)
  expect(registry.isCurrent("a", "late", "new")).toBe(false)
  expect(registry.isCurrent("a", "current", "new", { parentMessageId: "new-user", userMessageId: "new-user" })).toBe(
    true,
  )
})

test("the bounded index can be forgotten per session or reset with the backend", () => {
  const registry = new MessageRunRegistry(2)
  registry.isCurrent("a", "one", "old")
  registry.isCurrent("b", "two", "old")
  registry.isCurrent("b", "three", "old")
  // Only the oldest entry has been evicted.
  expect(registry.isCurrent("b", "two", "new")).toBe(false)
  expect(registry.isCurrent("a", "one", "new")).toBe(true)
  registry.forgetSession("a")
  expect(registry.isCurrent("a", "one", "replacement")).toBe(true)
  registry.clear()
  expect(registry.isCurrent("b", "three", "replacement")).toBe(true)
})
