import type { ChatMessagePart } from "../../../electron/chat/common.ts"
import type { TranslateFn } from "@/i18n/i18n"

import { describe, expect, it } from "vitest"
import {
  compactPathDetail,
  compactToolDetail,
  formatToolDuration,
  shouldShowRunningNoOutput,
  toolActivityTitle,
} from "./tool-activity.ts"

const t: TranslateFn = (key, vars) => `${key}:${vars?.count ?? ""}`

function toolPart(partId: string, extra: Partial<ChatMessagePart> = {}): ChatMessagePart {
  return {
    kind: "tool",
    partId,
    callId: partId,
    tool: "bash",
    status: "completed",
    input: {},
    ...extra,
  }
}

describe("toolActivityTitle", () => {
  it("uses the tool summary for a single tool activity", () => {
    const title = toolActivityTitle(t, [toolPart("tool-1")], {
      hasActive: false,
      hasError: false,
      hasStopped: false,
      singleSummary: "运行命令：sleep 60",
    })

    expect(title).toBe("运行命令：sleep 60")
  })

  it("uses operation counts for grouped tool activities", () => {
    const title = toolActivityTitle(t, [toolPart("tool-1"), toolPart("tool-2")], {
      hasActive: true,
      hasError: false,
      hasStopped: false,
      singleSummary: "运行命令：sleep 60",
    })

    expect(title).toBe("chat.toolActivityRunning:2")
  })

  it("uses the stopped state when grouped tools were cancelled", () => {
    const title = toolActivityTitle(t, [toolPart("tool-1"), toolPart("tool-2")], {
      hasActive: false,
      hasError: false,
      hasStopped: true,
    })

    expect(title).toBe("chat.toolActivityStopped:2")
  })
})

describe("formatToolDuration", () => {
  it("formats completed tool duration from start and end times", () => {
    expect(formatToolDuration(toolPart("tool-1", { timing: { start: 1000, end: 2600 } }))).toBe("1.6s")
  })

  it("formats running tool duration against the current time", () => {
    expect(formatToolDuration(toolPart("tool-1", { status: "running", timing: { start: 1000 } }), 12_200)).toBe("11s")
  })
})

describe("shouldShowRunningNoOutput", () => {
  it("shows the empty-output hint only for running bash calls without output", () => {
    expect(shouldShowRunningNoOutput(toolPart("tool-1", { status: "running" }))).toBe(true)
    expect(shouldShowRunningNoOutput(toolPart("tool-2", { status: "running", output: "done" }))).toBe(false)
    expect(shouldShowRunningNoOutput(toolPart("tool-3", { status: "completed" }))).toBe(false)
    expect(shouldShowRunningNoOutput(toolPart("tool-4", { status: "running", tool: "read" }))).toBe(false)
  })
})

describe("compactToolDetail", () => {
  it("compresses whitespace and truncates long command details", () => {
    expect(compactToolDetail("python3   -c   \"print('hello world')\"  && echo done", 24)).toBe(
      "python3 -c \"print('hell…",
    )
  })

  it("keeps long path endings visible with middle truncation", () => {
    expect(compactPathDetail("/Users/wushuang/Desktop/deeply/nested/output/2606.00219v1-page-21.png", 32)).toBe(
      "/Users/wushu…00219v1-page-21.png",
    )
  })
})
