import type { AcpTransport } from "../acp/adapter.ts"
import type { ExternalAgentRuntimeStatus } from "../external/probe.ts"
import type { AgentManager } from "../manager.ts"
import type { AgentEvent } from "./event.ts"
import type { AgentInput, AgentSendOptions, CancelAgentInput, PromptAgentInput } from "./input.ts"
import type { AgentKind, AgentProfile } from "./profile.ts"
import type { AnyMessage, RequestPermissionResponse, SessionUpdate, Stream } from "@agentclientprotocol/sdk"
import type {
  Options as ClaudeOptions,
  Query as ClaudeQuery,
  SDKMessage,
  SDKUserMessage,
  query as claudeQuery,
} from "@anthropic-ai/claude-agent-sdk"

import { agent as acpAgent, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { AcpAgentAdapter } from "../acp/adapter.ts"
import { ACP_AGENT_REGISTRY } from "../acp/registry.ts"
import { ClaudeCodeAgentAdapter } from "../claude/adapter.ts"
import { mintExternalSessionId } from "../external/session-id.ts"
import { OpencodeAgentAdapter } from "../opencode-adapter.ts"
import { BaseAgentAdapter } from "./adapter.ts"
import { agentEventIssues } from "./event.ts"
import { agentInputIssues } from "./input.ts"
import { AGENT_PROFILES } from "./profile.ts"

// Cross-adapter contract tests: every adapter must satisfy the same lifecycle
// invariants (event delivery, capability honesty, teardown sweep). New adapters
// join by adding a fixture to `adapterFixtures` — the suite itself never grows
// adapter-specific branches. Native emissions are asynchronous for external
// adapters, so assertions go through vi.waitFor.

interface AdapterContractHarness {
  adapter: BaseAgentAdapter
  sessionId: string
  /** Cause the adapter to surface assistant text (starting a turn if the agent needs one). */
  emitAssistantText: (text: string) => Promise<void>
  /** Cause a permissionAsked event; the request id is read from the emitted event. */
  emitPermissionAsked: () => Promise<void>
  /** Settle a pending permission the way this agent settles it (native event or contract input). */
  settlePermission: (requestId: string) => Promise<void>
  /** Cause a toolCallStarted without a terminal result; returns the ids used. */
  emitToolCallStarted: () => Promise<{ partId: string; callId: string }>
  /** Only for adapters whose profile declares question support. */
  emitQuestionAsked?: () => Promise<void>
  /** Text parts of the session transcript, for adapters serving history from their own recorder. */
  transcriptTexts?: () => Promise<string[]>
  effects: {
    promptCount: () => number
    cancelCount: () => number
    permissionSettledCount: () => number
    stopped: () => boolean
  }
  cleanup?: () => Promise<void>
}

const pendingCleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of pendingCleanups.splice(0)) {
    await cleanup()
  }
})

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25))
}

// ── OpenCode fixture: stub AgentManager + raw SSE injection ──

function createOpencodeHarness(): Promise<AdapterContractHarness> {
  let nativeListener:
    | ((event: { type: string; data?: Record<string, unknown>; properties?: Record<string, unknown> }) => void)
    | undefined
  const prompt = vi.fn(async () => undefined)
  const cancel = vi.fn(async () => undefined)
  const permissionReply = vi.fn(async () => undefined)
  const questionAnswer = vi.fn(async () => undefined)
  const questionReject = vi.fn(async () => undefined)
  let disposed = false
  let permissionSeq = 0
  const manager = {
    isReady: () => true,
    subscribe: (callback: typeof nativeListener) => {
      nativeListener = callback
      return () => {
        nativeListener = undefined
      }
    },
    promptStreaming: prompt,
    abort: cancel,
    answerPermission: permissionReply,
    answerQuestion: questionAnswer,
    rejectQuestion: questionReject,
    dispose: async () => {
      disposed = true
    },
  } as unknown as AgentManager
  const adapter = new OpencodeAgentAdapter(manager)
  const sessionId = "opencode-session-1"
  const harness: AdapterContractHarness = {
    adapter,
    sessionId,
    emitAssistantText: async (text) => {
      nativeListener?.({
        type: "message.part.updated",
        properties: {
          part: { id: "assistant-1-text", sessionID: sessionId, messageID: "assistant-1", type: "text", text },
        },
      })
    },
    emitPermissionAsked: async () => {
      permissionSeq += 1
      nativeListener?.({
        type: "permission.asked",
        properties: {
          id: `perm-${permissionSeq}`,
          sessionID: sessionId,
          action: "external_directory",
          resources: ["/tmp/example"],
        },
      })
    },
    settlePermission: async (requestId) => {
      nativeListener?.({
        type: "permission.replied",
        properties: { requestID: requestId, sessionID: sessionId, reply: "once" },
      })
    },
    emitToolCallStarted: async () => {
      nativeListener?.({
        type: "message.part.updated",
        properties: {
          part: {
            id: "tool-part-1",
            sessionID: sessionId,
            messageID: "assistant-1",
            type: "tool",
            callID: "call-1",
            tool: "bash",
            state: { status: "running", input: { command: "ls" } },
          },
        },
      })
      return { partId: "tool-part-1", callId: "call-1" }
    },
    emitQuestionAsked: async () => {
      nativeListener?.({
        type: "question.asked",
        properties: {
          id: "question-1",
          sessionID: sessionId,
          questions: [{ question: "Proceed?", header: "Proceed", options: [{ label: "Yes" }] }],
        },
      })
    },
    effects: {
      promptCount: () => prompt.mock.calls.length,
      cancelCount: () => cancel.mock.calls.length,
      permissionSettledCount: () => permissionReply.mock.calls.length,
      stopped: () => disposed,
    },
  }
  return Promise.resolve(harness)
}

// ── Claude Code fixture: fake SDK query fed by a push stream ──

interface FakeClaudeQuery {
  push: (message: SDKMessage) => void
  promptMessages: SDKUserMessage[]
  options: ClaudeOptions
  interrupt: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

async function createClaudeHarness(): Promise<AdapterContractHarness> {
  const scratchRootDir = await mkdtemp(path.join(os.tmpdir(), "wanta-contract-claude-"))
  const queries: FakeClaudeQuery[] = []
  const queryFn = ((params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: ClaudeOptions }) => {
    const buffered: SDKMessage[] = []
    const waiters: Array<(result: IteratorResult<SDKMessage>) => void> = []
    let ended = false
    const promptMessages: SDKUserMessage[] = []
    if (typeof params.prompt !== "string") {
      const stream = params.prompt
      void (async () => {
        for await (const message of stream) {
          promptMessages.push(message)
        }
      })()
    }
    const fake: FakeClaudeQuery = {
      push: (message) => {
        const waiter = waiters.shift()
        if (waiter) {
          waiter({ value: message, done: false })
          return
        }
        buffered.push(message)
      },
      promptMessages,
      options: params.options ?? {},
      interrupt: vi.fn(() => Promise.resolve(undefined)),
      close: vi.fn(() => {
        ended = true
        for (const waiter of waiters.splice(0)) {
          waiter({ value: undefined, done: true })
        }
      }),
    }
    queries.push(fake)
    const next = (): Promise<IteratorResult<SDKMessage>> => {
      if (buffered.length > 0) {
        return Promise.resolve({ value: buffered.shift() as SDKMessage, done: false })
      }
      if (ended) {
        return Promise.resolve({ value: undefined, done: true })
      }
      return new Promise((resolve) => {
        waiters.push(resolve)
      })
    }
    return {
      [Symbol.asyncIterator]: () => ({ next }),
      interrupt: fake.interrupt,
      setPermissionMode: vi.fn(() => Promise.resolve()),
      close: fake.close,
    } as unknown as ClaudeQuery
  }) as unknown as typeof claudeQuery
  const status: ExternalAgentRuntimeStatus = {
    kind: "claude-code",
    displayName: "Claude Code",
    binary: { status: "detected", path: "/fake/claude", version: "2.1.226" },
    login: { status: "logged_in" },
    loginHint: "Run `claude` in a terminal and sign in, then retry.",
  }
  const adapter = new ClaudeCodeAgentAdapter({
    probe: () => Promise.resolve(status),
    scratchRootDir,
    commandPath: () => Promise.resolve("/fake/bin"),
    queryFn,
  })
  const sessionId = mintExternalSessionId("claude-code")
  let permissionSeq = 0
  let permissionSettled = 0
  let assistantSeq = 0
  const ensureTurn = async (): Promise<FakeClaudeQuery> => {
    if (queries.length === 0) {
      await adapter.send({ type: "prompt", sessionId, text: "start turn" })
    }
    const fake = queries[0]
    if (!fake) {
      throw new Error("fake query missing")
    }
    return fake
  }
  return {
    adapter,
    sessionId,
    emitAssistantText: async (text) => {
      // Real SDK wire shape (0.3.226): stream partials first, then one complete
      // assistant message PER content block, all sharing the API message id.
      const fake = await ensureTurn()
      assistantSeq += 1
      const messageId = `api-msg-${assistantSeq}`
      const push = (message: unknown): void => {
        fake.push(message as SDKMessage)
      }
      const stream = (event: unknown): unknown => ({
        type: "stream_event",
        event,
        parent_tool_use_id: null,
        uuid: `stream-uuid-${assistantSeq}`,
        session_id: "sdk-session",
      })
      const complete = (content: unknown[]): unknown => ({
        type: "assistant",
        message: { id: messageId, content },
        parent_tool_use_id: null,
        uuid: `assistant-uuid-${assistantSeq}`,
        session_id: "sdk-session",
      })
      push(stream({ type: "message_start", message: { id: messageId } }))
      push(
        stream({
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "", signature: "" },
        }),
      )
      push(
        stream({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "considering" } }),
      )
      push(complete([{ type: "thinking", thinking: "considering", signature: "" }]))
      push(stream({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }))
      push(stream({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text } }))
      push(complete([{ type: "text", text }]))
    },
    emitPermissionAsked: async () => {
      const fake = await ensureTurn()
      permissionSeq += 1
      const decision = fake.options.canUseTool?.("Bash", { command: "ls" }, {
        signal: new AbortController().signal,
        toolUseID: `tool-use-${permissionSeq}`,
        requestId: `claude-perm-${permissionSeq}`,
        suggestions: [],
      } as never)
      void decision?.then(() => {
        permissionSettled += 1
      })
    },
    settlePermission: async (requestId) => {
      await adapter.send({ type: "permission-response", sessionId, requestId, reply: "once" })
    },
    emitToolCallStarted: async () => {
      const fake = await ensureTurn()
      fake.push({
        type: "assistant",
        message: { id: "api-msg-2", content: [{ type: "tool_use", id: "claude-call-1", name: "Bash", input: {} }] },
        parent_tool_use_id: null,
        uuid: "assistant-uuid-2",
        session_id: "sdk-session",
      } as unknown as SDKMessage)
      return { partId: "claude-call-1", callId: "claude-call-1" }
    },
    transcriptTexts: async () => {
      const messages = await adapter.getMessages(sessionId)
      return messages.flatMap((message) =>
        message.parts.filter((part) => part.kind === "text").map((part) => part.text ?? ""),
      )
    },
    effects: {
      promptCount: () => queries.reduce((total, fake) => total + fake.promptMessages.length, 0),
      cancelCount: () => queries.reduce((total, fake) => total + fake.interrupt.mock.calls.length, 0),
      permissionSettledCount: () => permissionSettled,
      stopped: () => queries.length > 0 && queries.every((fake) => fake.close.mock.calls.length > 0),
    },
    cleanup: async () => {
      await rm(scratchRootDir, { recursive: true, force: true }).catch(() => undefined)
    },
  }
}

// ── ACP fixture: in-process fake agent over cross-wired streams ──

async function createAcpHarness(): Promise<AdapterContractHarness> {
  const scratchRootDir = await mkdtemp(path.join(os.tmpdir(), "wanta-contract-acp-"))
  let promptCount = 0
  let cancelCount = 0
  let disposed = false
  const permissionResponses: RequestPermissionResponse[] = []
  let bridge:
    | {
        sendUpdate: (update: SessionUpdate) => Promise<void>
        requestPermission: (toolCallId: string) => void
      }
    | undefined
  let bridgeReady: (() => void) | undefined
  const cancelResolvers: Array<() => void> = []
  const app = acpAgent({ name: "contract-fake-acp" })
    .onRequest("initialize", () => ({ protocolVersion: PROTOCOL_VERSION }))
    .onRequest("session/new", () => ({ sessionId: "acp-session-1" }))
    .onRequest("session/set_mode", () => ({}))
    .onRequest("session/prompt", ({ params, client }) => {
      promptCount += 1
      bridge = {
        sendUpdate: async (update) => {
          await client.notify("session/update", { sessionId: params.sessionId, update })
        },
        requestPermission: (toolCallId) => {
          void client
            .request("session/request_permission", {
              sessionId: params.sessionId,
              toolCall: { toolCallId, title: "Run command" },
              options: [
                { optionId: "allow-once", name: "Allow", kind: "allow_once" },
                { optionId: "reject-once", name: "Reject", kind: "reject_once" },
              ],
            })
            .then((response) => {
              permissionResponses.push(response)
            })
            .catch(() => undefined)
        },
      }
      bridgeReady?.()
      return new Promise((resolve) => {
        cancelResolvers.push(() => {
          cancelCount += 1
          resolve({ stopReason: "cancelled" })
        })
      })
    })
    .onNotification("session/cancel", () => {
      for (const resolve of cancelResolvers.splice(0)) {
        resolve()
      }
    })
  const connect = async (): Promise<AcpTransport> => {
    const clientToAgent = new TransformStream<AnyMessage, AnyMessage>()
    const agentToClient = new TransformStream<AnyMessage, AnyMessage>()
    const agentSide: Stream = { writable: agentToClient.writable, readable: clientToAgent.readable }
    const clientSide: Stream = { writable: clientToAgent.writable, readable: agentToClient.readable }
    const connection = app.connect(agentSide)
    return {
      stream: clientSide,
      dispose: () => {
        disposed = true
        connection.close()
      },
    }
  }
  const adapter = new AcpAgentAdapter({
    kind: "codex",
    registration: ACP_AGENT_REGISTRY["codex"],
    probe: () =>
      Promise.resolve({
        kind: "codex",
        displayName: "Gemini CLI",
        binary: { status: "detected", path: "/fake/codex-acp", version: "1.1.14" },
        login: { status: "logged_in" },
        loginHint: ACP_AGENT_REGISTRY["codex"].loginHint,
      } satisfies ExternalAgentRuntimeStatus),
    scratchRootDir,
    connect,
  })
  const sessionId = mintExternalSessionId("codex")
  let permissionSeq = 0
  const ensureTurn = async (): Promise<NonNullable<typeof bridge>> => {
    if (!bridge) {
      const ready = new Promise<void>((resolve) => {
        bridgeReady = resolve
      })
      await adapter.send({ type: "prompt", sessionId, text: "start turn" })
      await ready
    }
    if (!bridge) {
      throw new Error("acp bridge missing")
    }
    return bridge
  }
  return {
    adapter,
    sessionId,
    emitAssistantText: async (text) => {
      const activeBridge = await ensureTurn()
      await activeBridge.sendUpdate({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      } as SessionUpdate)
    },
    emitPermissionAsked: async () => {
      const activeBridge = await ensureTurn()
      permissionSeq += 1
      activeBridge.requestPermission(`acp-tool-${permissionSeq}`)
    },
    settlePermission: async (requestId) => {
      await adapter.send({ type: "permission-response", sessionId, requestId, reply: "once" })
    },
    emitToolCallStarted: async () => {
      const activeBridge = await ensureTurn()
      await activeBridge.sendUpdate({
        sessionUpdate: "tool_call",
        toolCallId: "acp-call-1",
        title: "Run command",
        status: "in_progress",
      } as SessionUpdate)
      return { partId: "acp-call-1", callId: "acp-call-1" }
    },
    transcriptTexts: async () => {
      const messages = await adapter.getMessages(sessionId)
      return messages.flatMap((message) =>
        message.parts.filter((part) => part.kind === "text").map((part) => part.text ?? ""),
      )
    },
    effects: {
      promptCount: () => promptCount,
      cancelCount: () => cancelCount,
      permissionSettledCount: () => permissionResponses.length,
      stopped: () => disposed,
    },
    cleanup: async () => {
      await rm(scratchRootDir, { recursive: true, force: true }).catch(() => undefined)
    },
  }
}

const adapterFixtures: Array<{ kind: AgentKind; create: () => Promise<AdapterContractHarness> }> = [
  { kind: "opencode", create: createOpencodeHarness },
  { kind: "claude-code", create: createClaudeHarness },
  { kind: "codex", create: createAcpHarness },
]

async function startHarness(create: () => Promise<AdapterContractHarness>): Promise<{
  harness: AdapterContractHarness
  events: AgentEvent[]
}> {
  const harness = await create()
  pendingCleanups.push(async () => {
    await harness.adapter.stop().catch(() => undefined)
    await harness.cleanup?.()
  })
  const events: AgentEvent[] = []
  harness.adapter.onEvent((event) => {
    events.push(event)
  })
  await harness.adapter.start()
  return { harness, events }
}

function eventsOf<K extends AgentEvent["event"]>(
  events: AgentEvent[],
  kind: K,
): Array<Extract<AgentEvent, { event: K }>> {
  return events.filter((event): event is Extract<AgentEvent, { event: K }> => event.event === kind)
}

async function observedPermissionRequestId(events: AgentEvent[]): Promise<string> {
  await vi.waitFor(() => {
    expect(eventsOf(events, "permissionAsked").length).toBeGreaterThan(0)
  })
  const asked = eventsOf(events, "permissionAsked").at(-1)
  if (!asked) {
    throw new Error("permissionAsked missing")
  }
  return asked.data.request.id
}

describe.each(adapterFixtures)("agent adapter contract: $kind", ({ kind, create }) => {
  test("profile declaration matches the handled input surface", async () => {
    const { harness } = await startHarness(create)
    const profile = AGENT_PROFILES[kind]
    expect(harness.adapter.kind).toBe(kind)
    expect(harness.adapter.profile).toBe(profile)
    expect(harness.adapter.supportsInput("prompt")).toBe(true)
    expect(harness.adapter.supportsInput("cancel")).toBe(true)
    expect(harness.adapter.supportsInput("permission-response")).toBe(profile.inputs.permissionResponse)
    expect(harness.adapter.supportsInput("question-response")).toBe(profile.inputs.questionResponse)
    expect(harness.adapter.supportsInput("set-model")).toBe(profile.inputs.setModel)
    expect(harness.adapter.supportsInput("set-effort")).toBe(profile.inputs.setEffort)
    expect(profile.permissionModes.length).toBeGreaterThan(0)
  })

  test("onEvent delivers schema-valid translated events", async () => {
    const { harness, events } = await startHarness(create)
    await harness.emitAssistantText("hello")
    await vi.waitFor(() => {
      expect(eventsOf(events, "messageDelta").some((event) => event.data.text.includes("hello"))).toBe(true)
    })
    for (const event of events) {
      expect(agentEventIssues(event)).toBeNull()
    }
  })

  test("start is idempotent: a second start must not duplicate delivery", async () => {
    const { harness, events } = await startHarness(create)
    const deltasWith = (needle: string): number =>
      eventsOf(events, "messageDelta").filter((event) => event.data.text.includes(needle)).length
    await harness.emitAssistantText("baseline")
    await vi.waitFor(() => {
      expect(deltasWith("baseline")).toBeGreaterThan(0)
    })
    await settle()
    const baseline = deltasWith("baseline")
    await harness.adapter.start()
    await harness.emitAssistantText("repeated")
    await vi.waitFor(() => {
      expect(deltasWith("repeated")).toBeGreaterThan(0)
    })
    await settle()
    // Emission shape is identical before and after the second start(): any
    // duplicated subscription would double the per-text delivery count.
    expect(deltasWith("repeated")).toBe(baseline)
  })

  test("assistant text lands in the transcript exactly once", async () => {
    const { harness } = await startHarness(create)
    if (!harness.transcriptTexts) {
      // Kernel-backed adapters serve history from their own server, not from
      // contract events; transcript uniqueness only applies to recorders.
      return
    }
    const transcriptTexts = harness.transcriptTexts
    await harness.emitAssistantText("transcript-once")
    await vi.waitFor(async () => {
      const texts = await transcriptTexts()
      expect(texts.some((text) => text.includes("transcript-once"))).toBe(true)
    })
    await settle()
    const texts = await transcriptTexts()
    expect(texts.filter((text) => text.includes("transcript-once"))).toHaveLength(1)
  })

  test("unsubscribe stops delivery for that listener only", async () => {
    const { harness } = await startHarness(create)
    const first: AgentEvent[] = []
    const second: AgentEvent[] = []
    const unsubscribe = harness.adapter.onEvent((event) => first.push(event))
    harness.adapter.onEvent((event) => second.push(event))
    unsubscribe()
    await harness.emitAssistantText("text")
    await vi.waitFor(() => {
      expect(second.length).toBeGreaterThan(0)
    })
    expect(first).toHaveLength(0)
  })

  test("prompt and cancel inputs reach the underlying agent", async () => {
    const { harness } = await startHarness(create)
    await harness.adapter.send({ type: "prompt", sessionId: harness.sessionId, text: "do the thing" })
    await vi.waitFor(() => {
      expect(harness.effects.promptCount()).toBeGreaterThan(0)
    })
    await harness.adapter.send({ type: "cancel", sessionId: harness.sessionId })
    await vi.waitFor(() => {
      expect(harness.effects.cancelCount()).toBeGreaterThan(0)
    })
  })

  test("permission responses honor the declared capability", async () => {
    const { harness, events } = await startHarness(create)
    const declared = AGENT_PROFILES[kind].inputs.permissionResponse
    if (!declared) {
      await expect(
        harness.adapter.send({
          type: "permission-response",
          sessionId: harness.sessionId,
          requestId: "missing",
          reply: "once",
        }),
      ).rejects.toThrow(`${kind}: permission-response is not supported`)
      return
    }
    await harness.emitPermissionAsked()
    const requestId = await observedPermissionRequestId(events)
    await harness.adapter.send({
      type: "permission-response",
      sessionId: harness.sessionId,
      requestId,
      reply: "once",
    })
    await vi.waitFor(() => {
      expect(harness.effects.permissionSettledCount()).toBeGreaterThan(0)
    })
  })

  test("question responses honor the declared capability", async () => {
    const { harness } = await startHarness(create)
    const declared = AGENT_PROFILES[kind].inputs.questionResponse
    const rejected: AgentInput = {
      type: "question-response",
      sessionId: harness.sessionId,
      requestId: "question-x",
      outcome: { kind: "rejected" },
    }
    if (!declared) {
      await expect(harness.adapter.send(rejected)).rejects.toThrow(`${kind}: question-response is not supported`)
      return
    }
    // Supported adapters must accept the input without the named rejection.
    await harness.adapter.send(rejected)
  })

  test("malformed inputs are rejected before reaching the agent", async () => {
    const { harness } = await startHarness(create)
    await expect(harness.adapter.send({ type: "prompt", sessionId: "", text: "missing session" })).rejects.toThrow(
      /invalid agent input/,
    )
    await expect(harness.adapter.send({ type: "nonsense" } as unknown as AgentInput)).rejects.toThrow(
      /invalid agent input/,
    )
    expect(harness.effects.promptCount()).toBe(0)
  })

  test("stop sweeps pending interactions so nothing observable is left hanging", async () => {
    const { harness, events } = await startHarness(create)
    await harness.emitPermissionAsked()
    const requestId = await observedPermissionRequestId(events)
    const tool = await harness.emitToolCallStarted()
    if (harness.emitQuestionAsked) {
      await harness.emitQuestionAsked()
      await vi.waitFor(() => {
        expect(eventsOf(events, "questionAsked").length).toBeGreaterThan(0)
      })
    }
    await vi.waitFor(() => {
      expect(eventsOf(events, "toolCallStarted").some((event) => event.data.partId === tool.partId)).toBe(true)
    })
    await harness.adapter.stop()
    await vi.waitFor(() => {
      expect(eventsOf(events, "permissionReplied").some((event) => event.data.requestId === requestId)).toBe(true)
      expect(
        eventsOf(events, "toolCallResult").some(
          (event) => event.data.partId === tool.partId && event.data.status === "error",
        ),
      ).toBe(true)
    })
    if (harness.emitQuestionAsked) {
      expect(eventsOf(events, "questionRejected").length).toBeGreaterThan(0)
    }
    expect(harness.effects.stopped()).toBe(true)
  })

  test("interactions already settled are not re-resolved at stop", async () => {
    const { harness, events } = await startHarness(create)
    await harness.emitPermissionAsked()
    const requestId = await observedPermissionRequestId(events)
    await harness.settlePermission(requestId)
    await vi.waitFor(() => {
      expect(eventsOf(events, "permissionReplied").filter((event) => event.data.requestId === requestId).length).toBe(1)
    })
    await harness.adapter.stop()
    await settle()
    expect(eventsOf(events, "permissionReplied").filter((event) => event.data.requestId === requestId).length).toBe(1)
  })

  test("stop is idempotent and terminal", async () => {
    const { harness, events } = await startHarness(create)
    await harness.emitAssistantText("before stop")
    await vi.waitFor(() => {
      expect(eventsOf(events, "messageDelta").length).toBeGreaterThan(0)
    })
    await harness.adapter.stop()
    const settledCount = events.length
    await harness.adapter.stop()
    expect(events).toHaveLength(settledCount)
    await harness.emitAssistantText("late").catch(() => undefined)
    await settle()
    expect(events).toHaveLength(settledCount)
    await expect(harness.adapter.start()).rejects.toThrow(`${kind}: adapter cannot restart after stop`)
  })
})

// A minimal adapter proves the base defaults: optional capabilities reject
// loudly with a named error and are reported as unsupported.

class MinimalAdapter extends BaseAgentAdapter {
  public readonly kind = "opencode" as AgentKind
  public readonly profile: AgentProfile = {
    ...AGENT_PROFILES.opencode,
    inputs: { ...AGENT_PROFILES.opencode.inputs, permissionResponse: false, questionResponse: false },
  }

  protected async handleStart(): Promise<void> {}
  protected async handleStop(): Promise<void> {}
  protected async handlePrompt(_input: PromptAgentInput, _options?: AgentSendOptions): Promise<void> {}
  protected async handleCancel(_input: CancelAgentInput, _options?: AgentSendOptions): Promise<void> {}
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

class LifecycleAdapter extends MinimalAdapter {
  public startCalls = 0
  public stopCalls = 0
  public emitToolDuringStop = false
  private readonly startGate: Promise<void> | undefined

  public constructor(startGate?: Promise<void>) {
    super()
    this.startGate = startGate
  }

  protected override async handleStart(): Promise<void> {
    this.startCalls += 1
    await this.startGate
  }

  protected override async handleStop(): Promise<void> {
    this.stopCalls += 1
    if (this.emitToolDuringStop) {
      this.emit({
        event: "toolCallStarted",
        data: {
          sessionId: "s",
          messageId: "m",
          partId: "p",
          callId: "c",
          tool: "bash",
          status: "running",
          input: {},
        },
      })
    }
  }
}

describe("BaseAgentAdapter defaults", () => {
  test("optional capabilities default to a named rejection and honest supportsInput", async () => {
    const adapter = new MinimalAdapter()
    await adapter.start()
    expect(adapter.supportsInput("permission-response")).toBe(false)
    expect(adapter.supportsInput("question-response")).toBe(false)
    expect(adapter.supportsInput("set-model")).toBe(false)
    expect(adapter.supportsInput("set-effort")).toBe(false)
    await expect(adapter.send({ type: "set-model", sessionId: "s", modelId: "m" })).rejects.toThrow(
      "opencode: set-model is not supported",
    )
    await expect(adapter.send({ type: "set-effort", sessionId: "s", effortId: "e" })).rejects.toThrow(
      "opencode: set-effort is not supported",
    )
    await expect(
      adapter.send({ type: "permission-response", sessionId: "s", requestId: "r", reply: "once" }),
    ).rejects.toThrow("opencode: permission-response is not supported")
    await expect(
      adapter.send({ type: "question-response", sessionId: "s", requestId: "r", outcome: { kind: "rejected" } }),
    ).rejects.toThrow("opencode: question-response is not supported")
  })

  test("concurrent start calls share one initialization and stop cannot be overwritten by a late start", async () => {
    const gate = deferred()
    const adapter = new LifecycleAdapter(gate.promise)
    const firstStart = adapter.start()
    const secondStart = adapter.start()
    expect(adapter.startCalls).toBe(1)
    const stop = adapter.stop()
    gate.resolve()

    await Promise.all([firstStart, secondStart, stop])
    expect(adapter.startCalls).toBe(1)
    expect(adapter.stopCalls).toBe(1)
    await expect(adapter.start()).rejects.toThrow("opencode: adapter cannot restart after stop")
  })

  test("stop performs a final sweep for interactions emitted during native shutdown", async () => {
    const adapter = new LifecycleAdapter()
    adapter.emitToolDuringStop = true
    const events: AgentEvent[] = []
    adapter.onEvent((event) => events.push(event))
    await adapter.start()
    await adapter.stop()

    expect(events.filter((event) => event.event === "toolCallStarted")).toHaveLength(1)
    expect(events.filter((event) => event.event === "toolCallResult")).toHaveLength(1)
  })
})

describe("contract schemas", () => {
  test("representative events pass validation", () => {
    const samples: AgentEvent[] = [
      {
        event: "messageStarted",
        data: { sessionId: "s", messageId: "m", role: "assistant", finishReason: "stop", completedAt: 3 },
      },
      { event: "messageDelta", data: { sessionId: "s", messageId: "m", partId: "p", text: "hi", delta: "hi" } },
      {
        event: "toolCallResult",
        data: {
          sessionId: "s",
          messageId: "m",
          partId: "p",
          callId: "c",
          tool: "bash",
          status: "completed",
          input: { command: "ls" },
          output: "ok",
          metadata: { anything: { nested: true } },
          timing: { start: 1, end: 2 },
          authorization: { service: "svc", displayName: "Svc", authUrl: "https://example.com" },
        },
      },
      {
        event: "permissionAsked",
        data: {
          sessionId: "s",
          request: {
            id: "r",
            sessionId: "s",
            action: "external_directory",
            resources: ["/tmp"],
            wanta: { promptReason: "broad_resource" },
          },
        },
      },
      {
        event: "connectionStatus",
        data: { status: "reconnecting", attempt: 1, maxAttempts: 5, message: "network glitch" },
      },
    ]
    for (const sample of samples) {
      expect(agentEventIssues(sample)).toBeNull()
    }
  })

  test("malformed events and inputs are reported", () => {
    expect(agentEventIssues({ event: "messageDelta", data: { sessionId: "s" } } as unknown as AgentEvent)).toMatch(
      /messageId|partId|text/,
    )
    expect(agentEventIssues({ event: "bogus", data: {} } as unknown as AgentEvent)).not.toBeNull()
    expect(agentInputIssues({ type: "cancel", sessionId: "" } as AgentInput)).not.toBeNull()
    expect(
      agentInputIssues({
        type: "prompt",
        sessionId: "s",
        text: "t",
        model: { kind: "weird", id: 1 },
      } as unknown as AgentInput),
    ).not.toBeNull()
  })
})
