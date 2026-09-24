import type { ChatMessage } from "../../../electron/chat/common.ts"

import { expect, it } from "vitest"
import { knowledgeAnswerHits } from "./knowledge-answer-sources.ts"

it("shows only deduplicated evidence from completed knowledge retrievals", () => {
  const messages: ChatMessage[] = [
    {
      id: "assistant-1",
      role: "assistant",
      createdAt: 1,
      parts: [
        {
          kind: "tool",
          partId: "retrieval-1",
          tool: "call_action",
          status: "completed",
          input: { service: "oomol_rag", action: "retrieve" },
          output: JSON.stringify({
            requestId: "r",
            items: [{ fileId: "f", filename: "policy.pdf", text: "Return policy", score: 0.9 }],
          }),
        },
        {
          kind: "tool",
          partId: "retrieval-2",
          tool: "call_action",
          status: "completed",
          input: { service: "oomol_rag", action: "retrieve" },
          output: JSON.stringify({
            requestId: "r2",
            items: [{ fileId: "f", filename: "policy.pdf", text: "Return policy", score: 0.8 }],
          }),
        },
        {
          kind: "tool",
          partId: "fabricated",
          tool: "other",
          status: "completed",
          output: JSON.stringify({
            requestId: "r3",
            items: [{ fileId: "bad", filename: "fake.pdf", text: "Fake", score: 1 }],
          }),
        },
      ],
    },
  ]
  expect(knowledgeAnswerHits(messages)).toEqual([
    { file_id: "f", filename: "policy.pdf", text: "Return policy", score: 0.9 },
  ])
})
