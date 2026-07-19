import type { TurnOutputRecord, TurnOutputFileRole } from "../../../electron/chat/common.ts"
import type { ChatTurn } from "./chat-turns.ts"

import * as React from "react"
import { useSessionRecordResource } from "./session-record-resource.ts"
import { useChatService } from "@/components/AppContext"

function visibleTurnOutputRecords(records: TurnOutputRecord[]): TurnOutputRecord[] {
  return records.filter(
    (record) =>
      record.summary.changedFileCount > 0 || record.summary.processFileCount > 0 || record.projectChangesTruncated,
  )
}

export function turnOutputRecordSortValue(record: TurnOutputRecord): number {
  return record.completedAt ?? record.createdAt
}

export function turnOutputInitialRole(record: TurnOutputRecord): TurnOutputFileRole {
  return record.summary.changedFileCount > 0 || record.projectChangesTruncated ? "project_change" : "process"
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
  const key = sessionId && messageIdsKey ? `${sessionId}\0${messageIdsKey}` : null
  const subscribe = React.useCallback(
    (refresh: () => void) =>
      chatService.serverEvents.on("turnOutputUpdated", (event) => {
        if (event.sessionId === sessionId) {
          refresh()
        }
      }),
    [chatService, sessionId],
  )
  const load = React.useCallback(async (): Promise<TurnOutputRecord[]> => {
    if (!sessionId || !messageIdsKey) {
      return []
    }
    const records = await chatService.invoke("getTurnOutputs", {
      sessionId,
      messageIds: messageIdsKey.split("\n"),
    })
    return visibleTurnOutputRecords(records).sort(
      (left, right) => turnOutputRecordSortValue(left) - turnOutputRecordSortValue(right),
    )
  }, [chatService, messageIdsKey, sessionId])
  const onError = React.useCallback((error: unknown): void => {
    console.error("[wanta] getTurnOutputs failed", error)
  }, [])
  return useSessionRecordResource({ key, load, onError, subscribe })
}
