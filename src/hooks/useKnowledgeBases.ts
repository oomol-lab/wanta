import type { KnowledgeBaseSummary } from "../../electron/knowledge/common.ts"

import * as React from "react"
import { useKnowledgeService } from "../components/AppContext.ts"
import { reportRendererHandledError } from "../lib/renderer-diagnostics.ts"

export interface UseKnowledgeBases {
  items: KnowledgeBaseSummary[]
  loading: boolean
  busy: "import" | "remove" | "refresh" | null
  error: string | null
  importKnowledgeBase: (sourcePath?: string) => Promise<KnowledgeBaseSummary | null>
  refresh: (id: string) => Promise<void>
  remove: (id: string) => Promise<boolean>
  reveal: (id: string) => Promise<void>
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export function useKnowledgeBases(enabled = true): UseKnowledgeBases {
  const service = useKnowledgeService()
  const [items, setItems] = React.useState<KnowledgeBaseSummary[]>([])
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState<UseKnowledgeBases["busy"]>(null)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    try {
      setItems(await service.invoke("list"))
      setError(null)
    } catch (cause) {
      console.error("[wanta] list knowledge bases failed", cause)
      reportRendererHandledError("knowledge", "list knowledge bases failed", cause)
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [service])

  React.useEffect(() => {
    if (!enabled) {
      setItems([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    void load()
    return service.serverEvents.on("knowledgeBasesChanged", () => void load())
  }, [enabled, load, service])

  const importKnowledgeBase = React.useCallback(
    async (sourcePath?: string) => {
      setBusy("import")
      try {
        return await service.invoke("importKnowledgeBase", sourcePath)
      } catch (cause) {
        console.error("[wanta] import knowledge base failed", cause)
        reportRendererHandledError("knowledge", "import knowledge base failed", cause)
        setError(errorMessage(cause))
        return null
      } finally {
        setBusy(null)
      }
    },
    [service],
  )

  const refresh = React.useCallback(
    async (id: string) => {
      setBusy("refresh")
      try {
        await service.invoke("refresh", id)
      } catch (cause) {
        console.error("[wanta] refresh knowledge base failed", cause)
        reportRendererHandledError("knowledge", "refresh knowledge base failed", cause)
        setError(errorMessage(cause))
      } finally {
        setBusy(null)
      }
    },
    [service],
  )

  const remove = React.useCallback(
    async (id: string) => {
      setBusy("remove")
      try {
        await service.invoke("remove", id)
        return true
      } catch (cause) {
        console.error("[wanta] remove knowledge base failed", cause)
        reportRendererHandledError("knowledge", "remove knowledge base failed", cause)
        setError(errorMessage(cause))
        return false
      } finally {
        setBusy(null)
      }
    },
    [service],
  )

  const reveal = React.useCallback(
    async (id: string) => {
      try {
        await service.invoke("reveal", id)
      } catch (cause) {
        console.error("[wanta] reveal knowledge base failed", cause)
        reportRendererHandledError("knowledge", "reveal knowledge base failed", cause)
        setError(errorMessage(cause))
      }
    },
    [service],
  )

  return { items, loading, busy, error, importKnowledgeBase, refresh, remove, reveal }
}
