import type { AgentManager } from "../manager.ts"
import type { AgentEvent } from "./event.ts"
import type { AgentInput, AgentSendOptions, CancelAgentInput, PromptAgentInput } from "./input.ts"
import type { AgentKind, AgentProfile } from "./profile.ts"

import { describe, expect, test, vi } from "vitest"
import { OpencodeAgentAdapter } from "../opencode-adapter.ts"
import { BaseAgentAdapter } from "./adapter.ts"
import { agentEventIssues } from "./event.ts"
import { agentInputIssues } from "./input.ts"
import { AGENT_PROFILES } from "./profile.ts"

// Cross-adapter contract tests: every adapter must satisfy the same lifecycle
// invariants (event delivery, capability honesty, teardown sweep). New adapters
// join by adding a fixture to `adapterFixtures` — the suite itself never grows
// adapter-specific branches.

interface AdapterContractHarness {
  adapter: BaseAgentAdapter
  /** Push a native (agent-specific) event that must surface as a contract event. */
  emitNativeAssistantText: (sessionId: string, messageId: string, text: string) => void
  emitNativePermissionAsked: (sessionId: string, requestId: string) => void
  emitNativePermissionReplied: (sessionId: string, requestId: string) => void
  emitNativeQuestionAsked: (sessionId: string, requestId: string) => void
  emitNativeToolCallStarted: (sessionId: string, partId: string, callId: string) => void
  effects: {
    prompt: ReturnType<typeof vi.fn>
    cancel: ReturnType<typeof vi.fn>
    permissionReply: ReturnType<typeof vi.fn>
    questionAnswer: ReturnType<typeof vi.fn>
    questionReject: ReturnType<typeof vi.fn>
    disposed: () => boolean
  }
}

function createOpencodeHarness(): AdapterContractHarness {
  let nativeListener:
    | ((event: { type: string; data?: Record<string, unknown>; properties?: Record<string, unknown> }) => void)
    | undefined
  const prompt = vi.fn(async () => undefined)
  const cancel = vi.fn(async () => undefined)
  const permissionReply = vi.fn(async () => undefined)
  const questionAnswer = vi.fn(async () => undefined)
  const questionReject = vi.fn(async () => undefined)
  let disposed = false
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
  return {
    adapter: new OpencodeAgentAdapter(manager),
    emitNativeAssistantText: (sessionId, messageId, text) => {
      nativeListener?.({
        type: "message.part.updated",
        properties: {
          part: { id: `${messageId}-text`, sessionID: sessionId, messageID: messageId, type: "text", text },
        },
      })
    },
    emitNativePermissionAsked: (sessionId, requestId) => {
      nativeListener?.({
        type: "permission.asked",
        properties: { id: requestId, sessionID: sessionId, action: "external_directory", resources: ["/tmp/example"] },
      })
    },
    emitNativePermissionReplied: (sessionId, requestId) => {
      nativeListener?.({
        type: "permission.replied",
        properties: { requestID: requestId, sessionID: sessionId, reply: "once" },
      })
    },
    emitNativeQuestionAsked: (sessionId, requestId) => {
      nativeListener?.({
        type: "question.asked",
        properties: {
          id: requestId,
          sessionID: sessionId,
          questions: [{ question: "Proceed?", header: "Proceed", options: [{ label: "Yes" }] }],
        },
      })
    },
    emitNativeToolCallStarted: (sessionId, partId, callId) => {
      nativeListener?.({
        type: "message.part.updated",
        properties: {
          part: {
            id: partId,
            sessionID: sessionId,
            messageID: "assistant-1",
            type: "tool",
            callID: callId,
            tool: "bash",
            state: { status: "running", input: { command: "ls" } },
          },
        },
      })
    },
    effects: {
      prompt,
      cancel,
      permissionReply,
      questionAnswer,
      questionReject,
      disposed: () => disposed,
    },
  }
}

const adapterFixtures: Array<{ kind: AgentKind; create: () => AdapterContractHarness }> = [
  { kind: "opencode", create: createOpencodeHarness },
]

function collectEvents(harness: AdapterContractHarness): AgentEvent[] {
  const events: AgentEvent[] = []
  harness.adapter.onEvent((event) => {
    events.push(event)
  })
  return events
}

describe.each(adapterFixtures)("agent adapter contract: $kind", ({ kind, create }) => {
  test("profile declaration matches the handled input surface", () => {
    const harness = create()
    const profile = AGENT_PROFILES[kind]
    expect(harness.adapter.kind).toBe(kind)
    expect(harness.adapter.profile).toBe(profile)
    expect(harness.adapter.supportsInput("prompt")).toBe(true)
    expect(harness.adapter.supportsInput("cancel")).toBe(true)
    expect(harness.adapter.supportsInput("permission-response")).toBe(profile.inputs.permissionResponse)
    expect(harness.adapter.supportsInput("question-response")).toBe(profile.inputs.questionResponse)
  })

  test("start attaches the native stream and onEvent delivers translated events", async () => {
    const harness = create()
    const events = collectEvents(harness)
    await harness.adapter.start()
    harness.emitNativeAssistantText("session-1", "assistant-1", "hello")
    expect(events).toEqual([
      expect.objectContaining({ event: "messageDelta", data: expect.objectContaining({ text: "hello" }) }),
    ])
    for (const event of events) {
      expect(agentEventIssues(event)).toBeNull()
    }
  })

  test("start is idempotent: a second start must not duplicate event delivery", async () => {
    const harness = create()
    const events = collectEvents(harness)
    await harness.adapter.start()
    await harness.adapter.start()
    harness.emitNativeAssistantText("session-1", "assistant-1", "once")
    expect(events).toHaveLength(1)
  })

  test("unsubscribe stops delivery for that listener only", async () => {
    const harness = create()
    await harness.adapter.start()
    const first: AgentEvent[] = []
    const second: AgentEvent[] = []
    const unsubscribe = harness.adapter.onEvent((event) => first.push(event))
    harness.adapter.onEvent((event) => second.push(event))
    unsubscribe()
    harness.emitNativeAssistantText("session-1", "assistant-1", "text")
    expect(first).toHaveLength(0)
    expect(second).toHaveLength(1)
  })

  test("prompt and cancel inputs reach the underlying agent", async () => {
    const harness = create()
    await harness.adapter.start()
    await harness.adapter.send({ type: "prompt", sessionId: "session-1", text: "do the thing" })
    expect(harness.effects.prompt).toHaveBeenCalledTimes(1)
    await harness.adapter.send({ type: "cancel", sessionId: "session-1" })
    expect(harness.effects.cancel).toHaveBeenCalledTimes(1)
  })

  test("permission responses honor the declared capability", async () => {
    const harness = create()
    await harness.adapter.start()
    const input: AgentInput = {
      type: "permission-response",
      sessionId: "session-1",
      requestId: "perm-1",
      reply: "once",
    }
    if (AGENT_PROFILES[kind].inputs.permissionResponse) {
      await harness.adapter.send(input)
      expect(harness.effects.permissionReply).toHaveBeenCalledTimes(1)
    } else {
      await expect(harness.adapter.send(input)).rejects.toThrow(`${kind}: permission-response is not supported`)
      expect(harness.effects.permissionReply).toHaveBeenCalledTimes(0)
    }
  })

  test("question responses honor the declared capability", async () => {
    const harness = create()
    await harness.adapter.start()
    const answered: AgentInput = {
      type: "question-response",
      sessionId: "session-1",
      requestId: "question-1",
      outcome: { kind: "answered", answers: [["Yes"]] },
    }
    const rejected: AgentInput = {
      type: "question-response",
      sessionId: "session-1",
      requestId: "question-2",
      outcome: { kind: "rejected" },
    }
    if (AGENT_PROFILES[kind].inputs.questionResponse) {
      await harness.adapter.send(answered)
      expect(harness.effects.questionAnswer).toHaveBeenCalledTimes(1)
      await harness.adapter.send(rejected)
      expect(harness.effects.questionReject).toHaveBeenCalledTimes(1)
    } else {
      await expect(harness.adapter.send(answered)).rejects.toThrow(`${kind}: question-response is not supported`)
    }
  })

  test("malformed inputs are rejected before reaching the agent", async () => {
    const harness = create()
    await harness.adapter.start()
    await expect(harness.adapter.send({ type: "prompt", sessionId: "", text: "missing session" })).rejects.toThrow(
      /invalid agent input/,
    )
    await expect(harness.adapter.send({ type: "nonsense" } as unknown as AgentInput)).rejects.toThrow(
      /invalid agent input/,
    )
    expect(harness.effects.prompt).toHaveBeenCalledTimes(0)
  })

  test("stop sweeps pending interactions so nothing observable is left hanging", async () => {
    const harness = create()
    const events = collectEvents(harness)
    await harness.adapter.start()
    harness.emitNativePermissionAsked("session-1", "perm-1")
    harness.emitNativeQuestionAsked("session-1", "question-1")
    harness.emitNativeToolCallStarted("session-1", "part-1", "call-1")
    await harness.adapter.stop()
    expect(events).toContainEqual({
      event: "permissionReplied",
      data: { sessionId: "session-1", requestId: "perm-1" },
    })
    expect(events).toContainEqual({
      event: "questionRejected",
      data: { sessionId: "session-1", requestId: "question-1" },
    })
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "toolCallResult",
        data: expect.objectContaining({ partId: "part-1", callId: "call-1", status: "error" }),
      }),
    )
    expect(harness.effects.disposed()).toBe(true)
  })

  test("interactions already settled through the agent are not re-resolved at stop", async () => {
    const harness = create()
    const events = collectEvents(harness)
    await harness.adapter.start()
    harness.emitNativePermissionAsked("session-1", "perm-1")
    harness.emitNativePermissionReplied("session-1", "perm-1")
    await harness.adapter.stop()
    const replies = events.filter((event) => event.event === "permissionReplied")
    expect(replies).toHaveLength(1)
  })

  test("stop is idempotent and terminal", async () => {
    const harness = create()
    const events = collectEvents(harness)
    await harness.adapter.start()
    harness.emitNativePermissionAsked("session-1", "perm-1")
    await harness.adapter.stop()
    const settledCount = events.length
    await harness.adapter.stop()
    expect(events).toHaveLength(settledCount)
    harness.emitNativeAssistantText("session-1", "assistant-1", "late")
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

describe("BaseAgentAdapter defaults", () => {
  test("optional capabilities default to a named rejection and honest supportsInput", async () => {
    const adapter = new MinimalAdapter()
    await adapter.start()
    expect(adapter.supportsInput("permission-response")).toBe(false)
    expect(adapter.supportsInput("question-response")).toBe(false)
    await expect(
      adapter.send({ type: "permission-response", sessionId: "s", requestId: "r", reply: "once" }),
    ).rejects.toThrow("opencode: permission-response is not supported")
    await expect(
      adapter.send({ type: "question-response", sessionId: "s", requestId: "r", outcome: { kind: "rejected" } }),
    ).rejects.toThrow("opencode: question-response is not supported")
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
