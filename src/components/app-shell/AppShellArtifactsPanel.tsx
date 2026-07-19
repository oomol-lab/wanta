import type { ArtifactSelection } from "@/routes/Chat/GeneratedArtifacts"
import type { TurnOutputSelection } from "@/routes/Chat/TurnOutputs"

import * as React from "react"
import { ARTIFACTS_PANEL_MIN_WIDTH_PX } from "./app-shell-model.ts"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

const ArtifactsPanel = React.lazy(() =>
  import("@/routes/Chat/GeneratedArtifacts").then((module) => ({ default: module.ArtifactsPanel })),
)
const TurnOutputsPanel = React.lazy(() =>
  import("@/routes/Chat/TurnOutputs").then((module) => ({ default: module.TurnOutputsPanel })),
)

export const AppShellArtifactsPanel = React.memo(function AppShellArtifactsPanel({
  artifactSelection,
  artifactsPanelContentRef,
  artifactsPanelIsMaximized,
  artifactsPanelMaxWidthState,
  artifactsPanelShellRef,
  artifactsPanelVisible,
  handleArtifactsPanelResizeKeyDown,
  handleArtifactsPanelResizeStart,
  isArtifactsPanelResizing,
  setArtifactsPanelMaximizedState,
  setArtifactsPanelOpen,
  turnOutputSelection,
  visibleArtifactsPanelWidth,
}: {
  artifactSelection: ArtifactSelection | null
  artifactsPanelContentRef: React.RefObject<HTMLDivElement | null>
  artifactsPanelIsMaximized: boolean
  artifactsPanelMaxWidthState: number | null
  artifactsPanelShellRef: React.RefObject<HTMLDivElement | null>
  artifactsPanelVisible: boolean
  handleArtifactsPanelResizeKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  handleArtifactsPanelResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void
  isArtifactsPanelResizing: boolean
  setArtifactsPanelMaximizedState: (maximized: boolean) => void
  setArtifactsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  turnOutputSelection: TurnOutputSelection | null
  visibleArtifactsPanelWidth: number
}) {
  const t = useT()

  return (
    <div
      ref={artifactsPanelShellRef}
      className={cn(
        "oo-artifacts-panel-shell relative min-h-0 overflow-hidden",
        artifactsPanelIsMaximized ? "min-w-0 flex-1 shrink" : "shrink-0",
        artifactsPanelIsMaximized && "oo-artifacts-panel-maximized",
        isArtifactsPanelResizing ? "transition-none" : "transition-[width,opacity,transform] duration-200 ease-out",
        artifactsPanelVisible ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-3 opacity-0",
      )}
      style={{
        width: artifactsPanelVisible
          ? artifactsPanelIsMaximized
            ? undefined
            : `${visibleArtifactsPanelWidth}px`
          : "0px",
      }}
    >
      {!artifactsPanelIsMaximized ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("aria.resizeArtifactsPanel")}
          aria-valuemin={ARTIFACTS_PANEL_MIN_WIDTH_PX}
          aria-valuemax={artifactsPanelMaxWidthState ?? undefined}
          aria-valuenow={visibleArtifactsPanelWidth}
          title={t("aria.resizeArtifactsPanel")}
          tabIndex={artifactsPanelVisible ? 0 : -1}
          className="oo-artifacts-panel-resize-handle"
          onPointerDown={handleArtifactsPanelResizeStart}
          onKeyDown={handleArtifactsPanelResizeKeyDown}
        />
      ) : null}
      <div ref={artifactsPanelContentRef} className="h-full w-full min-w-0">
        {artifactsPanelVisible ? (
          <React.Suspense fallback={null}>
            {turnOutputSelection ? (
              <TurnOutputsPanel
                maximized={artifactsPanelIsMaximized}
                selection={turnOutputSelection}
                onCollapse={() => {
                  setArtifactsPanelOpen(false)
                  setArtifactsPanelMaximizedState(false)
                }}
                onToggleMaximized={() => setArtifactsPanelMaximizedState(!artifactsPanelIsMaximized)}
              />
            ) : (
              <ArtifactsPanel
                maximized={artifactsPanelIsMaximized}
                selection={artifactSelection}
                onCollapse={() => {
                  setArtifactsPanelOpen(false)
                  setArtifactsPanelMaximizedState(false)
                }}
                onToggleMaximized={() => setArtifactsPanelMaximizedState(!artifactsPanelIsMaximized)}
              />
            )}
          </React.Suspense>
        ) : null}
      </div>
    </div>
  )
})
