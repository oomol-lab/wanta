import type { KnowledgeBaseSummary, KnowledgeChapterNode } from "../../electron/knowledge/common.ts"
import type { UserFacingError } from "../lib/user-facing-error.ts"

import * as React from "react"
import { useKnowledgeService } from "../components/AppContext.ts"
import { reportRendererHandledError } from "../lib/renderer-diagnostics.ts"
import { resolveUserFacingError } from "../lib/user-facing-error.ts"
import { observeKnowledgeBaseList } from "./knowledge-base-list-observer.ts"

export interface UseKnowledgeBases {
  items: KnowledgeBaseSummary[]
  folders: string[]
  loading: boolean
  busy: "create-folder" | "import" | "move" | "remove" | "remove-folder" | "rename" | "refresh" | null
  error: UserFacingError | null
  createFolder: (path: string) => Promise<string | null>
  importKnowledgeBase: (sourcePath?: string, targetDirectory?: string) => Promise<KnowledgeBaseSummary | null>
  loadChapters: (id: string) => Promise<void>
  move: (id: string, targetDirectory: string) => Promise<KnowledgeBaseSummary | null>
  removeFolder: (path: string) => Promise<boolean>
  rename: (
    id: string,
    request: { authors?: string[]; fileName?: string; title?: string },
  ) => Promise<KnowledgeBaseSummary | null>
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
  const [chaptersById, setChaptersById] = React.useState<Map<string, KnowledgeChapterNode[]>>(() => new Map())
  const chaptersByIdRef = React.useRef(chaptersById)
  const loadingChaptersRef = React.useRef(new Set<string>())
  const [folders, setFolders] = React.useState<string[]>([])
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState<UseKnowledgeBases["busy"]>(null)
  const [error, setError] = React.useState<UserFacingError | null>(null)

  React.useEffect(() => {
    if (!enabled) {
      setItems([])
      setFolders([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    return observeKnowledgeBaseList({
      load: async () => {
        const [nextItems, nextFolders] = await Promise.all([service.invoke("list"), service.invoke("listFolders")])
        return { folders: nextFolders, items: nextItems }
      },
      onError: (cause) => {
        console.error("[wanta] list knowledge bases failed", cause)
        reportRendererHandledError("knowledge", "list knowledge bases failed", cause)
        setError(knowledgeError(cause, "list"))
      },
      onItems: ({ folders: nextFolders, items: nextItems }) => {
        setFolders(nextFolders)
        setItems(nextItems)
        setError(null)
      },
      onSettled: () => setLoading(false),
      subscribe: (listener) => service.serverEvents.on("knowledgeBasesChanged", listener),
    })
  }, [enabled, service])

  React.useEffect(() => {
    chaptersByIdRef.current = chaptersById
  }, [chaptersById])

  React.useEffect(() => {
    const ids = new Set(items.map((item) => item.id))
    setChaptersById((current) => {
      if (Array.from(current.keys()).every((id) => ids.has(id))) return current
      const next = new Map<string, KnowledgeChapterNode[]>()
      for (const [id, chapters] of current) {
        if (ids.has(id)) next.set(id, chapters)
      }
      return next
    })
  }, [items])

  const itemsWithChapters = React.useMemo(
    () =>
      items.map((item) => {
        const chapters = chaptersById.get(item.id)
        return chapters ? { ...item, chapters } : item
      }),
    [chaptersById, items],
  )

  const importKnowledgeBase = React.useCallback(
    async (sourcePath?: string, targetDirectory?: string) => {
      setBusy("import")
      try {
        return await service.invoke("importKnowledgeBase", { sourcePath, targetDirectory })
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

  const createFolder = React.useCallback(
    async (path: string) => {
      setBusy("create-folder")
      try {
        const created = await service.invoke("createFolder", { path })
        setFolders((current) => (current.includes(created) ? current : [...current, created].sort()))
        return created
      } catch (cause) {
        console.error("[wanta] create knowledge folder failed", cause)
        reportRendererHandledError("knowledge", "create knowledge folder failed", cause)
        setError(knowledgeError(cause, "action"))
        return null
      } finally {
        setBusy(null)
      }
    },
    [service],
  )

  const loadChapters = React.useCallback(
    async (id: string) => {
      if (chaptersByIdRef.current.has(id) || loadingChaptersRef.current.has(id)) return
      loadingChaptersRef.current.add(id)
      try {
        const chapters = await service.invoke("readChapters", id)
        setChaptersById((current) => {
          const next = new Map(current)
          next.set(id, chapters)
          chaptersByIdRef.current = next
          return next
        })
      } catch (cause) {
        console.error("[wanta] read knowledge chapters failed", cause)
        reportRendererHandledError("knowledge", "read knowledge chapters failed", cause)
        setError(knowledgeError(cause, "action"))
      } finally {
        loadingChaptersRef.current.delete(id)
      }
    },
    [service],
  )

  const rename = React.useCallback(
    async (id: string, request: { authors?: string[]; fileName?: string; title?: string }) => {
      setBusy("rename")
      try {
        return await service.invoke("rename", { id, ...request })
      } catch (cause) {
        console.error("[wanta] rename knowledge base failed", cause)
        reportRendererHandledError("knowledge", "rename knowledge base failed", cause)
        setError(knowledgeError(cause, "action"))
        return null
      } finally {
        setBusy(null)
      }
    },
    [service],
  )

  const move = React.useCallback(
    async (id: string, targetDirectory: string) => {
      setBusy("move")
      try {
        return await service.invoke("move", { id, targetDirectory })
      } catch (cause) {
        console.error("[wanta] move knowledge base failed", cause)
        reportRendererHandledError("knowledge", "move knowledge base failed", cause)
        setError(knowledgeError(cause, "action"))
        return null
      } finally {
        setBusy(null)
      }
    },
    [service],
  )

  const removeFolder = React.useCallback(
    async (path: string) => {
      setBusy("remove-folder")
      try {
        await service.invoke("removeFolder", { path })
        setFolders((current) => current.filter((item) => item !== path && !item.startsWith(`${path}/`)))
        return true
      } catch (cause) {
        console.error("[wanta] remove knowledge folder failed", cause)
        reportRendererHandledError("knowledge", "remove knowledge folder failed", cause)
        setError(knowledgeError(cause, "action"))
        return false
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

  return {
    items: itemsWithChapters,
    folders,
    loading,
    busy,
    error,
    createFolder,
    importKnowledgeBase,
    loadChapters,
    move,
    refresh,
    remove,
    removeFolder,
    rename,
    reveal,
  }
}
