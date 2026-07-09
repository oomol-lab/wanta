import type { ArtifactSelection } from "@/routes/Chat/GeneratedArtifacts"
import type { TurnOutputSelection } from "@/routes/Chat/TurnOutputs"

export type PanelSelectionSource = "auto" | "manual"

export type PanelSelection =
  | { kind: "empty" }
  | { kind: "artifact"; selection: ArtifactSelection; source: PanelSelectionSource }
  | { kind: "turnOutput"; selection: TurnOutputSelection; source: PanelSelectionSource }

export const EMPTY_PANEL_SELECTION: PanelSelection = { kind: "empty" }

export function releaseManualPanelSelection(selection: PanelSelection): PanelSelection {
  if (selection.kind === "empty" || selection.source === "auto") {
    return selection
  }
  return { ...selection, source: "auto" }
}

export function manualPanelSelectionLocked(selection: PanelSelection, panelOpen: boolean): boolean {
  return panelOpen && selection.kind !== "empty" && selection.source === "manual"
}

export function artifactPanelSelection(selection: ArtifactSelection, source: PanelSelectionSource): PanelSelection {
  return { kind: "artifact", selection, source }
}

export function turnOutputPanelSelection(selection: TurnOutputSelection, source: PanelSelectionSource): PanelSelection {
  return { kind: "turnOutput", selection, source }
}

export function panelSelectionMessageId(selection: PanelSelection): string | null {
  switch (selection.kind) {
    case "artifact":
      return selection.selection.messageId
    case "turnOutput":
      return selection.selection.record.messageId
    case "empty":
      return null
  }
}

export function nextArtifactPanelSelection(
  current: PanelSelection,
  selection: ArtifactSelection,
  panelOpen: boolean,
): PanelSelection {
  if (manualPanelSelectionLocked(current, panelOpen)) {
    return current
  }
  return artifactPanelSelection(selection, "auto")
}

export function nextTurnOutputPanelSelection(
  current: PanelSelection,
  selection: TurnOutputSelection,
  panelOpen: boolean,
): PanelSelection {
  if (manualPanelSelectionLocked(current, panelOpen)) {
    return current
  }
  if (current.kind === "artifact" && panelSelectionMessageId(current) === selection.record.messageId) {
    return current
  }
  return turnOutputPanelSelection(selection, "auto")
}
