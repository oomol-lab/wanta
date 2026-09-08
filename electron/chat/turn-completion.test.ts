import type { ChatMessage } from "./common.ts"

import { expect, test } from "vitest"
import { completionFailureMessage, inspectTurnCompletion } from "./turn-completion.ts"

const user: ChatMessage = { id: "user", role: "user", createdAt: 1, parts: [] }
const tools: ChatMessage = {
  id: "tools",
  role: "assistant",
  createdAt: 2,
  completedAt: 3,
  finishReason: "tool-calls",
  parts: [{ kind: "tool", partId: "part", callId: "call", status: "error" }],
}
const final: ChatMessage = {
  id: "final",
  role: "assistant",
  createdAt: 4,
  completedAt: 5,
  finishReason: "stop",
  parts: [],
}
const rejection = { source: "policy" as const, reason: "environment_dump", messageId: "tools", callId: "call" }

test("a final response after a rejected tool completes normally", () => {
  expect(inspectTurnCompletion([user, tools, final], user.id, [rejection])).toEqual({
    kind: "completed",
    assistant: final,
  })
})

test("a previous rejection cannot explain a later unfinished step or another tool's error", () => {
  expect(inspectTurnCompletion([user, tools, { ...tools, id: "later" }], user.id, [rejection])).toEqual({
    kind: "missing_response",
  })
  expect(inspectTurnCompletion([user, tools], user.id, [{ ...rejection, callId: "other" }])).toEqual({
    kind: "missing_response",
  })
})

test("a later user turn cannot supply this turn's final response", () => {
  expect(inspectTurnCompletion([user, tools, { ...user, id: "next-user" }, final], user.id, [rejection])).toEqual({
    kind: "permission_blocked",
    rejection,
  })
})

test("missing response and unreadable history have different diagnostics", () => {
  expect(inspectTurnCompletion([], user.id)).toEqual({ kind: "missing_turn" })
  expect(inspectTurnCompletion([user, tools], user.id)).toEqual({ kind: "missing_response" })
  expect(completionFailureMessage({ kind: "history_unavailable" })).toMatch(/^CHAT_HISTORY_UNAVAILABLE:/)
  expect(completionFailureMessage({ kind: "missing_response" })).toMatch(/^CHAT_RESPONSE_INCOMPLETE:/)
})

test.each(["pending", "running"] as const)("%s tools take precedence over a terminal message timestamp", (status) => {
  expect(
    inspectTurnCompletion([user, { ...final, parts: [{ kind: "tool", partId: "part", status }] }], user.id),
  ).toEqual({ kind: "tools_running" })
})
