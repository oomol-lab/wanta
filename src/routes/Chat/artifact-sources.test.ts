import type { ChatMessage } from "../../../electron/chat/common.ts"

import { describe, expect, it } from "vitest"
import { turnArtifactSourcesByRenderMessage } from "./artifact-sources.ts"

function user(id: string, text: string, attachmentPath?: string): ChatMessage {
  return {
    id,
    role: "user",
    createdAt: 1,
    parts: [
      ...(attachmentPath
        ? [
            {
              kind: "attachment" as const,
              partId: `${id}-attachment`,
              attachment: {
                id: `${id}-file`,
                name: attachmentPath.split("/").pop() ?? "source.pdf",
                mime: "application/pdf",
                size: 1,
                path: attachmentPath,
              },
            },
          ]
        : []),
      { kind: "text", partId: `${id}-text`, text },
    ],
  }
}

function assistant(id: string, text: string, artifactRoot?: string): ChatMessage {
  return {
    id,
    role: "assistant",
    createdAt: 2,
    parts: text ? [{ kind: "text", partId: `${id}-text`, text }] : [],
    ...(artifactRoot ? { artifactRoot } : {}),
  }
}

describe("turnArtifactSourcesByRenderMessage", () => {
  it("renders one artifact source at the end of the assistant turn", () => {
    const sources = turnArtifactSourcesByRenderMessage([
      user("user-1", "Convert this PDF"),
      assistant("assistant-1", "I will create files.", "/tmp/lumo/artifacts/turn-1"),
      assistant("assistant-2", "Done: `/tmp/lumo/artifacts/turn-1/page.png`"),
    ])

    expect([...sources.keys()]).toEqual(["assistant-2"])
    expect(sources.get("assistant-2")).toEqual({
      messageId: "assistant-2",
      artifactRoot: "/tmp/lumo/artifacts/turn-1",
      sourcePaths: [],
      text: "I will create files.\nDone: `/tmp/lumo/artifacts/turn-1/page.png`",
    })
  })

  it("keeps text path sources even when no explicit artifact root is present", () => {
    const sources = turnArtifactSourcesByRenderMessage([
      user("user-1", "Convert this PDF"),
      assistant("assistant-1", "Output file: `/Users/me/Desktop/page.png`"),
    ])

    expect(sources.get("assistant-1")).toEqual({
      messageId: "assistant-1",
      sourcePaths: [],
      text: "Output file: `/Users/me/Desktop/page.png`",
    })
  })

  it("tracks user attachment paths as source files to exclude from artifacts", () => {
    const sources = turnArtifactSourcesByRenderMessage([
      user("user-1", "Convert this PDF", "/Users/me/Desktop/source.pdf"),
      assistant(
        "assistant-1",
        [
          "Source file: `/Users/me/Desktop/source.pdf`",
          "Output file: `/Users/me/Library/Application Support/Lumo/agent/artifacts/turn/page.png`",
        ].join("\n"),
      ),
    ])

    expect(sources.get("assistant-1")).toEqual({
      messageId: "assistant-1",
      sourcePaths: ["/Users/me/Desktop/source.pdf"],
      text: [
        "Source file: `/Users/me/Desktop/source.pdf`",
        "Output file: `/Users/me/Library/Application Support/Lumo/agent/artifacts/turn/page.png`",
      ].join("\n"),
    })
  })

  it("does not create a source for an empty assistant turn", () => {
    const sources = turnArtifactSourcesByRenderMessage([user("user-1", "Hello"), assistant("assistant-1", "")])

    expect(sources.size).toBe(0)
  })
})
