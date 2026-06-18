import type { ChatMessagePart } from "../../../electron/chat/common.ts"
import type { TranslateFn } from "@/i18n/i18n"

import { describe, expect, it } from "vitest"
import {
  classifyToolPart,
  compactPathDetail,
  compactToolDetail,
  formatToolActivityDuration,
  formatToolDuration,
  shouldShowRunningNoOutput,
  summarizeToolCategory,
  toolActivityTitle,
} from "./tool-activity.ts"

const labels: Record<string, string> = {
  "chat.toolCategoryConnector": "connector",
  "chat.toolCategoryShell": "shell",
  "chat.toolCategoryFile": "file",
  "chat.toolCategoryWeb": "web",
  "chat.toolCategoryTask": "task",
  "chat.toolCategorySkill": "skill",
  "chat.toolCategoryCustom": "custom",
  "chat.toolCategoryMixed": "mixed",
}

const t: TranslateFn = (key, vars) => {
  if (labels[key]) {
    return labels[key]
  }
  return `${key}:${vars?.count ?? ""}`
}

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
  it("uses the aggregate title for a single tool activity", () => {
    const title = toolActivityTitle(t, [toolPart("tool-1")], {
      hasActive: false,
      hasError: false,
      hasStopped: false,
    })

    expect(title).toBe("chat.toolActivityShellCompleted:1")
  })

  it("uses operation counts for grouped tool activities", () => {
    const title = toolActivityTitle(t, [toolPart("tool-1"), toolPart("tool-2")], {
      hasActive: true,
      hasError: false,
      hasStopped: false,
    })

    expect(title).toBe("chat.toolActivityShellRunning:2")
  })

  it("uses the stopped state when grouped tools were cancelled", () => {
    const title = toolActivityTitle(t, [toolPart("tool-1"), toolPart("tool-2")], {
      hasActive: false,
      hasError: false,
      hasStopped: true,
    })

    expect(title).toBe("chat.toolActivityShellStopped:2")
  })

  it("uses specific file operation summaries", () => {
    const title = toolActivityTitle(t, [toolPart("tool-1", { tool: "edit" })], {
      hasActive: false,
      hasError: false,
      hasStopped: false,
    })

    expect(title).toBe("chat.toolActivityFileEditCompleted:1")
  })

  it("appends duration when available", () => {
    const title = toolActivityTitle(t, [toolPart("tool-1")], {
      hasActive: false,
      hasError: false,
      hasStopped: false,
      duration: "1.5s",
    })

    expect(title).toBe("chat.toolActivityShellCompleted:1 · 1.5s")
  })

  it("falls back to generic tool calls for mixed categories", () => {
    const title = toolActivityTitle(
      t,
      [toolPart("tool-1", { tool: "bash" }), toolPart("tool-2", { tool: "call_action" })],
      {
        hasActive: false,
        hasError: false,
        hasStopped: false,
      },
    )

    expect(title).toBe("chat.toolActivityMixedCompleted:2")
  })
})

describe("classifyToolPart", () => {
  it("classifies known tool groups", () => {
    expect(classifyToolPart(toolPart("tool-1", { tool: "search_actions" }))).toBe("connector")
    expect(classifyToolPart(toolPart("tool-2", { tool: "bash" }))).toBe("shell")
    expect(classifyToolPart(toolPart("tool-3", { tool: "read" }))).toBe("file")
    expect(classifyToolPart(toolPart("tool-4", { tool: "webfetch" }))).toBe("web")
    expect(classifyToolPart(toolPart("tool-5", { tool: "task" }))).toBe("task")
    expect(classifyToolPart(toolPart("tool-6", { tool: "todo_write" }))).toBe("task")
    expect(classifyToolPart(toolPart("tool-7", { tool: "unknown", title: "Loaded skill: pdf" }))).toBe("skill")
    expect(classifyToolPart(toolPart("tool-8", { tool: "unknown" }))).toBe("custom")
  })

  it("summarizes a single category or mixed category", () => {
    expect(summarizeToolCategory([toolPart("tool-1", { tool: "bash" }), toolPart("tool-2", { tool: "bash" })])).toBe(
      "shell",
    )
    expect(summarizeToolCategory([toolPart("tool-1", { tool: "bash" }), toolPart("tool-2", { tool: "read" })])).toBe(
      "mixed",
    )
  })
})

describe("formatToolDuration", () => {
  it("formats completed tool duration from start and end times", () => {
    expect(formatToolDuration(toolPart("tool-1", { timing: { start: 1000, end: 2600 } }))).toBe("1.6s")
  })

  it("formats running tool duration against the current time", () => {
    expect(formatToolDuration(toolPart("tool-1", { status: "running", timing: { start: 1000 } }), 12_200)).toBe("11s")
  })

  it("does not keep timing cancelled running tools against the current time", () => {
    expect(
      formatToolDuration(toolPart("tool-1", { status: "running", cancelled: true, timing: { start: 1000 } }), 12_200),
    ).toBe(null)
    expect(
      formatToolDuration(
        toolPart("tool-2", { status: "running", cancelled: true, timing: { start: 1000, end: 2600 } }),
        12_200,
      ),
    ).toBe("1.6s")
  })
})

describe("formatToolActivityDuration", () => {
  it("formats the span covering all tool calls", () => {
    expect(
      formatToolActivityDuration([
        toolPart("tool-1", { timing: { start: 1000, end: 1800 } }),
        toolPart("tool-2", { timing: { start: 2000, end: 3600 } }),
      ]),
    ).toBe("3s")
  })

  it("uses current time for running activity duration", () => {
    expect(formatToolActivityDuration([toolPart("tool-1", { status: "running", timing: { start: 1000 } })], 3200)).toBe(
      "2s",
    )
  })

  it("does not extend cancelled running activity duration", () => {
    expect(
      formatToolActivityDuration(
        [toolPart("tool-1", { status: "running", cancelled: true, timing: { start: 1000, end: 2000 } })],
        3200,
      ),
    ).toBe("1s")
  })
})

describe("shouldShowRunningNoOutput", () => {
  it("shows the empty-output hint only for running bash calls without output", () => {
    expect(shouldShowRunningNoOutput(toolPart("tool-1", { status: "running" }))).toBe(true)
    expect(shouldShowRunningNoOutput(toolPart("tool-2", { status: "running", output: "done" }))).toBe(false)
    expect(shouldShowRunningNoOutput(toolPart("tool-3", { status: "completed" }))).toBe(false)
    expect(shouldShowRunningNoOutput(toolPart("tool-4", { status: "running", tool: "read" }))).toBe(false)
    expect(shouldShowRunningNoOutput(toolPart("tool-5", { status: "running", cancelled: true }))).toBe(false)
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
