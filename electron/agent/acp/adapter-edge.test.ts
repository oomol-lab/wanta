import type { AgentEvent } from "../contract/event.ts"
import type { ExternalAgentRuntimeStatus } from "../external/probe.ts"
import type { AcpTransport } from "./adapter.ts"
import type {
  AnyMessage,
  NewSessionRequest,
  NewSessionResponse,
  PermissionOption,
  PromptRequest,
  PromptResponse,
  RequestPermissionResponse,
  SessionUpdate,
  Stream,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk"

import { agent, PROTOCOL_VERSION, RequestError } from "@agentclientprotocol/sdk"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { AcpAgentAdapter } from "./adapter.ts"
import { ACP_AGENT_REGISTRY } from "./registry.ts"

// Adversarial turn-lifecycle edge tests for the generic ACP adapter.
//
// The in-process fake ACP agent mirrors the harness in adapter.test.ts,
// extended with:
// - per-call prompt/newSession behaviors (closures with counters),
// - a raw session/update channel that can target arbitrary session ids,
// - deferred turns so a test can hold a turn open deterministically.
//
// Scenarios: cancel mid-turn, prompt-while-in-flight, stop mid-turn,
// process/stream death mid-turn, pending permissions across cancel/stop,
// duplicate and out-of-order wire events, and aborted-signal prompts.

const WANTA_SESSION_ID = "wanta-session-edge"

interface FakePromptTurn {
  params: PromptRequest
  sendUpdate: (update: SessionUpdate) => Promise<void>
  /** Raw update channel: lets a test target an arbitrary (unknown) session id. */
  sendUpdateFor: (sessionId: string, update: SessionUpdate) => Promise<void>
  requestPermission: (toolCall: ToolCallUpdate, options: PermissionOption[]) => Promise<RequestPermissionResponse>
  /** Resolves when the fake agent receives session/cancel. */
  cancelled: Promise<void>
}

interface FakeAgentBehavior {
  /** Override session/new; may throw or return a promise (slow creation). */
  newSession?: (params: NewSessionRequest) => NewSessionResponse | Promise<NewSessionResponse>
  /** Drive a prompt turn; defaults to an immediate end_turn. */
  prompt?: (turn: FakePromptTurn) => Promise<PromptResponse>
}

interface FakeAgent {
  connect: () => Promise<AcpTransport>
  connectCount: () => number
  fireExit: (code: number | null) => void
  newSessionRequests: NewSessionRequest[]
  promptRequests: PromptRequest[]
  closedSessionIds: string[]
  cancelledSessionIds: string[]
  permissionResponses: RequestPermissionResponse[]
}

function createFakeAgent(behavior: FakeAgentBehavior = {}): FakeAgent {
  let sessionSeq = 0
  let connectCount = 0
  const cancelResolvers: Array<() => void> = []
  const exitCallbackGroups: Array<Array<(info: { code: number | null }) => void>> = []
  const newSessionRequests: NewSessionRequest[] = []
  const promptRequests: PromptRequest[] = []
  const closedSessionIds: string[] = []
  const cancelledSessionIds: string[] = []
  const permissionResponses: RequestPermissionResponse[] = []

  const app = agent({ name: "fake-acp-agent-edge" })
    .onRequest("initialize", () => ({ protocolVersion: PROTOCOL_VERSION }))
    .onRequest("session/new", ({ params }) => {
      newSessionRequests.push(params)
      if (behavior.newSession) {
        return behavior.newSession(params)
      }
      sessionSeq += 1
      return { sessionId: `acp-session-${sessionSeq}` }
    })
    .onRequest("session/prompt", async ({ params, client: agentClient }) => {
      promptRequests.push(params)
      const promptBehavior = behavior.prompt
      if (!promptBehavior) {
        return { stopReason: "end_turn" }
      }
      const cancelled = new Promise<void>((resolve) => {
        cancelResolvers.push(resolve)
      })
      return promptBehavior({
        params,
        sendUpdate: (update) => agentClient.notify("session/update", { sessionId: params.sessionId, update }),
        sendUpdateFor: (sessionId, update) => agentClient.notify("session/update", { sessionId, update }),
        requestPermission: async (toolCall, options) => {
          const response = await agentClient.request("session/request_permission", {
            sessionId: params.sessionId,
            toolCall,
            options,
          })
          permissionResponses.push(response)
          return response
        },
        cancelled,
      })
    })
    .onRequest(
      "session/close",
      (params: unknown) => params as { sessionId: string },
      ({ params }) => {
        closedSessionIds.push(params.sessionId)
        return {}
      },
    )
    .onNotification("session/cancel", ({ params }) => {
      cancelledSessionIds.push(params.sessionId)
      for (const resolve of cancelResolvers.splice(0)) {
        resolve()
      }
    })

  return {
    connect: async () => {
      connectCount += 1
      const clientToAgent = new TransformStream<AnyMessage, AnyMessage>()
      const agentToClient = new TransformStream<AnyMessage, AnyMessage>()
      const agentSide: Stream = { writable: agentToClient.writable, readable: clientToAgent.readable }
      const clientSide: Stream = { writable: clientToAgent.writable, readable: agentToClient.readable }
      const agentConnection = app.connect(agentSide)
      const exitCallbacks: Array<(info: { code: number | null }) => void> = []
      exitCallbackGroups.push(exitCallbacks)
      return {
        stream: clientSide,
        dispose: () => {
          agentConnection.close()
        },
        onExit: (callback) => {
          exitCallbacks.push(callback)
        },
      }
    },
    connectCount: () => connectCount,
    fireExit: (code) => {
      const latest = exitCallbackGroups.at(-1) ?? []
      for (const callback of latest) {
        callback({ code })
      }
    },
    newSessionRequests,
    promptRequests,
    closedSessionIds,
    cancelledSessionIds,
    permissionResponses,
  }
}

const startedAdapters: AcpAgentAdapter[] = []

afterEach(async () => {
  for (const adapter of startedAdapters.splice(0)) {
    await adapter.stop()
  }
})

interface AdapterHarness {
  adapter: AcpAgentAdapter
  fake: FakeAgent
  events: AgentEvent[]
  waitFor: (predicate: (event: AgentEvent) => boolean) => Promise<AgentEvent>
}

async function createHarness(behavior: FakeAgentBehavior = {}): Promise<AdapterHarness> {
  const fake = createFakeAgent(behavior)
  const kind = "codex" as const
  const registration = ACP_AGENT_REGISTRY[kind]
  const scratchRootDir = await mkdtemp(path.join(os.tmpdir(), "acp-adapter-edge-test-"))
  const probe = vi.fn(async (): Promise<ExternalAgentRuntimeStatus> => ({
    kind,
    displayName: registration.displayName,
    binary: { status: "detected", path: "/fake/bin/agent", version: "1.0.0" },
    login: { status: "unknown" },
    loginHint: registration.loginHint,
  }))
  const adapter = new AcpAgentAdapter({
    kind,
    registration,
    probe,
    scratchRootDir,
    connect: fake.connect,
  })
  await adapter.start()
  startedAdapters.push(adapter)
  const events: AgentEvent[] = []
  const waiters: Array<{ predicate: (event: AgentEvent) => boolean; resolve: (event: AgentEvent) => void }> = []
  adapter.onEvent((event) => {
    events.push(event)
    const matched = waiters.filter((waiter) => waiter.predicate(event))
    for (const waiter of matched) {
      waiters.splice(waiters.indexOf(waiter), 1)
      waiter.resolve(event)
    }
  })
  const waitFor = (predicate: (event: AgentEvent) => boolean): Promise<AgentEvent> => {
    const existing = events.find(predicate)
    if (existing) {
      return Promise.resolve(existing)
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for agent event")), 2000)
      waiters.push({
        predicate,
        resolve: (event) => {
          clearTimeout(timer)
          resolve(event)
        },
      })
    })
  }
  return { adapter, fake, events, waitFor }
}

function promptInput(text = "hello agent"): { type: "prompt"; sessionId: string; text: string } {
  // No messageId on purpose: the adapter mints a unique id per turn, so
  // multi-turn tests never merge user bubbles under one recycled id.
  return { type: "prompt", sessionId: WANTA_SESSION_ID, text }
}

function completedCount(events: AgentEvent[]): number {
  return events.filter((event) => event.event === "messageCompleted").length
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const permissionOptions: PermissionOption[] = [
  { optionId: "opt-allow-once", name: "Allow once", kind: "allow_once" },
  { optionId: "opt-reject-once", name: "Reject", kind: "reject_once" },
]

describe("AcpAgentAdapter turn lifecycle edges", () => {
  test("cancel mid-turn: late updates still surface, completion settles exactly once, next prompt reuses the session", async () => {
    let promptCalls = 0
    const harness = await createHarness({
      prompt: async (turn) => {
        promptCalls += 1
        if (promptCalls === 1) {
          await turn.sendUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "before" } })
          await turn.cancelled
          // Per protocol the agent may flush pending updates before answering
          // the prompt with the cancelled stop reason.
          await turn.sendUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "after" } })
          return { stopReason: "cancelled" }
        }
        return { stopReason: "end_turn" }
      },
    })
    await harness.adapter.send(promptInput())
    await harness.waitFor((event) => event.event === "messageDelta" && event.data.delta === "before")
    await harness.adapter.send({ type: "cancel", sessionId: WANTA_SESSION_ID })
    await harness.waitFor((event) => event.event === "messageCompleted")
    expect(completedCount(harness.events)).toBe(1)
    expect(harness.events.some((event) => event.event === "agentError")).toBe(false)
    expect(harness.fake.cancelledSessionIds).toEqual(["acp-session-1"])
    const afterIndex = harness.events.findIndex(
      (event) => event.event === "messageDelta" && event.data.delta === "after",
    )
    const completedIndex = harness.events.findIndex((event) => event.event === "messageCompleted")
    expect(afterIndex).toBeGreaterThan(-1)
    expect(afterIndex).toBeLessThan(completedIndex)
    // The same ACP session takes the next prompt without a respawn.
    await harness.adapter.send(promptInput("next turn"))
    await vi.waitFor(() => expect(completedCount(harness.events)).toBe(2))
    expect(harness.fake.newSessionRequests).toHaveLength(1)
    expect(harness.fake.promptRequests).toHaveLength(2)
    expect(harness.fake.connectCount()).toBe(1)
  })

  test("a prompt rejection with the requestCancelled code ends the turn as a completion, not an error", async () => {
    const harness = await createHarness({
      prompt: async () => {
        // Agent-initiated cancellation without any client-side cancel.
        throw RequestError.requestCancelled()
      },
    })
    await harness.adapter.send(promptInput())
    await harness.waitFor((event) => event.event === "messageCompleted")
    expect(completedCount(harness.events)).toBe(1)
    expect(harness.events.some((event) => event.event === "agentError")).toBe(false)
  })

  test("cancel without a session or an active turn is a silent no-op", async () => {
    const harness = await createHarness()
    await expect(harness.adapter.send({ type: "cancel", sessionId: WANTA_SESSION_ID })).resolves.toBeUndefined()
    expect(harness.events).toHaveLength(0)
    expect(harness.fake.cancelledSessionIds).toHaveLength(0)
    // Double-cancel of a live turn must not throw either.
    const release = deferred()
    let promptCalls = 0
    const busy = await createHarness({
      prompt: async () => {
        promptCalls += 1
        await release.promise
        return { stopReason: "end_turn" }
      },
    })
    await busy.adapter.send(promptInput())
    await busy.adapter.send({ type: "cancel", sessionId: WANTA_SESSION_ID })
    await busy.adapter.send({ type: "cancel", sessionId: WANTA_SESSION_ID })
    release.resolve()
    await busy.waitFor((event) => event.event === "messageCompleted")
    expect(completedCount(busy.events)).toBe(1)
    expect(promptCalls).toBe(1)
  })

  test("a second prompt while a turn is in flight rejects loudly and leaves the session usable", async () => {
    const release = deferred()
    let promptCalls = 0
    const harness = await createHarness({
      prompt: async () => {
        promptCalls += 1
        if (promptCalls === 1) {
          await release.promise
        }
        return { stopReason: "end_turn" }
      },
    })
    await harness.adapter.send(promptInput("first"))
    await expect(harness.adapter.send(promptInput("too eager"))).rejects.toThrow(/already in flight/u)
    // The rejected prompt must not synthesize a user turn.
    const userStarts = harness.events.filter((event) => event.event === "messageStarted" && event.data.role === "user")
    expect(userStarts).toHaveLength(1)
    expect(harness.fake.promptRequests).toHaveLength(1)
    release.resolve()
    await harness.waitFor((event) => event.event === "messageCompleted")
    // The first turn completed untouched; a fresh prompt now works.
    await harness.adapter.send(promptInput("after"))
    await vi.waitFor(() => expect(completedCount(harness.events)).toBe(2))
    expect(harness.fake.promptRequests).toHaveLength(2)
  })

  test("concurrent first prompts racing session creation collapse to one dispatched turn", async () => {
    const release = deferred()
    let promptCalls = 0
    const harness = await createHarness({
      prompt: async () => {
        promptCalls += 1
        if (promptCalls === 1) {
          await release.promise
        }
        return { stopReason: "end_turn" }
      },
    })
    const results = await Promise.allSettled([
      harness.adapter.send(promptInput("racer A")),
      harness.adapter.send(promptInput("racer B")),
    ])
    const rejected = results.filter((result) => result.status === "rejected")
    expect(rejected).toHaveLength(1)
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(/already in flight/u)
    // Exactly one turn reached the wire and exactly one user bubble exists.
    expect(harness.fake.promptRequests).toHaveLength(1)
    expect(harness.fake.newSessionRequests).toHaveLength(1)
    const userStarts = harness.events.filter((event) => event.event === "messageStarted" && event.data.role === "user")
    expect(userStarts).toHaveLength(1)
    release.resolve()
    await harness.waitFor((event) => event.event === "messageCompleted")
    await harness.adapter.send(promptInput("after the race"))
    await vi.waitFor(() => expect(completedCount(harness.events)).toBe(2))
  })

  test("stop() mid-turn resolves cleanly with no unhandled rejections", async () => {
    const harness = await createHarness({
      prompt: async (turn) => {
        await turn.sendUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "spinning" } })
        // Crash-style turn: the prompt response never arrives.
        return new Promise<PromptResponse>(() => {})
      },
    })
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on("unhandledRejection", onUnhandled)
    try {
      await harness.adapter.send(promptInput())
      await harness.waitFor((event) => event.event === "messageDelta" && event.data.delta === "spinning")
      await harness.adapter.stop()
      // Give the settle paths a macrotask to fire whatever they are going to fire.
      await new Promise((resolve) => setTimeout(resolve, 25))
      expect(unhandled).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
  })

  test("KNOWN BUG: stop() mid-turn broadcasts a spurious agentError through still-attached listeners", async () => {
    // disposeConnection detaches the handle first exactly so that connection
    // loss handling "skips the error broadcast" (adapter.ts:852). But the
    // in-flight turn is left unsettled, so closing the connection rejects the
    // pending session/prompt request, and trackTurn's rejection handler
    // (adapter.ts:703-716) emits `agentError: "... prompt failed: ACP
    // connection closed"` in a microtask that runs BEFORE BaseAgentAdapter's
    // stop() clears the listeners. A deliberate stop therefore surfaces a
    // spurious error to the chat layer for every in-flight turn.
    const harness = await createHarness({
      prompt: async (turn) => {
        await turn.sendUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "spinning" } })
        return new Promise<PromptResponse>(() => {})
      },
    })
    await harness.adapter.send(promptInput())
    await harness.waitFor((event) => event.event === "messageDelta" && event.data.delta === "spinning")
    const eventsBefore = harness.events.length
    await harness.adapter.stop()
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(harness.events.slice(eventsBefore)).toEqual([])
  })

  test("an in-flight session/prompt rejection emits agentError and the session recovers without a respawn", async () => {
    let promptCalls = 0
    const harness = await createHarness({
      prompt: async () => {
        promptCalls += 1
        if (promptCalls === 1) {
          throw new Error("agent blew up")
        }
        return { stopReason: "end_turn" }
      },
    })
    await harness.adapter.send(promptInput())
    const error = await harness.waitFor((event) => event.event === "agentError")
    expect(error.event === "agentError" && error.data.message).toMatch(/prompt failed/u)
    // Same connection, same ACP session: only the turn failed.
    await harness.adapter.send(promptInput("retry"))
    await harness.waitFor((event) => event.event === "messageCompleted")
    expect(harness.fake.connectCount()).toBe(1)
    expect(harness.fake.newSessionRequests).toHaveLength(1)
    expect(harness.fake.promptRequests).toHaveLength(2)
  })

  test("a session/new failure rejects the send and the next prompt retries session creation", async () => {
    let newSessionCalls = 0
    const harness = await createHarness({
      newSession: () => {
        newSessionCalls += 1
        if (newSessionCalls === 1) {
          throw new Error("kaboom")
        }
        return { sessionId: `acp-session-${newSessionCalls}` }
      },
    })
    await expect(harness.adapter.send(promptInput())).rejects.toThrow(/could not open a session/u)
    await harness.waitFor((event) => event.event === "agentError")
    // No user turn was synthesized for the failed send.
    expect(harness.events.filter((event) => event.event === "messageStarted")).toHaveLength(0)
    await harness.adapter.send(promptInput("retry"))
    await harness.waitFor((event) => event.event === "messageCompleted")
    expect(harness.fake.newSessionRequests).toHaveLength(2)
    expect(harness.fake.connectCount()).toBe(1)
  })

  test("subprocess exit with a pending permission sweeps it, fails the turn, and the next prompt respawns", async () => {
    let promptCalls = 0
    const harness = await createHarness({
      prompt: async (turn) => {
        promptCalls += 1
        if (promptCalls === 1) {
          void turn
            .requestPermission({ toolCallId: "call-1", title: "Do the thing" }, permissionOptions)
            .catch(() => undefined)
          return new Promise<PromptResponse>(() => {})
        }
        return { stopReason: "end_turn" }
      },
    })
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on("unhandledRejection", onUnhandled)
    try {
      await harness.adapter.send(promptInput())
      const asked = await harness.waitFor((event) => event.event === "permissionAsked")
      const requestId = asked.event === "permissionAsked" ? asked.data.request.id : ""
      harness.fake.fireExit(1)
      await harness.waitFor((event) => event.event === "agentError")
      await harness.waitFor((event) => event.event === "permissionReplied" && event.data.requestId === requestId)
      await expect(harness.adapter.getPendingPermissions(WANTA_SESSION_ID)).resolves.toEqual([])
      // Recovery: the next prompt respawns the subprocess and a fresh session.
      await harness.adapter.send(promptInput("after crash"))
      await harness.waitFor((event) => event.event === "messageCompleted")
      expect(harness.fake.connectCount()).toBe(2)
      expect(harness.fake.newSessionRequests).toHaveLength(2)
      await new Promise((resolve) => setTimeout(resolve, 25))
      expect(unhandled).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
  })

  test("a permission asked after cancel is auto-answered with the cancelled outcome and never surfaces", async () => {
    const harness = await createHarness({
      prompt: async (turn) => {
        await turn.requestPermission({ toolCallId: "call-1", title: "First ask" }, permissionOptions)
        await turn.cancelled
        // The turn is being cancelled; this ask must be auto-cancelled quietly.
        await turn.requestPermission({ toolCallId: "call-2", title: "Second ask" }, permissionOptions)
        return { stopReason: "cancelled" }
      },
    })
    await harness.adapter.send(promptInput())
    await harness.waitFor((event) => event.event === "permissionAsked")
    await harness.adapter.send({ type: "cancel", sessionId: WANTA_SESSION_ID })
    await harness.waitFor((event) => event.event === "messageCompleted")
    const askedEvents = harness.events.filter((event) => event.event === "permissionAsked")
    expect(askedEvents).toHaveLength(1)
    expect(harness.fake.permissionResponses).toEqual([
      { outcome: { outcome: "cancelled" } },
      { outcome: { outcome: "cancelled" } },
    ])
    await expect(harness.adapter.getPendingPermissions(WANTA_SESSION_ID)).resolves.toEqual([])
  })

  test("odd wire orders: unknown tool ids, duplicate terminal updates, unknown session ids", async () => {
    const harness = await createHarness({
      prompt: async (turn) => {
        // Terminal update for a call that never had a tool_call announcement.
        await turn.sendUpdate({
          sessionUpdate: "tool_call_update",
          toolCallId: "ghost",
          status: "completed",
        } as SessionUpdate)
        // Duplicate terminal update for the same call: must be dropped.
        await turn.sendUpdate({
          sessionUpdate: "tool_call_update",
          toolCallId: "ghost",
          status: "completed",
        } as SessionUpdate)
        // Update for a session id the adapter has never seen.
        await turn.sendUpdateFor("acp-session-unknown", {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "lost update" },
        })
        await turn.sendUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "still alive" } })
        return { stopReason: "end_turn" }
      },
    })
    await harness.adapter.send(promptInput())
    await harness.waitFor((event) => event.event === "messageCompleted")
    // Exactly one terminal result for the unknown call id, no throw, and the
    // stream continued.
    const ghostResults = harness.events.filter(
      (event) => event.event === "toolCallResult" && event.data.callId === "ghost",
    )
    expect(ghostResults).toHaveLength(1)
    expect(harness.events.some((event) => event.event === "messageDelta" && event.data.delta === "still alive")).toBe(
      true,
    )
    // The unknown-session update produced nothing and leaked nowhere.
    expect(harness.events.some((event) => event.event === "messageDelta" && event.data.delta === "lost update")).toBe(
      false,
    )
    for (const event of harness.events) {
      expect((event.data as { sessionId?: string }).sessionId).toBe(WANTA_SESSION_ID)
    }
    const messages = await harness.adapter.getMessages(WANTA_SESSION_ID)
    const toolParts = messages.flatMap((message) => message.parts).filter((part) => part.kind === "tool")
    expect(toolParts.map((part) => part.callId)).toEqual(["ghost"])
    expect(toolParts.every((part) => part.status === "completed")).toBe(true)
  })

  test("KNOWN BUG: a duplicate tool_call announcement forks the call into a second forever-running transcript part", async () => {
    // translator.ts case "tool_call" (lines 228-239) unconditionally adopts a
    // FRESH snapshot for the toolCallId, and the case itself rotates
    // currentMessageId to undefined afterwards. A duplicate announcement of
    // the same call therefore mints a NEW assistant message id, emits a second
    // toolCallStarted under a different messageId, and reparents the snapshot.
    // The completion then lands only on the second copy: the transcript keeps
    // TWO tool parts for one callId, the first one stuck in "running" forever.
    // tool_call_update already reuses the existing snapshot; tool_call should
    // do the same instead of re-adopting.
    const harness = await createHarness({
      prompt: async (turn) => {
        await turn.sendUpdate({
          sessionUpdate: "tool_call",
          toolCallId: "dup",
          title: "Read file",
          kind: "read",
          status: "in_progress",
        })
        // Duplicate announcement of the SAME call before its completion.
        await turn.sendUpdate({
          sessionUpdate: "tool_call",
          toolCallId: "dup",
          title: "Read file",
          kind: "read",
          status: "in_progress",
        })
        await turn.sendUpdate({
          sessionUpdate: "tool_call_update",
          toolCallId: "dup",
          status: "completed",
        } as SessionUpdate)
        return { stopReason: "end_turn" }
      },
    })
    await harness.adapter.send(promptInput())
    await harness.waitFor((event) => event.event === "messageCompleted")
    const dupResults = harness.events.filter((event) => event.event === "toolCallResult" && event.data.callId === "dup")
    expect(dupResults).toHaveLength(1)
    const messages = await harness.adapter.getMessages(WANTA_SESSION_ID)
    const toolParts = messages.flatMap((message) => message.parts).filter((part) => part.kind === "tool")
    // Desired: one tool part, completed. Actual: two parts under two assistant
    // messages, the first stuck in status "running".
    expect(toolParts.map((part) => part.callId)).toEqual(["dup"])
    expect(toolParts.every((part) => part.status === "completed")).toBe(true)
  })

  test("a prompt with an already-aborted signal after earlier session events leaves no trace", async () => {
    const harness = await createHarness()
    await harness.adapter.send(promptInput("first"))
    await harness.waitFor((event) => event.event === "messageCompleted")
    const eventsBefore = harness.events.length
    const controller = new AbortController()
    controller.abort()
    await expect(
      harness.adapter.send(promptInput("aborted prompt"), { signal: controller.signal }),
    ).resolves.toBeUndefined()
    expect(harness.events).toHaveLength(eventsBefore)
    expect(harness.fake.promptRequests).toHaveLength(1)
    // The session still takes real prompts afterwards.
    await harness.adapter.send(promptInput("real again"))
    await vi.waitFor(() => expect(completedCount(harness.events)).toBe(2))
    expect(harness.fake.promptRequests).toHaveLength(2)
  })

  test("a signal aborting during session creation suppresses dispatch but keeps the created session", async () => {
    const gate = deferred<void>()
    const harness = await createHarness({
      newSession: () => gate.promise.then(() => ({ sessionId: "acp-session-slow" })),
    })
    const controller = new AbortController()
    const sendPromise = harness.adapter.send(promptInput("doomed"), { signal: controller.signal })
    await vi.waitFor(() => expect(harness.fake.newSessionRequests).toHaveLength(1))
    controller.abort()
    gate.resolve()
    await expect(sendPromise).resolves.toBeUndefined()
    // No user turn synthesized, nothing reached the wire.
    expect(harness.events).toHaveLength(0)
    expect(harness.fake.promptRequests).toHaveLength(0)
    // The ACP session created underneath is reused by the next real prompt.
    await harness.adapter.send(promptInput("for real"))
    await harness.waitFor((event) => event.event === "messageCompleted")
    expect(harness.fake.newSessionRequests).toHaveLength(1)
    expect(harness.fake.promptRequests).toHaveLength(1)
  })

  test("a session deleted while session/new is in flight is never registered or prompted", async () => {
    const gate = deferred<void>()
    const harness = await createHarness({
      newSession: () => gate.promise.then(() => ({ sessionId: "acp-session-deleted" })),
    })
    const sendPromise = harness.adapter.send(promptInput("delete me"))
    await vi.waitFor(() => expect(harness.fake.newSessionRequests).toHaveLength(1))

    harness.adapter.forgetSession(WANTA_SESSION_ID)
    gate.resolve()

    await expect(sendPromise).rejects.toThrow(/session was deleted while being created/u)
    expect(harness.fake.promptRequests).toHaveLength(0)
    expect(harness.fake.closedSessionIds).toEqual(["acp-session-deleted"])
    const sessions = (harness.adapter as unknown as { sessionsByWantaId: Map<string, unknown> }).sessionsByWantaId
    expect(sessions.has(WANTA_SESSION_ID)).toBe(false)
  })

  test("connection loss while session creation is in flight rejects the send and the next prompt reconnects", async () => {
    let newSessionCalls = 0
    const gate = deferred<void>()
    const harness = await createHarness({
      newSession: () => {
        newSessionCalls += 1
        if (newSessionCalls === 1) {
          return gate.promise.then(() => ({ sessionId: "acp-session-never" }))
        }
        return { sessionId: `acp-session-${newSessionCalls}` }
      },
    })
    const sendPromise = harness.adapter.send(promptInput())
    await vi.waitFor(() => expect(harness.fake.newSessionRequests).toHaveLength(1))
    harness.fake.fireExit(1)
    await expect(sendPromise).rejects.toThrow(/could not open a session/u)
    await harness.waitFor((event) => event.event === "agentError")
    // Recovery: fresh subprocess, fresh session.
    await harness.adapter.send(promptInput("recovered"))
    await harness.waitFor((event) => event.event === "messageCompleted")
    expect(harness.fake.connectCount()).toBe(2)
    expect(harness.fake.newSessionRequests).toHaveLength(2)
  })

  test("a new prompt after cancel but before the cancelled turn settles is rejected as in flight", async () => {
    // Documented backpressure: ACP considers the turn active until the agent
    // answers the prompt request, so an immediate resend is refused.
    const release = deferred<void>()
    let promptCalls = 0
    const harness = await createHarness({
      prompt: async (turn) => {
        promptCalls += 1
        if (promptCalls === 1) {
          await turn.cancelled
          await release.promise
          return { stopReason: "cancelled" }
        }
        return { stopReason: "end_turn" }
      },
    })
    await harness.adapter.send(promptInput())
    await harness.adapter.send({ type: "cancel", sessionId: WANTA_SESSION_ID })
    await vi.waitFor(() => expect(harness.fake.cancelledSessionIds).toHaveLength(1))
    await expect(harness.adapter.send(promptInput("too soon"))).rejects.toThrow(/already in flight/u)
    release.resolve()
    await harness.waitFor((event) => event.event === "messageCompleted")
    await harness.adapter.send(promptInput("after settle"))
    await vi.waitFor(() => expect(completedCount(harness.events)).toBe(2))
    expect(harness.fake.promptRequests).toHaveLength(2)
  })

  test("a prompt after stop() is rejected and never reaches the wire", async () => {
    const harness = await createHarness()
    await harness.adapter.stop()
    await expect(harness.adapter.send(promptInput("late"))).rejects.toThrow(/adapter is stopped/u)
    expect(harness.fake.newSessionRequests).toHaveLength(0)
    expect(harness.fake.promptRequests).toHaveLength(0)
  })
})
