import type { ChatContextMention } from "../../../electron/chat/common.ts"

import { describe, expect, it } from "vitest"
import { skillContextMentionLabel } from "./context-mention-label.ts"

describe("context mention labels", () => {
  it("uses a skill display title without replacing its runtime name", () => {
    const mention: ChatContextMention = {
      displayName: "浏览器",
      id: "browser",
      kind: "skill",
      name: "browser",
    }

    expect(skillContextMentionLabel(mention)).toBe("浏览器")
  })

  it("keeps historical skill mentions without a display title readable", () => {
    const mention: ChatContextMention = {
      id: "browser",
      kind: "skill",
      name: "browser",
    }

    expect(skillContextMentionLabel(mention)).toBe("browser")
  })
})
