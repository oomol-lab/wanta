import type { AppUpdateState, UpdateChannel } from "../../electron/update/common.ts"

import * as React from "react"
import { useUpdateService } from "@/components/AppContext"

export interface UseAppUpdate {
  /** null = 初始状态尚未加载。 */
  state: AppUpdateState | null
  isDownloadInFlight: boolean
  isInstallTriggered: boolean
  check: () => Promise<void>
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
      () => undefined,
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

  const check = React.useCallback(async (): Promise<void> => {
    try {
      appUpdateStore.patch({ state: await service.invoke("checkForAppUpdate") })
    } catch (error) {
      console.error("checkForAppUpdate failed:", error)
    }
  }, [service])

  const download = React.useCallback(async (): Promise<void> => {
    if (appUpdateStore.snapshot.isDownloadInFlight) {
      return
    }
    appUpdateStore.patch({ isDownloadInFlight: true })
    try {
      // 失败状态经 appUpdateStateChanged 事件回流（status=error），此处吞掉 rejection 防未捕获。
      await service.invoke("downloadAppUpdate").catch(() => undefined)
      await refreshState().catch(() => undefined)
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
      console.error("checkForAppUpdate failed:", error)
    }
  }, [download, service])

  const install = React.useCallback(async (): Promise<void> => {
    if (appUpdateStore.snapshot.isInstallTriggered) {
      return
    }
    appUpdateStore.patch({ isInstallTriggered: true })
    await service.invoke("installDownloadedAppUpdate").catch((error: unknown) => {
      appUpdateStore.patch({ isInstallTriggered: false })
      console.error("installDownloadedAppUpdate failed:", error)
    })
  }, [service])

  const setChannel = React.useCallback(
    async (channel: UpdateChannel) => {
      try {
        appUpdateStore.patch({ state: await service.invoke("setUpdateChannel", channel) })
      } catch (error) {
        // 主进程持久化失败等：渠道未切换，按钮选中态保持原渠道即是反馈。
        console.error("setUpdateChannel failed:", error)
      }
    },
    [service],
  )

  return { ...snapshot, check, checkAndDownload, download, install, setChannel }
}
