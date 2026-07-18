import type { KnowledgeBaseSummary } from "../../electron/knowledge/common.ts"

export interface KnowledgeBaseListObserverOptions {
  load: () => Promise<KnowledgeBaseSummary[]>
  onError: (cause: unknown) => void
  onItems: (items: KnowledgeBaseSummary[]) => void
  onSettled: () => void
  subscribe: (listener: () => void) => () => void
}

/** 合并列表事件与初始读取，只允许当前 generation 更新界面。 */
export function observeKnowledgeBaseList(options: KnowledgeBaseListObserverOptions): () => void {
  let active = true
  let requestVersion = 0

  const loadLatest = (): void => {
    const currentRequest = requestVersion + 1
    requestVersion = currentRequest
    void options.load().then(
      (items) => {
        if (active && requestVersion === currentRequest) {
          options.onItems(items)
          options.onSettled()
        }
      },
      (cause: unknown) => {
        if (active && requestVersion === currentRequest) {
          options.onError(cause)
          options.onSettled()
        }
      },
    )
  }

  const unsubscribe = options.subscribe(loadLatest)
  loadLatest()

  return () => {
    active = false
    requestVersion += 1
    unsubscribe()
  }
}
