import type { TurnOutputRecord, TurnOutputFileRole } from "../../../electron/chat/common.ts"
import type { ChatTurn } from "./chat-turns.ts"

import * as React from "react"
import { useChatService } from "@/components/AppContext"

function visibleTurnOutputRecords(records: TurnOutputRecord[]): TurnOutputRecord[] {
  return records.filter((record) => record.summary.changedFileCount > 0 || record.summary.processFileCount > 0)
}

export function turnOutputRecordSortValue(record: TurnOutputRecord): number {
  return record.completedAt ?? record.createdAt
}

export function turnOutputInitialRole(record: TurnOutputRecord): TurnOutputFileRole {
  return record.summary.changedFileCount > 0 ? "project_change" : "process"
}

export function turnOutputRecordsByMessageId(records: TurnOutputRecord[]): Map<string, TurnOutputRecord> {
  const byMessageId = new Map<string, TurnOutputRecord>()
  for (const record of records) {
    byMessageId.set(record.messageId, record)
  }
  return byMessageId
}

export function turnOutputRecordsByTurnId(
  turns: ChatTurn[],
  recordsByMessageId: Map<string, TurnOutputRecord>,
): Map<string, TurnOutputRecord> {
  const byTurnId = new Map<string, TurnOutputRecord>()
  for (const turn of turns) {
    const records = turn.assistants
      .map((message) => recordsByMessageId.get(message.id))
      .filter((record): record is TurnOutputRecord => Boolean(record))
      .sort((left, right) => turnOutputRecordSortValue(left) - turnOutputRecordSortValue(right))
    const latest = records.at(-1)
    if (latest) {
      byTurnId.set(turn.id, latest)
    }
  }
  return byTurnId
}

export function useTurnOutputRecords(sessionId: string | null, messageIdsKey: string): TurnOutputRecord[] {
  const chatService = useChatService()
  const [records, setRecords] = React.useState<TurnOutputRecord[]>([])
  const [refreshToken, setRefreshToken] = React.useState(0)

  React.useEffect(() => {
    return chatService.serverEvents.on("turnOutputUpdated", (event) => {
      if (!sessionId || event.sessionId === sessionId) {
        setRefreshToken((value) => value + 1)
      }
    })
  }, [chatService, sessionId])

  React.useEffect(() => {
    let cancelled = false
    if (!sessionId || !messageIdsKey) {
      setRecords([])
      return
    }
    const messageIds = messageIdsKey.split("\n")
    void chatService
      .invoke("getTurnOutputs", { sessionId, messageIds })
      .then((nextRecords) => {
        if (cancelled) {
          return
        }
        setRecords(
          visibleTurnOutputRecords(nextRecords).sort(
            (left, right) => turnOutputRecordSortValue(left) - turnOutputRecordSortValue(right),
          ),
        )
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error("[wanta] getTurnOutputs failed", error)
          setRecords([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [chatService, messageIdsKey, refreshToken, sessionId])

  return records
}
