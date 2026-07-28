export interface KnowledgeBaseListObserverOptions<T> {
  load: () => Promise<T>
  onError: (cause: unknown) => void
  onItems: (items: T) => void
  onSettled: () => void
  subscribe: (listener: () => void) => () => void
}

/** 合并列表事件与初始读取，只允许当前 generation 更新界面。 */
export function observeKnowledgeBaseList<T>(options: KnowledgeBaseListObserverOptions<T>): () => void {
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
