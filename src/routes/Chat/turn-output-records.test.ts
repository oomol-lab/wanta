import type { ChatMessage, TurnOutputRecord } from "../../../electron/chat/common.ts"

import { describe, expect, it } from "vitest"
import { groupChatTurns } from "./chat-turns.ts"
import {
  turnOutputInitialRole,
  turnOutputRecordsByMessageId,
  turnOutputRecordsByTurnId,
} from "./turn-output-records.ts"

function message(id: string, role: ChatMessage["role"]): ChatMessage {
  return { id, role, createdAt: Number(id.replace(/\D/g, "")) || 1, parts: [] }
}

function record(messageId: string, changedFileCount: number, processFileCount: number): TurnOutputRecord {
  return {
    sessionId: "session-1",
    messageId,
    createdAt: Number(messageId.replace(/\D/g, "")) || 1,
    completedAt: Number(messageId.replace(/\D/g, "")) || 1,
    files: [],
    summary: {
      artifactCount: 0,
      changedFileCount,
      processFileCount,
      additions: 0,
      deletions: 0,
    },
  }
}

describe("turn output record grouping", () => {
  it("maps records to their assistant message id", () => {
    const first = record("a1", 1, 0)
    const second = record("a2", 0, 2)

    expect(turnOutputRecordsByMessageId([first, second])).toEqual(
      new Map([
        ["a1", first],
        ["a2", second],
      ]),
    )
  })

  it("keeps the latest record for a multi-assistant turn", () => {
    const turns = groupChatTurns([
      message("u1", "user"),
      message("a1", "assistant"),
      message("a2", "assistant"),
      message("u2", "user"),
      message("a3", "assistant"),
    ])
    const first = record("a1", 1, 0)
    const second = record("a2", 0, 2)
    const third = record("a3", 1, 1)

    expect(turnOutputRecordsByTurnId(turns, turnOutputRecordsByMessageId([first, second, third]))).toEqual(
      new Map([
        [turns[0]!.id, second],
        [turns[1]!.id, third],
      ]),
    )
  })

  it("prefers project changes as the initial panel role", () => {
    expect(turnOutputInitialRole(record("a1", 1, 3))).toBe("project_change")
    expect(turnOutputInitialRole(record("a2", 0, 3))).toBe("process")
  })
})
