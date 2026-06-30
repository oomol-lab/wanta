import type { ChatAttachment, ChatMessage } from "../../electron/chat/common.ts"

import { describe, expect, it } from "vitest"
import { setAttachmentPart } from "./chat-message-state.ts"

const attachment: ChatAttachment = {
  id: "file-1",
  name: "report.pdf",
  mime: "application/pdf",
  size: 12,
  path: "/tmp/report.pdf",
  kind: "file",
}

describe("chat message state", () => {
  it("keeps assistant role when an attachment arrives for an existing assistant message", () => {
    const messages: ChatMessage[] = [{ id: "assistant-1", role: "assistant", parts: [], createdAt: 1 }]

    const next = setAttachmentPart(messages, {
      sessionId: "session-1",
      messageId: "assistant-1",
      partId: "file-1",
      attachment,
    })

    expect(next[0]).toMatchObject({
      id: "assistant-1",
      role: "assistant",
      parts: [{ kind: "attachment", partId: "file-1", attachment }],
    })
  })

  it("keeps the historical user fallback when attachment arrives before messageStarted", () => {
    const next = setAttachmentPart([], {
      sessionId: "session-1",
      messageId: "user-1",
      partId: "file-1",
      attachment,
    })

    expect(next[0]).toMatchObject({
      id: "user-1",
      role: "user",
      parts: [{ kind: "attachment", partId: "file-1", attachment }],
    })
  })
})
