// @vitest-environment happy-dom
import type { ChatActiveRun } from "../../electron/chat/common.ts"
import type { UseChat } from "./useChat.ts"

import * as React from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { useChat } from "./useChat.ts"

const transport = vi.hoisted(() => {
  const listeners = new Map<string, Set<(data: unknown) => void>>()
  return {
    listeners,
    invoke: vi.fn<(method: string, argument?: unknown) => Promise<unknown>>(),
    serverEvents: {
      on: (event: string, listener: (data: unknown) => void) => {
        const group = listeners.get(event) ?? new Set()
        group.add(listener)
        listeners.set(event, group)
        return () => {
          group.delete(listener)
        }
      },
    },
  }
})
vi.mock("@/components/AppContext", () => ({ useChatService: () => transport }))
vi.mock("@/i18n/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/i18n/i18n")>()),
  useI18n: () => ({ locale: "en" }),
}))
vi.mock("@/lib/renderer-diagnostics", () => ({ reportRendererHandledError: vi.fn() }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const scope = { kind: "local" as const, workspaceId: "local", workspaceName: "Local" }
const sessionId = "session-1"
const roots: ReturnType<typeof createRoot>[] = []

function run(runId: string): ChatActiveRun {
  return {
    sessionId,
    runId,
    generationId: runId,
    phase: "thinking",
    startedAt: runId === "old" ? 1 : 2,
    updatedAt: 2,
    workspace: scope,
    activeToolPartIds: [],
    blockingRequestIds: [],
  }
}
function emit(event: string, data: unknown): void {
  for (const listener of transport.listeners.get(event) ?? []) listener(data)
}
function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
async function mount() {
  let current!: UseChat
  function Probe() {
    current = useChat(sessionId)
    return null
  }
  const root = createRoot(document.createElement("div"))
  roots.push(root)
  await React.act(async () => {
    root.render(React.createElement(Probe))
  })
  return {
    get state() {
      return current
    },
  }
}
function startNewRun() {
  emit("activeRunUpdated", { sessionId, run: run("new") })
  emit("permissionAsked", {
    sessionId,
    request: { id: "new-permission", sessionId, action: "read", resources: ["/tmp/new"] },
  })
}
beforeEach(() => {
  transport.listeners.clear()
  transport.invoke.mockReset().mockImplementation(async (method, argument) => {
    if (method === "getSessionSnapshot")
      return { sessionId: argument, activeRun: null, messages: [], pendingQuestions: [], pendingPermissions: [] }
    if (method === "getActiveRuns" || method === "getMessages") return []
    return undefined
  })
})
afterEach(async () => {
  await React.act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
})

test.each(["resolve", "reject"] as const)(
  "a late stop RPC %s cannot overwrite the replacement run",
  async (settlement) => {
    const h = await mount()
    React.act(() => emit("activeRunUpdated", { sessionId, run: run("old") }))
    const pending = deferred()
    transport.invoke.mockImplementationOnce(() => pending.promise)
    let stop!: Promise<void>
    React.act(() => {
      stop = h.state.stop(sessionId).catch(() => undefined)
    })
    React.act(() => {
      emit("activeRunUpdated", { sessionId, run: null, endedRunId: "old" })
      startNewRun()
    })
    await React.act(async () => {
      if (settlement === "resolve") pending.resolve()
      else pending.reject(new Error("old cancellation failed"))
      await stop
    })
    expect(h.state.status).toBe("streaming")
    expect(h.state.error).toBeNull()
    expect(h.state.getSessionRunStartedAt(sessionId)).toBe(2)
    expect(h.state.pendingPermissions.map((request) => request.id)).toEqual(["new-permission"])
  },
)

test("old terminal events cannot clear a newer run or its pending permissions", async () => {
  const h = await mount()
  React.act(() => startNewRun())
  React.act(() => {
    emit("activeRunUpdated", { sessionId, run: null, endedRunId: "old" })
    emit("turnOutcome", { sessionId, runId: "old", kind: "cancelled" })
    emit("generationStopped", { sessionId, runId: "old" })
    emit("generationInterrupted", {
      sessionId,
      runId: "old",
      interruptedAt: 1,
      reason: "runtime_error",
      message: "old",
    })
    emit("messageError", { sessionId, runId: "old", partId: "old-error", message: "old" })
    emit("messageCompleted", { sessionId, runId: "old" })
  })
  expect(h.state.status).toBe("streaming")
  expect(h.state.error).toBeNull()
  expect(h.state.pendingPermissions.map((request) => request.id)).toEqual(["new-permission"])
})

test("a cancellation timeout retains the stop control until late cancellation settlement", async () => {
  const h = await mount()
  React.act(() => emit("activeRunUpdated", { sessionId, run: run("old") }))
  transport.invoke.mockRejectedValueOnce(new Error("Cancellation timed out"))
  await React.act(async () => {
    await h.state.stop(sessionId).catch(() => undefined)
  })
  expect(h.state.status).toBe("streaming")
  expect(h.state.error).toContain("Cancellation timed out")
  React.act(() => {
    emit("activeRunUpdated", { sessionId, run: null, endedRunId: "old" })
    emit("turnOutcome", { sessionId, runId: "old", kind: "cancelled" })
    emit("generationStopped", { sessionId, runId: "old" })
  })
  expect(h.state.status).toBe("ready")
  expect(h.state.error).toBeNull()
})

test("a stale send failure and terminal event cannot erase a new optimistic submission", async () => {
  const h = await mount()
  const first = deferred()
  transport.invoke.mockImplementationOnce(() => first.promise)
  let sending!: Promise<void>
  React.act(() => {
    sending = h.state.send(sessionId, "first", [], { sessionScope: scope }).catch(() => undefined)
  })
  React.act(() => {
    emit("activeRunUpdated", { sessionId, run: run("old") })
    emit("activeRunUpdated", { sessionId, run: null, endedRunId: "old" })
  })
  await React.act(async () => {
    await h.state.send(sessionId, "second", [], { sessionScope: scope })
  })
  await React.act(async () => {
    emit("generationStopped", { sessionId, runId: "old" })
    first.reject(new Error("old dispatch failed"))
    await sending
  })
  expect(h.state.status).toBe("submitted")
  expect(h.state.error).toBeNull()
  expect(h.state.messages.flatMap((message) => message.parts).some((part) => part.kind === "error")).toBe(false)
})

test.each(["answerQuestion", "answerPermission", "rejectQuestion"] as const)(
  "a late %s failure cannot replace the next run with an error",
  async (method) => {
    const h = await mount()
    React.act(() => emit("activeRunUpdated", { sessionId, run: run("old") }))
    const pending = deferred()
    transport.invoke.mockImplementationOnce(() => pending.promise)
    let reply!: Promise<void>
    React.act(() => {
      if (method === "answerQuestion") reply = h.state.answerQuestion(sessionId, "old-question", [["yes"]])
      else if (method === "rejectQuestion") reply = h.state.rejectQuestion(sessionId, "old-question")
      else reply = h.state.answerPermission(sessionId, "old-permission", "once")
      reply = reply.catch(() => undefined)
    })
    React.act(() => {
      emit("activeRunUpdated", { sessionId, run: null, endedRunId: "old" })
      startNewRun()
    })
    await React.act(async () => {
      pending.reject(new Error("old reply failed"))
      await reply
    })
    expect(h.state.status).toBe("streaming")
    expect(h.state.error).toBeNull()
    expect(h.state.pendingPermissions.map((request) => request.id)).toEqual(["new-permission"])
  },
)

test("a send failure remains visible after its optimistic token binds to the host run", async () => {
  const h = await mount()
  const pending = deferred()
  transport.invoke.mockImplementationOnce(() => pending.promise)
  let sending!: Promise<void>
  React.act(() => {
    sending = h.state.send(sessionId, "first", [], { sessionScope: scope }).catch(() => undefined)
  })
  React.act(() => emit("activeRunUpdated", { sessionId, run: run("old") }))
  await React.act(async () => {
    pending.reject(new Error("current dispatch failed"))
    await sending
  })
  expect(h.state.status).toBe("error")
  expect(h.state.messages.flatMap((message) => message.parts).some((part) => part.kind === "error")).toBe(true)
})
