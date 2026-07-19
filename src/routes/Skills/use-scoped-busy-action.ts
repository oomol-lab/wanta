import type { BusyAction } from "./team-management-model.ts"

import * as React from "react"

export interface ScopedBusyOperation {
  action: BusyAction
  contextKey: string
  id: number
}

export function scopedBusyOperationIsCurrent(
  operation: ScopedBusyOperation,
  currentId: number,
  currentContextKey: string,
): boolean {
  return currentId === operation.id && currentContextKey === operation.contextKey
}

/** 用上下文和递增序号隔离异步操作，避免旧团队的 finally 清掉新团队的忙碌状态。 */
export function useScopedBusyAction({
  busyAction,
  contextKey,
  setBusyAction,
}: {
  busyAction: BusyAction | null
  contextKey: string
  setBusyAction: React.Dispatch<React.SetStateAction<BusyAction | null>>
}) {
  const sequenceRef = React.useRef(0)
  const contextKeyRef = React.useRef(contextKey)
  const busyActionRef = React.useRef<BusyAction | null>(busyAction)

  React.useLayoutEffect(() => {
    if (contextKeyRef.current !== contextKey) {
      contextKeyRef.current = contextKey
      sequenceRef.current += 1
      busyActionRef.current = null
    }
  }, [contextKey])

  React.useEffect(() => {
    busyActionRef.current = busyAction
  }, [busyAction])

  const begin = React.useCallback(
    (action: BusyAction): ScopedBusyOperation | null => {
      if (busyActionRef.current) {
        return null
      }
      const operation = { action, contextKey: contextKeyRef.current, id: sequenceRef.current + 1 }
      sequenceRef.current = operation.id
      busyActionRef.current = action
      setBusyAction(action)
      return operation
    },
    [setBusyAction],
  )

  const isCurrent = React.useCallback(
    (operation: ScopedBusyOperation): boolean =>
      scopedBusyOperationIsCurrent(operation, sequenceRef.current, contextKeyRef.current),
    [],
  )

  const finish = React.useCallback(
    (operation: ScopedBusyOperation): void => {
      if (!isCurrent(operation)) {
        return
      }
      busyActionRef.current = null
      setBusyAction((current) => (current === operation.action ? null : current))
    },
    [isCurrent, setBusyAction],
  )

  return React.useMemo(() => ({ begin, finish, isCurrent }), [begin, finish, isCurrent])
}
