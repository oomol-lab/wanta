import type { AppUpdateState, UpdateChannel } from "../../electron/update/common.ts"

import * as React from "react"
import { useUpdateService } from "@/components/AppContext"

export interface UseAppUpdate {
  /** null = 初始状态尚未加载。 */
  state: AppUpdateState | null
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => Promise<void>
  setChannel: (channel: UpdateChannel) => Promise<void>
}

export function useAppUpdate(): UseAppUpdate {
  const service = useUpdateService()
  const [state, setState] = React.useState<AppUpdateState | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void service.invoke("getAppUpdateState").then(
      (next) => {
        if (!cancelled) {
          setState(next)
        }
      },
      () => undefined,
    )
    const off = service.serverEvents.on("appUpdateStateChanged", (next) => setState(next))
    return () => {
      cancelled = true
      off()
    }
  }, [service])

  const check = React.useCallback(async () => {
    try {
      setState(await service.invoke("checkForAppUpdate"))
    } catch (error) {
      console.error("checkForAppUpdate failed:", error)
    }
  }, [service])

  const download = React.useCallback(async () => {
    // 失败状态经 appUpdateStateChanged 事件回流（status=error），此处吞掉 rejection 防未捕获。
    await service.invoke("downloadAppUpdate").catch(() => undefined)
  }, [service])

  const install = React.useCallback(async () => {
    await service.invoke("installDownloadedAppUpdate").catch((error: unknown) => {
      console.error("installDownloadedAppUpdate failed:", error)
    })
  }, [service])

  const setChannel = React.useCallback(
    async (channel: UpdateChannel) => {
      try {
        setState(await service.invoke("setUpdateChannel", channel))
      } catch (error) {
        // 主进程持久化失败等：渠道未切换，按钮选中态保持原渠道即是反馈。
        console.error("setUpdateChannel failed:", error)
      }
    },
    [service],
  )

  return { state, check, download, install, setChannel }
}
