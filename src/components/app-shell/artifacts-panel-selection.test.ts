import type { LocalArtifactItem, TurnOutputRecord } from "../../../electron/chat/common.ts"
import type { ArtifactSelection } from "@/routes/Chat/GeneratedArtifacts"
import type { TurnOutputSelection } from "@/routes/Chat/TurnOutputs"

import { describe, expect, test } from "vitest"
import {
  artifactPanelSelection,
  EMPTY_PANEL_SELECTION,
  nextArtifactPanelSelection,
  nextTurnOutputPanelSelection,
  releaseManualPanelSelection,
  turnOutputPanelSelection,
} from "./artifacts-panel-selection.ts"

function artifactItem(path: string): LocalArtifactItem {
  return {
    kind: "file",
    mime: "text/plain",
    name: path.split("/").pop() ?? "file.txt",
    path,
    size: 1,
  }
}

function artifactSelection(messageId: string, filePath = `/tmp/${messageId}.txt`): ArtifactSelection {
  const item = artifactItem(filePath)
  return {
    messageId,
    group: {
      items: [item],
      totalItems: 1,
      truncated: false,
    },
    selectedPath: item.path,
  }
}

function turnOutputSelection(messageId: string, filePath = `/tmp/${messageId}.log`): TurnOutputSelection {
  const record: TurnOutputRecord = {
    sessionId: "session-1",
    messageId,
    createdAt: 1,
    completedAt: 2,
    files: [
      {
        additions: 1,
        changeKind: "added",
        deletions: 0,
        mime: "text/plain",
        name: filePath.split("/").pop() ?? "file.log",
        path: filePath,
        role: "process",
      },
    ],
    summary: {
      additions: 1,
      changedFileCount: 0,
      deletions: 0,
      processFileCount: 1,
    },
  }
  return { record, initialRole: "process", selectedPath: filePath }
}

describe("artifacts panel selection", () => {
  test("auto artifact availability selects the artifact from an empty panel", () => {
    const selection = artifactSelection("assistant-1")

    expect(nextArtifactPanelSelection(EMPTY_PANEL_SELECTION, selection, false)).toEqual(
      artifactPanelSelection(selection, "auto"),
    )
  })

  test("manual selection blocks automatic replacement while the panel is open", () => {
    const current = artifactPanelSelection(artifactSelection("assistant-1"), "manual")
    const incoming = artifactSelection("assistant-2")

    expect(nextArtifactPanelSelection(current, incoming, true)).toBe(current)
  })

  test("closing the panel releases manual selection back to auto", () => {
    const selection = artifactSelection("assistant-1")
    const current = artifactPanelSelection(selection, "manual")

    expect(releaseManualPanelSelection(current)).toEqual(artifactPanelSelection(selection, "auto"))
  })

  test("turn output does not replace an artifact from the same assistant message", () => {
    const current = artifactPanelSelection(artifactSelection("assistant-1"), "auto")
    const incoming = turnOutputSelection("assistant-1")

    expect(nextTurnOutputPanelSelection(current, incoming, false)).toBe(current)
  })

  test("turn output replaces an older automatic artifact selection", () => {
    const current = artifactPanelSelection(artifactSelection("assistant-1"), "auto")
    const incoming = turnOutputSelection("assistant-2")

    expect(nextTurnOutputPanelSelection(current, incoming, false)).toEqual(turnOutputPanelSelection(incoming, "auto"))
  })
})
