import type { ChatMessagePart } from "../../../electron/chat/common.ts"

import { describe, expect, it } from "vitest"
import { knowledgeSources } from "./knowledge-sources.ts"
const output = {
  requestId: "request",
  items: [{ fileId: "file", filename: "policy.pdf", text: "Returns within 30 days", score: 0.9 }],
}
const part: ChatMessagePart = {
  kind: "tool",
  partId: "part",
  tool: "call_action",
  status: "completed",
  input: { service: "oomol_rag", action: "retrieve" },
  output: JSON.stringify(output),
}
describe("knowledge sources", () => {
  it("preserves source snippets from host and managed CLI history", () => {
    expect(knowledgeSources(part)?.[0]).toMatchObject({ file_id: "file", text: "Returns within 30 days" })
    expect(
      knowledgeSources({
        ...part,
        tool: "bash",
        input: { command: 'oo connector run oomol_rag --action retrieve --data \'{"query":"returns"}\' --json' },
        output: JSON.stringify({ result: output }),
      }),
    ).toEqual(knowledgeSources(part))
  })
  it("distinguishes no hits from failure, malformed data and unrelated tools", () => {
    expect(knowledgeSources({ ...part, output: JSON.stringify({ requestId: "r", items: [] }) })).toEqual([])
    expect(knowledgeSources({ ...part, status: "error" })).toBeNull()
    expect(knowledgeSources({ ...part, input: { service: "other", action: "retrieve" } })).toBeNull()
    expect(knowledgeSources({ ...part, output: JSON.stringify({ error: "unauthorized", ...output }) })).toBeNull()
    expect(
      knowledgeSources({ ...part, output: JSON.stringify({ requestId: "r", items: [{ text: "fabricated" }] }) }),
    ).toBeNull()
    expect(knowledgeSources({ ...part, output: "invalid" })).toBeNull()
  })
})
