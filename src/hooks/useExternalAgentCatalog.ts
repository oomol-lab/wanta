import type { AgentKind } from "../../electron/agent/contract/profile.ts"
import type { ExternalAgentCatalog } from "../../electron/agent/external/status.ts"

import * as React from "react"
import { isExternalAgentKind } from "../../electron/agent/contract/profile.ts"
import { useChatService } from "@/components/AppContext"

/** Keep the selected model's catalog local to this composer and discard stale replies. */
export function useExternalAgentCatalog(kind: AgentKind, modelId?: string, onRefreshed?: () => Promise<void>) {
  const service = useChatService()
  const key = JSON.stringify([kind, modelId ?? null])
  const sequence = React.useRef(0)
  const [result, setResult] = React.useState<{
    key: string
    catalog?: ExternalAgentCatalog
    error: boolean
    loading: boolean
  } | null>(null)
  const refresh = React.useCallback(async () => {
    const request = ++sequence.current
    if (!isExternalAgentKind(kind)) return
    setResult((previous) => ({
      key,
      catalog: previous?.key === key ? previous.catalog : undefined,
      error: false,
      loading: true,
    }))
    try {
      const catalog = await service.invoke("previewExternalAgentCatalog", { kind, ...(modelId ? { modelId } : {}) })
      if (request === sequence.current) {
        setResult({ key, catalog, error: false, loading: false })
        try {
          await onRefreshed?.()
        } catch {
          // A secondary status refresh cannot invalidate successful discovery.
        }
      }
    } catch {
      if (request === sequence.current) setResult({ key, error: true, loading: false })
    }
  }, [key, kind, modelId, service, onRefreshed])
  React.useEffect(() => {
    void refresh()
    return () => {
      sequence.current += 1
    }
  }, [refresh])
  const current = result?.key === key ? result : null
  return {
    catalog: current?.catalog,
    loading: isExternalAgentKind(kind) && (current?.loading ?? true),
    error: current?.error ?? false,
    refresh,
  }
}
