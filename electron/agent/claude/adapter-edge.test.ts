import type { AgentEvent } from "../contract/event.ts"
import type { ExternalAgentRuntimeStatus } from "../external/probe.ts"
import type { Options, Query, SDKMessage, SDKUserMessage, query } from "@anthropic-ai/claude-agent-sdk"

import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ClaudeCodeAgentAdapter } from "./adapter.ts"

// Adversarial turn-lifecycle edge tests for the Claude Code adapter, driven
// through the same fake queryFn harness as adapter.test.ts (controllable
// push/end/fail stream plus control-method spies).
//
// Scenarios: cancel mid-turn, queued second prompt, stop mid-turn with a
// parked permission, query-loop death mid-turn (rejecting and cleanly ending),
// duplicate/odd SDK frame orders, aborted-signal prompts, prompt-after-stop.

const sessionUuid = "12345678-1234-4123-8123-123456789abc"
const sessionId = `wanta-ext:claude-code:${sessionUuid}`

interface FakeQueryHandle {
  push: (message: SDKMessage) => void
  end: () => void
  fail: (error: unknown) => void
  promptMessages: SDKUserMessage[]
  interrupt: ReturnType<typeof vi.fn>
  setPermissionMode: ReturnType<typeof vi.fn>
  setModel: ReturnType<typeof vi.fn>
  applyFlagSettings: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

interface FakeQueryCall {
  options: Options
  fake: FakeQueryHandle
}

function createFakeQueryFn(): { queryFn: typeof query; calls: FakeQueryCall[] } {
  const calls: FakeQueryCall[] = []
  const queryFn = vi.fn((params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }): Query => {
    const buffered: SDKMessage[] = []
    const waiters: Array<{
      resolve: (result: IteratorResult<SDKMessage>) => void
      reject: (error: unknown) => void
    }> = []
    let ended = false
    let failure: unknown
    const push = (message: SDKMessage): void => {
      const waiter = waiters.shift()
      if (waiter) {
        waiter.resolve({ value: message, done: false })
        return
      }
      buffered.push(message)
    }
    const end = (): void => {
      ended = true
      for (const waiter of waiters.splice(0)) {
        waiter.resolve({ value: undefined, done: true })
      }
    }
    const fail = (error: unknown): void => {
      failure = error
      ended = true
      for (const waiter of waiters.splice(0)) {
        waiter.reject(error)
      }
    }
    const next = (): Promise<IteratorResult<SDKMessage>> => {
      if (buffered.length > 0) {
        return Promise.resolve({ value: buffered.shift() as SDKMessage, done: false })
      }
      if (failure !== undefined) {
        return Promise.reject(failure)
      }
      if (ended) {
        return Promise.resolve({ value: undefined, done: true })
      }
      return new Promise((resolve, reject) => {
        waiters.push({ resolve, reject })
      })
    }
    const promptMessages: SDKUserMessage[] = []
    if (typeof params.prompt !== "string") {
      const prompt = params.prompt
      void (async () => {
        for await (const message of prompt) {
          promptMessages.push(message)
        }
      })()
    }
    const interrupt = vi.fn(() => Promise.resolve(undefined))
    const setPermissionMode = vi.fn(() => Promise.resolve())
    const setModel = vi.fn(() => Promise.resolve())
    const applyFlagSettings = vi.fn(() => Promise.resolve({}))
    const close = vi.fn(() => {
      end()
    })
    calls.push({
      options: params.options ?? {},
      fake: { push, end, fail, promptMessages, interrupt, setPermissionMode, setModel, applyFlagSettings, close },
    })
    return {
      [Symbol.asyncIterator]: () => ({ next }),
      interrupt,
      setPermissionMode,
      setModel,
      applyFlagSettings,
      close,
    } as unknown as Query
  })
  return { queryFn: queryFn as unknown as typeof query, calls }
}

function detectedStatus(): ExternalAgentRuntimeStatus {
  return {
    kind: "claude-code",
    displayName: "Claude Code",
    binary: { status: "detected", path: "/fake/claude", version: "2.1.226" },
    login: { status: "logged_in" },
    loginHint: "Run `claude` in a terminal and sign in, then retry.",
  }
}

const scratchDirs: string[] = []
const startedAdapters: ClaudeCodeAgentAdapter[] = []

interface HarnessOptions {
  commandPath?: () => Promise<string>
}

async function createHarness(options: HarnessOptions = {}) {
  const scratchRootDir = await mkdtemp(path.join(os.tmpdir(), "wanta-claude-adapter-edge-test-"))
  scratchDirs.push(scratchRootDir)
  const probe = vi.fn(() => Promise.resolve(detectedStatus()))
  const { queryFn, calls } = createFakeQueryFn()
  const adapter = new ClaudeCodeAgentAdapter({
    probe,
    scratchRootDir,
    commandPath: options.commandPath ?? (() => Promise.resolve("/fake/path-bin")),
    queryFn,
  })
  await adapter.start()
  startedAdapters.push(adapter)
  const events: AgentEvent[] = []
  adapter.onEvent((event) => events.push(event))
  return { adapter, events, calls, probe, scratchRootDir }
}

afterEach(async () => {
  for (const adapter of startedAdapters.splice(0)) {
    await adapter.stop()
  }
  for (const dir of scratchDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

function assistantMessage(id: string, text: string): SDKMessage {
  return {
    type: "assistant",
    message: { id, type: "message", role: "assistant", content: [{ type: "text", text }] },
    parent_tool_use_id: null,
    uuid: "aaaaaaaa-0000-4000-8000-000000000001",
    session_id: sessionUuid,
  } as unknown as SDKMessage
}

function resultSuccess(): SDKMessage {
  return { type: "result", subtype: "success", is_error: false } as unknown as SDKMessage
}

function completedCount(events: AgentEvent[]): number {
  return events.filter((event) => event.event === "messageCompleted").length
}

function sessionsOf(adapter: ClaudeCodeAgentAdapter): Map<string, unknown> {
  // Test-only introspection of the private session registry; there is no
  // public probe for "the query loop has fully wound down".
  return (adapter as unknown as { sessions: Map<string, unknown> }).sessions
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe("ClaudeCodeAgentAdapter turn lifecycle edges", () => {
  it("cancel mid-turn interrupts the query, completion settles once, and the same query serves the next prompt", async () => {
    const { adapter, events, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "first", messageId: "user-1" })
    calls[0].fake.push(assistantMessage("msg_1", "working on it"))
    await vi.waitFor(() =>
      expect(events.some((event) => event.event === "messageStarted" && event.data.role === "assistant")).toBe(true),
    )
    await adapter.send({ type: "cancel", sessionId })
    expect(calls[0].fake.interrupt).toHaveBeenCalledTimes(1)
    // The CLI answers an interrupt with a result frame ending the turn.
    calls[0].fake.push(resultSuccess())
    await vi.waitFor(() => expect(completedCount(events)).toBe(1))
    // The next prompt rides the same live query, no respawn.
    await adapter.send({ type: "prompt", sessionId, text: "second", messageId: "user-2" })
    expect(calls).toHaveLength(1)
    await vi.waitFor(() => expect(calls[0].fake.promptMessages).toHaveLength(2))
    calls[0].fake.push(assistantMessage("msg_2", "second answer"))
    calls[0].fake.push(resultSuccess())
    await vi.waitFor(() => expect(completedCount(events)).toBe(2))
  })

  it("a second prompt while a turn is in flight queues into the same query without corrupting state", async () => {
    // The Claude adapter deliberately has no in-flight guard: streaming input
    // mode queues prompts and the CLI serializes turns natively. The chat
    // layer's generation registry is what prevents true concurrent turns.
    const { adapter, events, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "one", messageId: "user-1" })
    await adapter.send({ type: "prompt", sessionId, text: "two", messageId: "user-2" })
    expect(calls).toHaveLength(1)
    await vi.waitFor(() => expect(calls[0].fake.promptMessages).toHaveLength(2))
    const userStarts = events.filter((event) => event.event === "messageStarted" && event.data.role === "user")
    expect(userStarts).toHaveLength(2)
    // Both user turns are preserved in the transcript.
    const messages = await adapter.getMessages(sessionId)
    expect(messages.filter((message) => message.role === "user")).toHaveLength(2)
  })

  it("stop() mid-turn with a parked permission settles the SDK promise and emits exactly one permissionReplied", async () => {
    const { adapter, events, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "hello", messageId: "user-1" })
    const canUseTool = calls[0].options.canUseTool
    const controller = new AbortController()
    const parked = canUseTool!(
      "Bash",
      { command: "sleep 1000" },
      { signal: controller.signal, requestId: "req-stop", toolUseID: "toolu_1" },
    )
    expect(events.some((event) => event.event === "permissionAsked")).toBe(true)
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on("unhandledRejection", onUnhandled)
    try {
      await adapter.stop()
      await expect(parked).resolves.toEqual({ behavior: "deny", message: "The agent was stopped." })
      const replies = events.filter((event) => event.event === "permissionReplied")
      expect(replies).toHaveLength(1)
      expect(calls[0].fake.close).toHaveBeenCalledTimes(1)
      await new Promise((resolve) => setTimeout(resolve, 25))
      expect(unhandled).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
  })

  it("KNOWN BUG: a query-loop crash orphans parked permission requests instead of sweeping them", async () => {
    // runQueryLoop's catch/finally (adapter.ts) emits agentError and deletes
    // the session, but never settles pendingSdkPermissions entries of that
    // session — unlike handleStop and handleForgetSession, which both sweep
    // them, and unlike the ACP adapter's handleConnectionLost. After a crash
    // the parked ChatPermissionRequest stays in getPendingPermissions()
    // forever, so the UI keeps showing a permission card for a dead query.
    const { adapter, events, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "hello", messageId: "user-1" })
    const canUseTool = calls[0].options.canUseTool
    // The SDK's canUseTool signal never aborts here, mirroring a hard process
    // crash where no orderly per-request abort is delivered.
    void canUseTool!(
      "Bash",
      { command: "ls" },
      { signal: new AbortController().signal, requestId: "req-orphan", toolUseID: "toolu_2" },
    )
    expect(events.some((event) => event.event === "permissionAsked")).toBe(true)
    calls[0].fake.fail(new Error("process exited with code 1"))
    await vi.waitFor(() => expect(events.some((event) => event.event === "agentError")).toBe(true))
    await vi.waitFor(() => expect(sessionsOf(adapter).size).toBe(0))
    // The dead turn's permission must not stay pending: the UI would show a
    // zombie permission card for a query that no longer exists.
    expect(events.some((event) => event.event === "permissionReplied" && event.data.requestId === "req-orphan")).toBe(
      true,
    )
    await expect(adapter.getPendingPermissions(sessionId)).resolves.toEqual([])
  })

  it("KNOWN BUG: a query stream that ends without a result frame never settles the turn", async () => {
    // When the CLI subprocess dies cleanly mid-turn the SDK iterator just
    // finishes; runQueryLoop's finally block (adapter.ts) removes the session
    // and ends the input queue but emits NO terminal event — neither
    // messageCompleted nor agentError. The turn stays unsettled and the UI's
    // streaming state relies purely on chat-layer watchdogs to recover.
    const { adapter, events, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "hello", messageId: "user-1" })
    calls[0].fake.push(assistantMessage("msg_1", "partial answer"))
    await vi.waitFor(() =>
      expect(events.some((event) => event.event === "messageStarted" && event.data.role === "assistant")).toBe(true),
    )
    // Clean end mid-turn (subprocess exited without a result frame).
    calls[0].fake.end()
    await vi.waitFor(() => expect(sessionsOf(adapter).size).toBe(0))
    // The turn must settle exactly once: either a completion or an error.
    const terminal = events.filter((event) => event.event === "messageCompleted" || event.event === "agentError")
    expect(terminal.length).toBeGreaterThan(0)
  })

  it("a query-loop crash cleans the session and the next prompt spawns a fresh query", async () => {
    const { adapter, events, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "hello", messageId: "user-1" })
    calls[0].fake.fail(new Error("process exited with code 1"))
    await vi.waitFor(() => expect(events.some((event) => event.event === "agentError")).toBe(true))
    await vi.waitFor(() => expect(sessionsOf(adapter).size).toBe(0))
    await adapter.send({ type: "prompt", sessionId, text: "retry", messageId: "user-2" })
    expect(calls).toHaveLength(2)
    await vi.waitFor(() => expect(calls[1].fake.promptMessages).toHaveLength(1))
    calls[1].fake.push(assistantMessage("msg_2", "recovered"))
    calls[1].fake.push(resultSuccess())
    await vi.waitFor(() => expect(completedCount(events)).toBe(1))
  })

  it("duplicate result frames and tool_result frames without tool_use are tolerated", async () => {
    const { adapter, events, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "hello", messageId: "user-1" })
    // tool_result for a call id that never had a tool_use announcement.
    calls[0].fake.push({
      type: "user",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "ghost", content: "out" }] },
      parent_tool_use_id: null,
      session_id: sessionUuid,
    } as unknown as SDKMessage)
    await vi.waitFor(() => expect(events.some((event) => event.event === "toolCallResult")).toBe(true))
    const ghost = events.find((event) => event.event === "toolCallResult")
    expect(ghost?.event === "toolCallResult" && ghost.data.callId).toBe("ghost")
    // Duplicate result frames: no throw, transcript stays sane.
    calls[0].fake.push(assistantMessage("msg_1", "answer"))
    calls[0].fake.push(resultSuccess())
    calls[0].fake.push(resultSuccess())
    await vi.waitFor(() => expect(completedCount(events)).toBe(2))
    const messages = await adapter.getMessages(sessionId)
    const assistants = messages.filter((message) => message.role === "assistant")
    expect(assistants.length).toBeGreaterThan(0)
    // Completion was materialized once; a duplicate frame must not reset it.
    expect(assistants.at(-1)?.completedAt).toBeDefined()
    // And the session still takes the next prompt on the same query.
    await adapter.send({ type: "prompt", sessionId, text: "again", messageId: "user-2" })
    expect(calls).toHaveLength(1)
    await vi.waitFor(() => expect(calls[0].fake.promptMessages).toHaveLength(2))
  })

  it("a prompt with an already-aborted signal after a completed turn adds nothing and keeps the session live", async () => {
    const { adapter, events, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "first", messageId: "user-1" })
    calls[0].fake.push(assistantMessage("msg_1", "done"))
    calls[0].fake.push(resultSuccess())
    await vi.waitFor(() => expect(completedCount(events)).toBe(1))
    const eventsBefore = events.length
    const controller = new AbortController()
    controller.abort()
    await adapter.send(
      { type: "prompt", sessionId, text: "aborted", messageId: "user-x" },
      {
        signal: controller.signal,
      },
    )
    expect(events).toHaveLength(eventsBefore)
    expect(calls[0].fake.promptMessages).toHaveLength(1)
    await adapter.send({ type: "prompt", sessionId, text: "real", messageId: "user-2" })
    await vi.waitFor(() => expect(calls[0].fake.promptMessages).toHaveLength(2))
  })

  it("a signal aborting during session creation spawns no user turn and pushes no prompt", async () => {
    const gate = deferred<string>()
    let commandPathCalls = 0
    const { adapter, events, calls } = await createHarness({
      commandPath: () => {
        commandPathCalls += 1
        return gate.promise
      },
    })
    const controller = new AbortController()
    const sendPromise = adapter.send(
      { type: "prompt", sessionId, text: "doomed", messageId: "user-1" },
      { signal: controller.signal },
    )
    await vi.waitFor(() => expect(commandPathCalls).toBe(1))
    controller.abort()
    gate.resolve("/fake/path-bin")
    await expect(sendPromise).resolves.toBeUndefined()
    // The query was already being created and stays as an idle session, but
    // no user turn leaked and nothing was submitted.
    expect(calls).toHaveLength(1)
    expect(calls[0].fake.promptMessages).toHaveLength(0)
    expect(events).toHaveLength(0)
    // The idle session serves the next real prompt.
    await adapter.send({ type: "prompt", sessionId, text: "for real", messageId: "user-2" })
    expect(calls).toHaveLength(1)
    await vi.waitFor(() => expect(calls[0].fake.promptMessages).toHaveLength(1))
  })

  it("KNOWN BUG: a prompt after stop() spawns a zombie query instead of being rejected", async () => {
    // BaseAgentAdapter.send has no lifecycle guard and ClaudeCodeAgentAdapter
    // createSession (adapter.ts) never checks isStarted, so a prompt sent
    // after stop() silently spawns a fresh CLI subprocess on a stopped
    // adapter. stop() is idempotent and returns early on the second call, so
    // nothing will ever close that query: a real subprocess leak. The ACP
    // adapter guards this in openConnection ("adapter stopped while
    // connecting"); the Claude adapter needs the same rejection.
    const { adapter, calls } = await createHarness()
    await adapter.stop()
    await expect(adapter.send({ type: "prompt", sessionId, text: "late", messageId: "user-1" })).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })
})
