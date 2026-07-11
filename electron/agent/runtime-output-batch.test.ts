import { describe, expect, it } from "vitest"
import { RuntimeOutputBatch } from "./runtime-output-batch.ts"

describe("RuntimeOutputBatch", () => {
  it("retains bounded samples and counts dropped lines", () => {
    const batch = new RuntimeOutputBatch(2)
    batch.add("first", false)
    batch.add("second", true)
    batch.add("third", false)

    expect(batch.take()).toEqual({
      droppedLineCount: 1,
      lineCount: 3,
      lines: ["first", "second"],
      truncatedLineCount: 1,
    })
    expect(batch.take()).toBeNull()
  })
})
