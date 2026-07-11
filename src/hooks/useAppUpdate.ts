import type { AppUpdateState, UpdateChannel } from "../../electron/update/common.ts"

import * as React from "react"
import { useUpdateService } from "@/components/AppContext"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"

export interface UseAppUpdate {
  /** null = 初始状态尚未加载。 */
  state: AppUpdateState | null
  isDownloadInFlight: boolean
  isInstallTriggered: boolean
  check: () => Promise<AppUpdateState | null>
  checkAndDownload: () => Promise<void>
  download: () => Promise<void>
  install: () => Promise<void>
  setChannel: (channel: UpdateChannel) => Promise<void>
}

interface AppUpdateSnapshot {
  isDownloadInFlight: boolean
  isInstallTriggered: boolean
  state: AppUpdateState | null
}

type AppUpdateListener = () => void

const installFallbackResetMs = 15_000
let installAttemptGeneration = 0
let installFallbackTimer: number | undefined

const appUpdateStore = {
  listeners: new Set<AppUpdateListener>(),
  snapshot: {
    isDownloadInFlight: false,
    isInstallTriggered: false,
    state: null,
  } as AppUpdateSnapshot,
  emit(): void {
    this.listeners.forEach((listener) => listener())
  },
  patch(patch: Partial<AppUpdateSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    this.emit()
  },
  subscribe(listener: AppUpdateListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  },
}

function getSnapshot(): AppUpdateSnapshot {
  return appUpdateStore.snapshot
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function patchUpdateError(error: unknown): AppUpdateState | null {
  const current = appUpdateStore.snapshot.state
  if (!current) {
    return null
  }
  const next: AppUpdateState = {
    ...current,
    status: { status: "error", error: errorMessage(error) },
  }
  appUpdateStore.patch({
    state: next,
  })
  return next
}

export function useAppUpdate(): UseAppUpdate {
  const service = useUpdateService()
  const snapshot = React.useSyncExternalStore(appUpdateStore.subscribe.bind(appUpdateStore), getSnapshot, getSnapshot)

  React.useEffect(() => {
    let cancelled = false
    void service.invoke("getAppUpdateState").then(
      (next) => {
        if (!cancelled) {
          appUpdateStore.patch({ state: next })
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          reportRendererHandledError("update", "initial update state load failed", error)
        }
      },
    )
    const off = service.serverEvents.on("appUpdateStateChanged", (next) => appUpdateStore.patch({ state: next }))
    return () => {
      cancelled = true
      off()
    }
  }, [service])

  const refreshState = React.useCallback(async (): Promise<AppUpdateState> => {
    const state = await service.invoke("getAppUpdateState")
    appUpdateStore.patch({ state })
    return state
  }, [service])

  const check = React.useCallback(async (): Promise<AppUpdateState | null> => {
    try {
      const next = await service.invoke("checkForAppUpdate")
      appUpdateStore.patch({ state: next })
      return next
    } catch (error) {
      console.error("[wanta] checkForAppUpdate failed:", error)
      reportRendererHandledError("update", "update check failed", error)
      return patchUpdateError(error)
    }
  }, [service])

  const download = React.useCallback(async (): Promise<void> => {
    if (appUpdateStore.snapshot.isDownloadInFlight) {
      return
    }
    appUpdateStore.patch({ isDownloadInFlight: true })
    try {
      // 失败状态通常经 appUpdateStateChanged 事件回流（status=error）；这里仍补本地诊断兜底。
      await service.invoke("downloadAppUpdate").catch((error: unknown) => {
        reportRendererHandledError("update", "update download failed", error)
        patchUpdateError(error)
      })
      await refreshState().catch((error: unknown) => {
        reportRendererHandledError("update", "update state refresh after download failed", error)
      })
    } finally {
      appUpdateStore.patch({ isDownloadInFlight: false })
    }
  }, [refreshState, service])

  const checkAndDownload = React.useCallback(async (): Promise<void> => {
    try {
      const next = await service.invoke("checkForAppUpdate")
      appUpdateStore.patch({ state: next })
      if (next.status.status === "available") {
        await download()
      }
    } catch (error) {
      console.error("[wanta] checkForAppUpdate failed:", error)
      reportRendererHandledError("update", "update check-and-download failed", error)
      patchUpdateError(error)
    }
  }, [download, service])

  const install = React.useCallback(async (): Promise<void> => {
    if (appUpdateStore.snapshot.isInstallTriggered) {
      return
    }
    installAttemptGeneration += 1
    const generation = installAttemptGeneration
    if (installFallbackTimer !== undefined) {
      window.clearTimeout(installFallbackTimer)
      installFallbackTimer = undefined
    }
    appUpdateStore.patch({ isInstallTriggered: true })
    await service.invoke("installDownloadedAppUpdate").catch((error: unknown) => {
      appUpdateStore.patch({ isInstallTriggered: false })
      console.error("[wanta] installDownloadedAppUpdate failed:", error)
      reportRendererHandledError("update", "update install failed", error)
      patchUpdateError(error)
    })
    installFallbackTimer = window.setTimeout(() => {
      if (installAttemptGeneration !== generation) {
        return
      }
      installFallbackTimer = undefined
      if (!appUpdateStore.snapshot.isInstallTriggered) {
        return
      }
      appUpdateStore.patch({ isInstallTriggered: false })
      void refreshState().catch((error: unknown) => {
        reportRendererHandledError("update", "update state refresh after install timeout failed", error)
      })
    }, installFallbackResetMs)
  }, [refreshState, service])

  const setChannel = React.useCallback(
    async (channel: UpdateChannel) => {
      try {
        appUpdateStore.patch({ state: await service.invoke("setUpdateChannel", channel) })
      } catch (error) {
        // 主进程持久化失败等：渠道未切换，按钮选中态保持原渠道即是反馈。
        console.error("[wanta] setUpdateChannel failed:", error)
        reportRendererHandledError("update", "update channel change failed", error)
        patchUpdateError(error)
      }
    },
    [service],
  )

  return { ...snapshot, check, checkAndDownload, download, install, setChannel }
}
