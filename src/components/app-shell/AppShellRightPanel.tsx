import type { BrowserPageState, BrowserService } from "../../../electron/browser/common.ts"
import type { ArtifactSelection } from "@/routes/Chat/GeneratedArtifacts"
import type { TurnOutputSelection } from "@/routes/Chat/TurnOutputs"
import type { ConnectionClientService } from "@oomol/connection"

import * as React from "react"
import { ARTIFACTS_PANEL_MIN_WIDTH_PX, RIGHT_PANEL_RESIZE_SASH_WIDTH_PX } from "./app-shell-model.ts"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"
import { BrowserPanel } from "@/routes/Chat/BrowserPanel"

const ArtifactsPanel = React.lazy(() =>
  import("@/routes/Chat/GeneratedArtifacts").then((module) => ({ default: module.ArtifactsPanel })),
)
const TurnOutputsPanel = React.lazy(() =>
  import("@/routes/Chat/TurnOutputs").then((module) => ({ default: module.TurnOutputsPanel })),
)

export const AppShellRightPanel = React.memo(function AppShellRightPanel({
  artifactSelection,
  artifactsPanelIsMaximized,
  artifactsPanelMaxWidthState,
  artifactsPanelShellRef,
  artifactsPanelVisible,
  browserPanelVisible,
  browserService,
  browserState,
  handleArtifactsPanelResizeKeyDown,
  handleArtifactsPanelResizeStart,
  isArtifactsPanelResizing,
  isArtifactsPanelDragCollapsed,
  onCloseBrowser,
  rightPanelVisible,
  setArtifactsPanelMaximizedState,
  setArtifactsPanelOpen,
  turnOutputSelection,
  visibleRightPanelWidth,
}: {
  artifactSelection: ArtifactSelection | null
  artifactsPanelIsMaximized: boolean
  artifactsPanelMaxWidthState: number | null
  artifactsPanelShellRef: React.RefObject<HTMLDivElement | null>
  artifactsPanelVisible: boolean
  browserPanelVisible: boolean
  browserService: ConnectionClientService<BrowserService>
  browserState: BrowserPageState | null
  handleArtifactsPanelResizeKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  handleArtifactsPanelResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void
  isArtifactsPanelResizing: boolean
  isArtifactsPanelDragCollapsed: boolean
  onCloseBrowser: () => void
  rightPanelVisible: boolean
  setArtifactsPanelMaximizedState: (maximized: boolean) => void
  setArtifactsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  turnOutputSelection: TurnOutputSelection | null
  visibleRightPanelWidth: number
}) {
  const t = useT()

  return (
    <div
      ref={artifactsPanelShellRef}
      className={cn(
        "oo-artifacts-panel-shell flex min-h-0",
        artifactsPanelIsMaximized ? "min-w-0 flex-1 shrink" : "shrink-0",
        artifactsPanelIsMaximized && "oo-artifacts-panel-maximized",
        (isArtifactsPanelResizing || browserPanelVisible) && !isArtifactsPanelDragCollapsed
          ? "transition-none"
          : "transition-[width,opacity,transform] duration-200 ease-out",
        rightPanelVisible ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-3 opacity-0",
      )}
      style={
        {
          "--right-panel-resize-sash-width": `${RIGHT_PANEL_RESIZE_SASH_WIDTH_PX}px`,
          width: rightPanelVisible
            ? artifactsPanelIsMaximized
              ? undefined
              : `${visibleRightPanelWidth + RIGHT_PANEL_RESIZE_SASH_WIDTH_PX}px`
            : "0px",
        } as React.CSSProperties
      }
    >
      {!artifactsPanelIsMaximized ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("aria.resizeRightPanel")}
          aria-valuemin={ARTIFACTS_PANEL_MIN_WIDTH_PX}
          aria-valuemax={artifactsPanelMaxWidthState ?? undefined}
          aria-valuenow={visibleRightPanelWidth}
          title={t("aria.resizeRightPanel")}
          tabIndex={rightPanelVisible ? 0 : -1}
          className="oo-artifacts-panel-resize-handle shrink-0"
          onPointerDown={handleArtifactsPanelResizeStart}
          onKeyDown={handleArtifactsPanelResizeKeyDown}
        />
      ) : null}
      <div className="h-full min-w-0 flex-1 overflow-hidden">
        {browserPanelVisible && browserState ? (
          <BrowserPanel
            browserService={browserService}
            maximized={artifactsPanelIsMaximized}
            sessionId={browserState.sessionId}
            state={browserState}
            windowControlsOnRight
            onClose={onCloseBrowser}
            onToggleMaximized={() => setArtifactsPanelMaximizedState(!artifactsPanelIsMaximized)}
          />
        ) : artifactsPanelVisible ? (
          <React.Suspense fallback={null}>
            {turnOutputSelection ? (
              <TurnOutputsPanel
                maximized={artifactsPanelIsMaximized}
                selection={turnOutputSelection}
                windowControlsOnRight
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
                windowControlsOnRight
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
