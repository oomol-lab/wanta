import * as React from "react"

interface SessionRecordState<T> {
  key: string | null
  records: T[]
}

interface SessionRecordResourceOptions<T> {
  key: string | null
  load: () => Promise<T[]>
  onError: (error: unknown) => void
  subscribe: (refresh: () => void) => () => void
}

/** 会话记录刷新失败时保留同一资源的最后一次成功结果，切换资源时则立即隔离旧数据。 */
export function useSessionRecordResource<T>({ key, load, onError, subscribe }: SessionRecordResourceOptions<T>): T[] {
  const [state, setState] = React.useState<SessionRecordState<T>>({ key: null, records: [] })
  const [refreshRevision, setRefreshRevision] = React.useState(0)

  React.useEffect(() => {
    if (!key) {
      return
    }
    return subscribe(() => setRefreshRevision((revision) => revision + 1))
  }, [key, subscribe])

  React.useEffect(() => {
    let cancelled = false
    if (!key) {
      setState((current) => (current.key === null ? current : { key: null, records: [] }))
      return
    }
    void load()
      .then((records) => {
        if (!cancelled) {
          setState({ key, records })
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }
        onError(error)
        setState((current) => (current.key === key ? current : { key, records: [] }))
      })
    return () => {
      cancelled = true
    }
  }, [key, load, onError, refreshRevision])

  return state.key === key ? state.records : []
}
