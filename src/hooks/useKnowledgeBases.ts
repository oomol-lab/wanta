import type { KnowledgeBaseSummary } from "../../electron/knowledge/common.ts"
import type { UserFacingError } from "../lib/user-facing-error.ts"

import * as React from "react"
import { useKnowledgeService } from "../components/AppContext.ts"
import { reportRendererHandledError } from "../lib/renderer-diagnostics.ts"
import { resolveUserFacingError } from "../lib/user-facing-error.ts"
import { observeKnowledgeBaseList } from "./knowledge-base-list-observer.ts"

export interface UseKnowledgeBases {
  items: KnowledgeBaseSummary[]
  loading: boolean
  busy: "import" | "remove" | "refresh" | null
  error: UserFacingError | null
  importKnowledgeBase: (sourcePath?: string) => Promise<KnowledgeBaseSummary | null>
  refresh: (id: string) => Promise<void>
  remove: (id: string) => Promise<boolean>
  reveal: (id: string) => Promise<void>
}

function knowledgeError(cause: unknown, operation: "list" | "action"): UserFacingError {
  return resolveUserFacingError(cause, {
    area: "generic",
    fallbackDescriptionKey:
      operation === "list" ? "error.knowledgeList.description" : "error.knowledgeAction.description",
    fallbackTitleKey: operation === "list" ? "error.knowledgeList.title" : "error.knowledgeAction.title",
  })
}

export function useKnowledgeBases(enabled = true): UseKnowledgeBases {
  const service = useKnowledgeService()
  const [items, setItems] = React.useState<KnowledgeBaseSummary[]>([])
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState<UseKnowledgeBases["busy"]>(null)
  const [error, setError] = React.useState<UserFacingError | null>(null)

  React.useEffect(() => {
    if (!enabled) {
      setItems([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    return observeKnowledgeBaseList({
      load: () => service.invoke("list"),
      onError: (cause) => {
        console.error("[wanta] list knowledge bases failed", cause)
        reportRendererHandledError("knowledge", "list knowledge bases failed", cause)
        setError(knowledgeError(cause, "list"))
      },
      onItems: (nextItems) => {
        setItems(nextItems)
        setError(null)
      },
      onSettled: () => setLoading(false),
      subscribe: (listener) => service.serverEvents.on("knowledgeBasesChanged", listener),
    })
  }, [enabled, service])

  const importKnowledgeBase = React.useCallback(
    async (sourcePath?: string) => {
      setBusy("import")
      try {
        return await service.invoke("importKnowledgeBase", sourcePath)
      } catch (cause) {
        console.error("[wanta] import knowledge base failed", cause)
        reportRendererHandledError("knowledge", "import knowledge base failed", cause)
        setError(knowledgeError(cause, "action"))
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
        setError(knowledgeError(cause, "action"))
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
        setError(knowledgeError(cause, "action"))
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
        setError(knowledgeError(cause, "action"))
      }
    },
    [service],
  )

  return { items, loading, busy, error, importKnowledgeBase, refresh, remove, reveal }
}
