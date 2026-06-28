import type { LocalArtifactPreviewResult } from "../../../electron/chat/common.ts"
import type { IUniverConfig, Plugin, PluginCtor } from "@univerjs/core"
import type { FUniver } from "@univerjs/core/facade"

import { LocaleType, LogLevel, Univer } from "@univerjs/core"
import { FUniver as UniverFacade } from "@univerjs/core/facade"
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core"
import zhCN from "@univerjs/preset-sheets-core/locales/zh-CN"
import "@univerjs/preset-sheets-core/lib/index.css"

import * as React from "react"
import { workbookSnapshotFromPreview } from "./artifact-univer-snapshot.ts"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

// 只注册 sheets core preset 暴露的插件，避免引入完整 presets 包和额外预览能力。
function createPreviewUniver(
  config: Partial<IUniverConfig>,
  presets: Array<ReturnType<typeof UniverSheetsCorePreset>>,
): { univer: Univer; univerAPI: FUniver } {
  const univer = new Univer({ logLevel: LogLevel.WARN, ...config })
  const plugins = new Map<string, { options?: unknown; plugin: PluginCtor<Plugin> }>()

  presets.forEach((preset) => {
    preset.plugins.forEach((entry) => {
      const [plugin, options] = Array.isArray(entry) ? [entry[0], entry[1]] : [entry, undefined]
      plugins.set(plugin.pluginName, { options, plugin })
    })
  })
  plugins.forEach(({ options, plugin }) => {
    univer.registerPlugin(plugin, options)
  })

  return {
    univer,
    univerAPI: UniverFacade.newAPI(univer),
  }
}

function prefersDarkMode(): boolean {
  if (document.documentElement.classList.contains("dark")) {
    return true
  }
  if (document.documentElement.classList.contains("light")) {
    return false
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

function disposeUniverAfterReactCommit(univer: Univer): void {
  // Univer 内部也会卸载 React root，延后一帧避免和外层 React cleanup 抢同一轮提交。
  const dispose = (): void => {
    window.setTimeout(() => {
      univer.dispose()
    }, 0)
  }

  if (document.visibilityState === "hidden") {
    window.setTimeout(dispose, 0)
    return
  }

  window.requestAnimationFrame(dispose)
}

type PreviewUniverRuntime = {
  currentWorkbookId: string | null
  univer: Univer
  univerAPI: FUniver
}

export function ArtifactUniverSpreadsheetPreview({
  className,
  preview,
}: {
  className?: string
  preview: LocalArtifactPreviewResult
}) {
  const t = useT()
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const runtimeRef = React.useRef<PreviewUniverRuntime | null>(null)
  const snapshot = React.useMemo(() => workbookSnapshotFromPreview(preview), [preview])

  React.useEffect(() => {
    return () => {
      const runtime = runtimeRef.current
      runtimeRef.current = null
      if (runtime) {
        disposeUniverAfterReactCommit(runtime.univer)
      }
    }
  }, [])

  React.useEffect(() => {
    const container = containerRef.current
    if (!container || !snapshot) {
      return
    }

    let runtime = runtimeRef.current
    if (!runtime) {
      const created = createPreviewUniver(
        {
          darkMode: prefersDarkMode(),
          locale: LocaleType.ZH_CN,
          locales: {
            [LocaleType.ZH_CN]: zhCN,
          },
          logLevel: LogLevel.SILENT,
        },
        [
          UniverSheetsCorePreset({
            container,
            contextMenu: false,
            disableAutoFocus: true,
            footer: {
              menus: false,
              sheetBar: true,
              statisticBar: false,
              zoomSlider: false,
            },
            formulaBar: false,
            header: false,
            sheets: {
              disableForceStringAlert: true,
              disableForceStringMark: true,
            },
            toolbar: false,
          }),
        ],
      )
      runtime = {
        currentWorkbookId: null,
        ...created,
      }
      runtimeRef.current = runtime
    }

    if (runtime.currentWorkbookId) {
      runtime.univerAPI.disposeUnit(runtime.currentWorkbookId)
      runtime.currentWorkbookId = null
    }

    const workbook = runtime.univerAPI.createWorkbook(snapshot)
    runtime.currentWorkbookId = workbook.getId()

    return () => {
      if (runtimeRef.current !== runtime || !runtime.currentWorkbookId) {
        return
      }
      runtime.univerAPI.disposeUnit(runtime.currentWorkbookId)
      runtime.currentWorkbookId = null
    }
  }, [snapshot])

  if (!snapshot) {
    return null
  }

  return (
    <div className={cn("flex min-h-full min-w-0 flex-col bg-[var(--oo-artifact-preview-canvas)] p-3", className)}>
      <div className="oo-univer-spreadsheet-preview oo-border-divider relative min-h-[420px] flex-1 overflow-hidden rounded-md border bg-background">
        <div ref={containerRef} className="absolute inset-0 size-full" />
      </div>
      {preview.truncated ? (
        <p className="oo-text-caption mt-2 shrink-0 text-muted-foreground">{t("artifacts.sheetTruncated")}</p>
      ) : null}
    </div>
  )
}
