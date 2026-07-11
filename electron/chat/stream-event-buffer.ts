import type { MessageDeltaEvent, MessageReasoningDeltaEvent } from "./common.ts"

export type BufferedStreamEvent =
  | { event: "messageDelta"; data: MessageDeltaEvent }
  | { event: "messageReasoningDelta"; data: MessageReasoningDeltaEvent }

type StreamEventData = MessageDeltaEvent | MessageReasoningDeltaEvent

const defaultFlushDelayMs = 32

function streamEventKey(event: BufferedStreamEvent): string {
  return `${event.event}\0${event.data.sessionId}\0${event.data.messageId}\0${event.data.partId}`
}

/** 合并同一文本 part 的累计快照；仅有 delta 的 provider 则保留全部增量。 */
export function coalesceBufferedStreamEvent(
  current: BufferedStreamEvent | undefined,
  next: BufferedStreamEvent,
): BufferedStreamEvent {
  if (!current || current.event !== next.event) {
    return next
  }
  if (next.data.text) {
    return next
  }
  if (!next.data.delta) {
    return current
  }
  const data: StreamEventData = current.data.text
    ? { ...next.data, text: current.data.text + next.data.delta, delta: undefined }
    : { ...next.data, delta: `${current.data.delta ?? ""}${next.data.delta}` }
  return { event: next.event, data } as BufferedStreamEvent
}

/** 主进程侧有界合并 OpenCode 文本事件，避免每个 token 都触发一次 Electron structured clone。 */
export class ChatStreamEventBuffer {
  private readonly delayMs: number
  private readonly emit: (event: BufferedStreamEvent) => void
  private readonly pending = new Map<string, BufferedStreamEvent>()
  private timer: NodeJS.Timeout | undefined

  public constructor(emit: (event: BufferedStreamEvent) => void, options: { delayMs?: number } = {}) {
    this.emit = emit
    this.delayMs = options.delayMs ?? defaultFlushDelayMs
  }

  public enqueue(event: BufferedStreamEvent): void {
    const key = streamEventKey(event)
    this.pending.set(key, coalesceBufferedStreamEvent(this.pending.get(key), event))
    if (this.timer) {
      return
    }
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.flush()
    }, this.delayMs)
    this.timer.unref?.()
  }

  public flush(sessionId?: string): void {
    if (sessionId === undefined && this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (this.pending.size === 0) {
      return
    }
    const events: BufferedStreamEvent[] = []
    for (const [key, event] of this.pending) {
      if (sessionId === undefined || event.data.sessionId === sessionId) {
        events.push(event)
        this.pending.delete(key)
      }
    }
    if (sessionId && this.pending.size === 0 && this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    for (const event of events) {
      this.emit(event)
    }
  }

  public clear(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.pending.clear()
  }
}
