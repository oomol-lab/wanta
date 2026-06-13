import { describe, expect, it } from "vitest"
import { buildSessionTitle } from "./session-title.ts"

describe("buildSessionTitle", () => {
  it("normalizes whitespace", () => {
    expect(buildSessionTitle("  查   Hacker News\n热门故事  ")).toBe("查 Hacker News 热门故事")
  })

  it("truncates by visible characters", () => {
    expect(buildSessionTitle("检查图卡编码与点击对话并调整侧边任务栏的新建机制")).toBe(
      "检查图卡编码与点击对话并调整侧边任务栏的新建机制",
    )
    expect(buildSessionTitle("检查图卡编码与点击对话并调整侧边任务栏的新建机制同时优化聊天区域布局")).toBe(
      "检查图卡编码与点击对话并调整侧边任务栏的新建机制同时优化...",
    )
  })
})
