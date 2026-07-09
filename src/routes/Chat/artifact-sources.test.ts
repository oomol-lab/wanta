import type { ChatMessage } from "../../../electron/chat/common.ts"

import { describe, expect, it } from "vitest"
import {
  collectGeneratedArtifactSources,
  collectVisibleGeneratedArtifactSources,
  hasLocalPathReference,
} from "./artifact-sources.ts"

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

describe("collectGeneratedArtifactSources", () => {
  it("collects one artifact source for an assistant turn", () => {
    const sources = collectGeneratedArtifactSources([
      user("user-1", "Convert this PDF"),
      assistant("assistant-1", "I will create files.", "/tmp/wanta/artifacts/turn-1"),
      assistant("assistant-2", "Done: `/tmp/wanta/artifacts/turn-1/page.png`"),
    ])

    expect(sources).toEqual([
      {
        messageId: "assistant-2",
        requestText: "Convert this PDF",
        artifactRoot: "/tmp/wanta/artifacts/turn-1",
        sourcePaths: [],
        text: "I will create files.\nDone: `/tmp/wanta/artifacts/turn-1/page.png`",
      },
    ])
  })

  it("keeps text path sources even when no explicit artifact root is present", () => {
    const sources = collectGeneratedArtifactSources([
      user("user-1", "Convert this PDF"),
      assistant("assistant-1", "Output file: `/Users/me/Desktop/page.png`"),
    ])

    expect(sources).toEqual([
      {
        messageId: "assistant-1",
        requestText: "Convert this PDF",
        sourcePaths: [],
        text: "Output file: `/Users/me/Desktop/page.png`",
      },
    ])
  })

  it("tracks user attachment paths as source files to exclude from artifacts", () => {
    const sources = collectGeneratedArtifactSources([
      user("user-1", "Convert this PDF", "/Users/me/Desktop/source.pdf"),
      assistant(
        "assistant-1",
        [
          "Source file: `/Users/me/Desktop/source.pdf`",
          "Output file: `/Users/me/Library/Application Support/Wanta/agent/artifacts/turn/page.png`",
        ].join("\n"),
      ),
    ])

    expect(sources).toEqual([
      {
        messageId: "assistant-1",
        requestText: "Convert this PDF",
        sourcePaths: ["/Users/me/Desktop/source.pdf"],
        text: [
          "Source file: `/Users/me/Desktop/source.pdf`",
          "Output file: `/Users/me/Library/Application Support/Wanta/agent/artifacts/turn/page.png`",
        ].join("\n"),
      },
    ])
  })

  it("does not create a source for an empty assistant turn", () => {
    const sources = collectGeneratedArtifactSources([user("user-1", "Hello"), assistant("assistant-1", "")])

    expect(sources).toHaveLength(0)
  })

  it("does not create a source for plain assistant text without a local path", () => {
    const sources = collectGeneratedArtifactSources([
      user("user-1", "Create an image"),
      assistant("assistant-1", "The image is ready."),
    ])

    expect(sources).toHaveLength(0)
  })
})

describe("hasLocalPathReference", () => {
  it("detects code and plain local path references", () => {
    expect(hasLocalPathReference("Output: `/Users/me/Desktop/result.png`")).toBe(true)
    expect(hasLocalPathReference("Saved to /tmp/wanta/result.csv")).toBe(true)
    expect(hasLocalPathReference("Open file:///Users/me/report.pdf")).toBe(true)
    expect(hasLocalPathReference("The image is ready.")).toBe(false)
  })
})

describe("collectVisibleGeneratedArtifactSources", () => {
  it("hides only the active assistant artifact source while a turn is generating", () => {
    const messages = [
      user("user-1", "Create an image"),
      assistant("assistant-1", "Output file: `/tmp/wanta/image.png`"),
      user("user-2", "Create another image"),
      assistant("assistant-2", "Output file: `/tmp/wanta/second.png`"),
    ]

    expect(collectVisibleGeneratedArtifactSources(messages, true)).toEqual([
      {
        messageId: "assistant-1",
        requestText: "Create an image",
        sourcePaths: [],
        text: "Output file: `/tmp/wanta/image.png`",
      },
    ])
  })

  it("keeps historical artifact sources while waiting for the first active assistant event", () => {
    const messages = [
      user("user-1", "Create an image"),
      assistant("assistant-1", "Output file: `/tmp/wanta/image.png`"),
      user("user-2", "Create another image"),
    ]

    expect(collectVisibleGeneratedArtifactSources(messages, true)).toEqual([
      {
        messageId: "assistant-1",
        requestText: "Create an image",
        sourcePaths: [],
        text: "Output file: `/tmp/wanta/image.png`",
      },
    ])
  })

  it("ignores stopped turns that only contain plain text", () => {
    const messages = [
      user("user-1", "Create an image"),
      assistant("assistant-1", "Output file: `/tmp/wanta/image.png`"),
      user("user-2", "Describe the result"),
      assistant("assistant-2", "The image is ready."),
    ]

    expect(collectVisibleGeneratedArtifactSources(messages, false)).toEqual([
      {
        messageId: "assistant-1",
        requestText: "Create an image",
        sourcePaths: [],
        text: "Output file: `/tmp/wanta/image.png`",
      },
    ])
  })

  it("keeps older artifact sources when the latest assistant turn is empty", () => {
    const messages = [
      user("user-1", "Create an image"),
      assistant("assistant-1", "Output file: `/tmp/wanta/image.png`"),
      user("user-2", "Say nothing"),
      assistant("assistant-2", ""),
    ]

    expect(collectVisibleGeneratedArtifactSources(messages, false)).toEqual([
      {
        messageId: "assistant-1",
        requestText: "Create an image",
        sourcePaths: [],
        text: "Output file: `/tmp/wanta/image.png`",
      },
    ])
  })
})
