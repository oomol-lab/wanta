import type { LocalArtifactPreviewResult } from "../../../electron/chat/common.ts"
import type { IUniverConfig, Plugin, PluginCtor } from "@univerjs/core"
import type { FUniver } from "@univerjs/core/facade"

import { LocaleType, LogLevel, Univer } from "@univerjs/core"
import { FUniver as UniverFacade } from "@univerjs/core/facade"
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core"
import zhCN from "@univerjs/preset-sheets-core/locales/zh-CN"
import * as React from "react"
import { workbookSnapshotFromPreview } from "./artifact-univer-snapshot.ts"
import { useTheme } from "@/components/theme-context"
import { useI18n } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

import "@univerjs/preset-sheets-core/lib/index.css"

// 产品铁律：Univer 表格预览是明确的业务需求，用于保持完整工作簿交互与一致渲染。
// 禁止以“只读”“包体积”或“原生 table 可替代”为由删除、降级或替换；任何调整必须先获得产品方明确同意。
// 性能优化必须保留本组件、快照转换层、Univer 依赖以及现有工作簿渲染能力。

type UniverPresetPluginEntry = PluginCtor<Plugin> | [PluginCtor<Plugin>, ConstructorParameters<PluginCtor<Plugin>>[0]]
type UniverPreset = {
  locales?: IUniverConfig["locales"]
  plugins: UniverPresetPluginEntry[]
}

function createPreviewUniver(
  config: Partial<IUniverConfig>,
  presets: UniverPreset[],
): { univer: Univer; univerAPI: FUniver } {
  const locales: IUniverConfig["locales"] = { ...config.locales }
  const plugins = new Map<string, { options?: unknown; plugin: PluginCtor<Plugin> }>()

  presets.forEach((preset) => {
    if (preset.locales) {
      Object.assign(locales, preset.locales)
    }
    preset.plugins.forEach((entry) => {
      const [plugin, options] = Array.isArray(entry) ? [entry[0], entry[1]] : [entry, undefined]
      plugins.set(plugin.pluginName, { options, plugin })
    })
  })

  const univer = new Univer({ logLevel: LogLevel.WARN, ...config, locales })
  plugins.forEach(({ options, plugin }) => {
    univer.registerPlugin(plugin, options)
  })

  return {
    univer,
    univerAPI: UniverFacade.newAPI(univer),
  }
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

function spreadsheetCorePreset(container: HTMLElement): ReturnType<typeof UniverSheetsCorePreset> {
  return UniverSheetsCorePreset({
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
  })
}

function makeWorkbookReadOnly(workbook: ReturnType<FUniver["createWorkbook"]>): void {
  workbook.setEditable(false)
}

function replaceWorkbook(runtime: PreviewUniverRuntime, snapshot: Parameters<FUniver["createWorkbook"]>[0]): void {
  if (runtime.currentWorkbookId) {
    runtime.univerAPI.disposeUnit(runtime.currentWorkbookId)
    runtime.currentWorkbookId = null
  }

  const workbook = runtime.univerAPI.createWorkbook(snapshot)
  makeWorkbookReadOnly(workbook)
  runtime.currentWorkbookId = workbook.getId()
}

function ArtifactUniverRuntimeHost({
  darkMode,
  locale,
  localeMessages,
  snapshot,
}: {
  darkMode: boolean
  locale: LocaleType
  localeMessages: NonNullable<IUniverConfig["locales"]>[LocaleType]
  snapshot: Parameters<FUniver["createWorkbook"]>[0]
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const runtimeRef = React.useRef<PreviewUniverRuntime | null>(null)

  React.useEffect(() => {
    return () => {
      const runtime = runtimeRef.current
      runtimeRef.current = null
      if (runtime) {
        disposeUniverAfterReactCommit(runtime.univer)
      }
    }
  }, [])

  React.useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    let runtime = runtimeRef.current
    if (!runtime) {
      const created = createPreviewUniver(
        {
          darkMode,
          locale,
          locales: {
            [locale]: localeMessages,
          },
          logLevel: LogLevel.SILENT,
        },
        [spreadsheetCorePreset(container)],
      )
      runtime = {
        currentWorkbookId: null,
        ...created,
      }
      runtimeRef.current = runtime
    }

    replaceWorkbook(runtime, snapshot)

    return () => {
      if (runtimeRef.current !== runtime || !runtime.currentWorkbookId) {
        return
      }
      runtime.univerAPI.disposeUnit(runtime.currentWorkbookId)
      runtime.currentWorkbookId = null
    }
  }, [darkMode, locale, localeMessages, snapshot])

  return <div ref={containerRef} className="absolute inset-0 size-full" aria-readonly="true" />
}

export function ArtifactUniverSpreadsheetPreview({
  className,
  preview,
}: {
  className?: string
  preview: LocalArtifactPreviewResult
}) {
  const { locale, t } = useI18n()
  const { effectiveTheme } = useTheme()
  const univerLocale = locale === "en" ? LocaleType.EN_US : LocaleType.ZH_CN
  const [enUSMessages, setEnUSMessages] = React.useState<
    (typeof import("@univerjs/preset-sheets-core/locales/en-US"))["default"] | null
  >(null)
  const localeMessages = univerLocale === LocaleType.EN_US ? enUSMessages : zhCN
  const runtimeConfigKey = `${univerLocale}:${effectiveTheme}`
  const snapshot = React.useMemo(() => workbookSnapshotFromPreview(preview, univerLocale), [preview, univerLocale])

  React.useEffect(() => {
    if (univerLocale !== LocaleType.EN_US || enUSMessages) {
      return
    }
    let cancelled = false
    void import("@univerjs/preset-sheets-core/locales/en-US").then((module) => {
      if (!cancelled) setEnUSMessages(module.default)
    })
    return () => {
      cancelled = true
    }
  }, [enUSMessages, univerLocale])

  if (!snapshot) {
    return null
  }

  return (
    <div className={cn("flex min-h-full min-w-0 flex-col bg-[var(--oo-artifact-preview-canvas)] p-3", className)}>
      <div className="oo-univer-spreadsheet-preview oo-border-divider relative min-h-[420px] flex-1 overflow-hidden rounded-md border bg-background">
        {localeMessages ? (
          <ArtifactUniverRuntimeHost
            key={runtimeConfigKey}
            darkMode={effectiveTheme === "dark"}
            locale={univerLocale}
            localeMessages={localeMessages}
            snapshot={snapshot}
          />
        ) : null}
        {!localeMessages ? (
          <div className="oo-text-body absolute inset-0 flex items-center justify-center text-muted-foreground">
            {t("artifacts.previewLoading")}
          </div>
        ) : null}
      </div>
      {preview.truncated ? (
        <p className="oo-text-caption mt-2 shrink-0 text-muted-foreground">{t("artifacts.sheetTruncated")}</p>
      ) : null}
    </div>
  )
}
