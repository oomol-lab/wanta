import type { AgentEvent } from "../contract/event.ts"
import type { ExternalAgentRuntimeStatus } from "../external/probe.ts"
import type { AcpTransport } from "./adapter.ts"
import type {
  AnyMessage,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  SessionUpdate,
  SetSessionModeRequest,
  Stream,
} from "@agentclientprotocol/sdk"

import { agent, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { AcpAgentAdapter } from "./adapter.ts"
import { ACP_AGENT_REGISTRY } from "./registry.ts"

// Adversarial edge tests for the ACP adapter's model/effort/permission
// selection plumbing, against an in-process fake ACP agent (same wire-level
// approach as adapter.test.ts) with extra seams:
// - per-call session/new responses,
// - failable session/set_model and session/set_config_option handlers,
// - initial connect() failures (connection refused),
// - unsolicited agent-side session/update notifications (config_option_update).

const WANTA_SESSION_ID = "wanta-session-1"

interface FakeAgentBehavior {
  /** Per-call session/new response; callIndex starts at 0. May throw. */
  newSession?: (params: NewSessionRequest, callIndex: number) => NewSessionResponse
  /** session/set_model handler; may throw or return a pending promise. */
  setModel?: (params: { sessionId: string; modelId: string }) => unknown
  /** session/set_config_option handler; may throw. */
  setConfigOption?: (params: { sessionId: string; configId: string; value: unknown }) => unknown
  /** Drive a prompt turn; defaults to an immediate end_turn. */
  prompt?: (turn: {
    params: PromptRequest
    sendUpdate: (update: SessionUpdate) => Promise<void>
  }) => Promise<PromptResponse>
  /** Number of initial connect() attempts that fail with ECONNREFUSED. */
  connectFailures?: number
}

interface FakeAgent {
  connect: () => Promise<AcpTransport>
  connectCount: () => number
  fireExit: (code: number | null) => void
  /** Sends an unsolicited session/update notification from the agent side. */
  notifySessionUpdate: (sessionId: string, update: Record<string, unknown>) => Promise<void>
  newSessionRequests: NewSessionRequest[]
  promptRequests: PromptRequest[]
  setModeRequests: SetSessionModeRequest[]
  setConfigOptionRequests: Array<{ sessionId: string; configId: string; value: unknown }>
  setModelRequests: Array<{ sessionId: string; modelId: string }>
  closedSessionIds: string[]
}

function createFakeAgent(behavior: FakeAgentBehavior = {}): FakeAgent {
  let sessionSeq = 0
  let connectCount = 0
  let connectFailuresLeft = behavior.connectFailures ?? 0
  let newSessionCalls = 0
  const exitCallbackGroups: Array<Array<(info: { code: number | null }) => void>> = []
  const newSessionRequests: NewSessionRequest[] = []
  const promptRequests: PromptRequest[] = []
  const setModeRequests: SetSessionModeRequest[] = []
  const setConfigOptionRequests: Array<{ sessionId: string; configId: string; value: unknown }> = []
  const setModelRequests: Array<{ sessionId: string; modelId: string }> = []
  const closedSessionIds: string[] = []
  // Agent-side context of the latest connection, for unsolicited notifications.
  let latestContext: { notify: (method: string, params: unknown) => Promise<void> } | undefined

  const app = agent({ name: "fake-acp-agent" })
    .onRequest("initialize", () => ({ protocolVersion: PROTOCOL_VERSION }))
    .onRequest("session/new", ({ params }) => {
      newSessionRequests.push(params)
      const callIndex = newSessionCalls
      newSessionCalls += 1
      if (behavior.newSession) {
        return behavior.newSession(params, callIndex)
      }
      sessionSeq += 1
      return { sessionId: `acp-session-${sessionSeq}` }
    })
    .onRequest("session/set_mode", ({ params }) => {
      setModeRequests.push(params)
      return {}
    })
    .onRequest("session/set_config_option", ({ params }) => {
      const typed = params as { sessionId: string; configId: string; value: unknown }
      setConfigOptionRequests.push(typed)
      if (behavior.setConfigOption) {
        return behavior.setConfigOption(typed) as never
      }
      return { configOptions: [] }
    })
    .onRequest(
      "session/set_model",
      (params: unknown) => params as { sessionId: string; modelId: string },
      ({ params }) => {
        setModelRequests.push(params)
        if (behavior.setModel) {
          return behavior.setModel(params) as never
        }
        return {}
      },
    )
    .onRequest(
      "session/close",
      (params: unknown) => params as { sessionId: string },
      ({ params }) => {
        closedSessionIds.push(params.sessionId)
        return {}
      },
    )
    .onRequest("session/prompt", async ({ params, client: agentClient }) => {
      promptRequests.push(params)
      const promptBehavior = behavior.prompt
      if (!promptBehavior) {
        return { stopReason: "end_turn" }
      }
      return promptBehavior({
        params,
        sendUpdate: (update) => agentClient.notify("session/update", { sessionId: params.sessionId, update }),
      })
    })
    .onNotification("session/cancel", () => {})

  return {
    connect: async () => {
      if (connectFailuresLeft > 0) {
        connectFailuresLeft -= 1
        throw new Error("connect ECONNREFUSED 127.0.0.1:0")
      }
      connectCount += 1
      const clientToAgent = new TransformStream<AnyMessage, AnyMessage>()
      const agentToClient = new TransformStream<AnyMessage, AnyMessage>()
      const agentSide: Stream = { writable: agentToClient.writable, readable: clientToAgent.readable }
      const clientSide: Stream = { writable: clientToAgent.writable, readable: agentToClient.readable }
      const agentConnection = app.connect(agentSide)
      latestContext = agentConnection.client as unknown as {
        notify: (method: string, params: unknown) => Promise<void>
      }
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
    notifySessionUpdate: async (sessionId, update) => {
      if (!latestContext) {
        throw new Error("no live fake connection")
      }
      await latestContext.notify("session/update", { sessionId, update })
    },
    newSessionRequests,
    promptRequests,
    setModeRequests,
    setConfigOptionRequests,
    setModelRequests,
    closedSessionIds,
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

async function createHarness(
  behavior: FakeAgentBehavior = {},
  kind: keyof typeof ACP_AGENT_REGISTRY = "codex",
): Promise<AdapterHarness> {
  const fake = createFakeAgent(behavior)
  const registration = ACP_AGENT_REGISTRY[kind]
  const scratchRootDir = await mkdtemp(path.join(os.tmpdir(), "acp-selection-edge-"))
  const probe = vi.fn(
    async (): Promise<ExternalAgentRuntimeStatus> => ({
      kind,
      displayName: registration.displayName,
      binary: { status: "detected", path: "/fake/bin/agent", version: "1.0.0" },
      login: { status: "unknown" },
      loginHint: registration.loginHint,
    }),
  )
  const adapter = new AcpAgentAdapter({ kind, registration, probe, scratchRootDir, connect: fake.connect })
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

function promptInput(text = "hello agent") {
  return { type: "prompt", sessionId: WANTA_SESSION_ID, text } as const
}

function modelsShape(currentModelId: string, ids: string[]): NewSessionResponse {
  return {
    sessionId: "acp-session-x",
    models: {
      currentModelId,
      availableModels: ids.map((id) => ({ modelId: id, name: id.toUpperCase() })),
    },
  } as never
}

const MODEL_EFFORT_CONFIG_OPTIONS = [
  {
    id: "model",
    name: "Model",
    type: "select",
    category: "model",
    currentValue: "gpt-a",
    options: [
      { value: "gpt-a", name: "GPT A" },
      { value: "gpt-b", name: "GPT B" },
    ],
  },
  {
    id: "reasoning_effort",
    name: "Reasoning effort",
    type: "select",
    category: "thought_level",
    currentValue: "medium",
    options: [
      { value: "low", name: "Low" },
      { value: "medium", name: "Medium" },
      { value: "high", name: "High" },
    ],
  },
]

describe("acp selection: stash-revert on live rejection", () => {
  test("a rejected session/set_model reverts the stash; the respawned session never re-requests it", async () => {
    const harness = await createHarness({
      newSession: (_params, index) => ({
        ...modelsShape("m1", ["m1", "m2", "m-bad"]),
        sessionId: `acp-session-${index + 1}`,
      }),
      setModel: (params) => {
        if (params.modelId === "m-bad") {
          throw new Error("model rejected by agent")
        }
        return {}
      },
    })
    await harness.adapter.send(promptInput())
    await harness.waitFor((event) => event.event === "messageCompleted")

    await harness.adapter.send({ type: "set-model", sessionId: WANTA_SESSION_ID, modelId: "m2" })
    expect(harness.adapter.sessionSelection(WANTA_SESSION_ID)).toEqual({ modelId: "m2" })

    await expect(
      harness.adapter.send({ type: "set-model", sessionId: WANTA_SESSION_ID, modelId: "m-bad" }),
    ).rejects.toThrow()
    // Stash reverted to the last accepted choice.
    expect(harness.adapter.sessionSelection(WANTA_SESSION_ID)).toEqual({ modelId: "m2" })

    // Subprocess dies; the next prompt respawns and recreates the ACP session.
    harness.fake.fireExit(1)
    await harness.adapter.send(promptInput("after respawn"))
    await harness.waitFor((event) => event.event === "messageCompleted" && harness.fake.promptRequests.length === 2)

    // The rejected id was requested exactly once (the failed live switch); the
    // recreation applied the accepted id on the new ACP session.
    const badRequests = harness.fake.setModelRequests.filter((request) => request.modelId === "m-bad")
    expect(badRequests).toHaveLength(1)
    expect(harness.fake.setModelRequests.at(-1)).toEqual({ sessionId: "acp-session-2", modelId: "m2" })
  })

  test("a rejected set_config_option effort reverts to the previous accepted effort", async () => {
    const harness = await createHarness({
      newSession: (_params, index) =>
        ({ sessionId: `acp-session-${index + 1}`, configOptions: MODEL_EFFORT_CONFIG_OPTIONS }) as never,
      setConfigOption: (params) => {
        if (params.value === "bad-effort") {
          throw new Error("effort rejected by agent")
        }
        return { configOptions: [] }
      },
    })
    await harness.adapter.send(promptInput())
    await harness.waitFor((event) => event.event === "messageCompleted")

    await harness.adapter.send({ type: "set-effort", sessionId: WANTA_SESSION_ID, effortId: "high" })
    expect(harness.adapter.sessionSelection(WANTA_SESSION_ID)).toEqual({ effortId: "high" })

    await expect(
      harness.adapter.send({ type: "set-effort", sessionId: WANTA_SESSION_ID, effortId: "bad-effort" }),
    ).rejects.toThrow()
    expect(harness.adapter.sessionSelection(WANTA_SESSION_ID)).toEqual({ effortId: "high" })

    harness.fake.fireExit(1)
    await harness.adapter.send(promptInput("after respawn"))
    await harness.waitFor((event) => event.event === "messageCompleted" && harness.fake.promptRequests.length === 2)

    const badRequests = harness.fake.setConfigOptionRequests.filter((request) => request.value === "bad-effort")
    expect(badRequests).toHaveLength(1)
    expect(harness.fake.setConfigOptionRequests.at(-1)).toEqual({
      sessionId: "acp-session-2",
      configId: "reasoning_effort",
      value: "high",
    })
  })

  test("an accepted set_model followed by a session/new with a different current model follows the agent", async () => {
    const harness = await createHarness({
      newSession: (_params, index) =>
        index === 0
          ? { ...modelsShape("m1", ["m1", "m2"]), sessionId: "acp-session-1" }
          : { ...modelsShape("m3", ["m3", "m4"]), sessionId: "acp-session-2" },
    })
    await harness.adapter.send(promptInput())
    await harness.waitFor((event) => event.event === "messageCompleted")
    let status = await harness.adapter.runtimeStatus()
    expect(status.catalog?.models.map((model) => model.id)).toEqual(["m1", "m2"])
    expect(status.catalog?.defaultModelId).toBe("m1")

    await harness.adapter.send({ type: "set-model", sessionId: WANTA_SESSION_ID, modelId: "m2" })

    // The agent restarts and now advertises a completely different model list.
    harness.fake.fireExit(1)
    await harness.adapter.send(promptInput("after model shuffle"))
    await harness.waitFor((event) => event.event === "messageCompleted" && harness.fake.promptRequests.length === 2)

    // No crash; the catalog follows the agent's new advertisement.
    status = await harness.adapter.runtimeStatus()
    expect(status.catalog?.models.map((model) => model.id)).toEqual(["m3", "m4"])
    expect(status.catalog?.defaultModelId).toBe("m3")
  })

  test("a stale rejection must not clobber a newer accepted model choice", async () => {
    let rejectSlow: ((error: Error) => void) | undefined
    const harness = await createHarness({
      newSession: () => modelsShape("m1", ["m1", "slow-bad", "fast-good"]),
      setModel: (params) => {
        if (params.modelId === "slow-bad") {
          return new Promise((_resolve, reject) => {
            rejectSlow = reject
          })
        }
        return {}
      },
    })
    await harness.adapter.send(promptInput())
    await harness.waitFor((event) => event.event === "messageCompleted")

    // First switch hangs on the wire; second switch is accepted meanwhile.
    const slowSwitch = harness.adapter.send({ type: "set-model", sessionId: WANTA_SESSION_ID, modelId: "slow-bad" })
    await vi.waitFor(() => expect(rejectSlow).toBeDefined())
    await harness.adapter.send({ type: "set-model", sessionId: WANTA_SESSION_ID, modelId: "fast-good" })
    expect(harness.adapter.sessionSelection(WANTA_SESSION_ID)).toEqual({ modelId: "fast-good" })

    rejectSlow?.(new Error("stale rejection"))
    await expect(slowSwitch).rejects.toThrow()

    // The stale revert must not wipe the accepted newer choice: the agent is
    // live on fast-good and a future session recreation must request it.
    expect(harness.adapter.sessionSelection(WANTA_SESSION_ID)).toEqual({ modelId: "fast-good" })
  })
})

describe("acp selection: warmCatalog edges", () => {
  test("two concurrent warms share a single throwaway session", async () => {
    const harness = await createHarness({
      newSession: () => modelsShape("m1", ["m1", "m2"]),
    })
    await Promise.all([harness.adapter.warmCatalog(), harness.adapter.warmCatalog()])
    expect(harness.fake.connectCount()).toBe(1)
    expect(harness.fake.newSessionRequests).toHaveLength(1)
    expect(harness.fake.closedSessionIds).toHaveLength(1)
    const status = await harness.adapter.runtimeStatus()
    expect(status.catalog?.models.map((model) => model.id)).toEqual(["m1", "m2"])
  })

  test("a connection-refused warm resolves quietly and a retry succeeds", async () => {
    const harness = await createHarness({
      connectFailures: 1,
      newSession: () => modelsShape("m1", ["m1"]),
    })
    // First warm fails to connect; the failure is swallowed by design.
    await expect(harness.adapter.warmCatalog()).resolves.toBeUndefined()
    let status = await harness.adapter.runtimeStatus()
    expect(status.catalog).toBeUndefined()
    // Second warm reconnects and fills the catalog.
    await harness.adapter.warmCatalog()
    status = await harness.adapter.runtimeStatus()
    expect(status.catalog?.models.map((model) => model.id)).toEqual(["m1"])
    expect(harness.fake.connectCount()).toBe(1)
  })

  test("a session/new without selects must not wipe an already-warmed catalog", async () => {
    const harness = await createHarness({
      newSession: (_params, index) =>
        index === 0 ? modelsShape("m1", ["m1", "m2"]) : { sessionId: "acp-session-real" },
    })
    await harness.adapter.warmCatalog()
    let status = await harness.adapter.runtimeStatus()
    expect(status.catalog?.models).toHaveLength(2)

    // A real session that reports no selects (agent hiccup / older build).
    await harness.adapter.send(promptInput())
    await harness.waitFor((event) => event.event === "messageCompleted")
    status = await harness.adapter.runtimeStatus()
    expect(status.catalog?.models.map((model) => model.id)).toEqual(["m1", "m2"])
    expect(status.catalog?.defaultModelId).toBe("m1")
  })

  test("a config_option_update carrying an empty options list must not wipe the catalog", async () => {
    const harness = await createHarness({
      newSession: () => ({ sessionId: "acp-session-1", configOptions: MODEL_EFFORT_CONFIG_OPTIONS }) as never,
    })
    await harness.adapter.send(promptInput())
    await harness.waitFor((event) => event.event === "messageCompleted")
    let status = await harness.adapter.runtimeStatus()
    expect(status.catalog?.models).toHaveLength(2)

    // The agent pushes a config_option_update whose model select momentarily
    // carries no options (observed agent behavior during model-list reloads).
    await harness.fake.notifySessionUpdate("acp-session-1", {
      sessionUpdate: "config_option_update",
      configOptions: [
        { id: "model", name: "Model", type: "select", category: "model", currentValue: "gpt-a", options: [] },
      ],
    })
    // Fence: a usage_update after it guarantees the previous notification was
    // processed (in-order delivery on the same stream).
    await harness.fake.notifySessionUpdate("acp-session-1", { sessionUpdate: "usage_update", used: 10, size: 100 })
    await harness.waitFor((event) => event.event === "usageUpdated")

    status = await harness.adapter.runtimeStatus()
    expect(status.catalog?.models.map((model) => model.id)).toEqual(["gpt-a", "gpt-b"])
  })
})

describe("acp selection: prompt-borne selections", () => {
  test("a failing prompt-borne model apply never fails the session-creating turn", async () => {
    const harness = await createHarness({
      newSession: () => modelsShape("m1", ["m1", "m2"]),
      setModel: () => {
        throw new Error("switch refused")
      },
    })
    await expect(
      harness.adapter.send({ ...promptInput(), agentModelId: "m2", agentEffortId: "high" }),
    ).resolves.toBeUndefined()
    await harness.waitFor((event) => event.event === "messageCompleted")
    expect(harness.fake.promptRequests).toHaveLength(1)
    // The failed apply was attempted exactly once, on the freshly created session.
    expect(harness.fake.setModelRequests).toHaveLength(1)
  })
})

describe("acp selection: permission-mode projection", () => {
  const MODES_ALL = {
    currentModeId: "agent",
    availableModes: [
      { id: "read-only", name: "Read only" },
      { id: "agent", name: "Agent" },
      { id: "agent-full-access", name: "Full access" },
    ],
  }

  test("a mode chosen before the session exists is projected once the session is created", async () => {
    const harness = await createHarness({
      newSession: () => ({ sessionId: "acp-session-1", modes: MODES_ALL }),
    })
    // The chat layer projects the permission mode right before the FIRST
    // prompt — at that point no ACP session exists yet (chat/node.ts:1819
    // runs before adapter.send creates it). Without a desired-mode stash the
    // first turn runs in the agent's default mode instead of the user's pick.
    await harness.adapter.applyPermissionMode(WANTA_SESSION_ID, "read_only")
    await harness.adapter.send(promptInput())
    await harness.waitFor((event) => event.event === "messageCompleted")
    expect(harness.fake.setModeRequests.map((request) => request.modeId)).toContain("read-only")
  })

  test("a mapped mode the live session does not advertise is skipped without error", async () => {
    const harness = await createHarness({
      newSession: () => ({
        sessionId: "acp-session-1",
        modes: {
          currentModeId: "agent",
          availableModes: [
            { id: "read-only", name: "Read only" },
            { id: "agent", name: "Agent" },
          ],
        },
      }),
    })
    await harness.adapter.send(promptInput())
    await harness.waitFor((event) => event.event === "messageCompleted")
    // codex maps full_access -> agent-full-access, which this session lacks.
    await expect(harness.adapter.applyPermissionMode(WANTA_SESSION_ID, "full_access")).resolves.toBeUndefined()
    expect(harness.fake.setModeRequests).toHaveLength(0)
  })

  test("two rapid mode applies both settle without error", async () => {
    const harness = await createHarness({
      newSession: () => ({ sessionId: "acp-session-1", modes: MODES_ALL }),
    })
    await harness.adapter.send(promptInput())
    await harness.waitFor((event) => event.event === "messageCompleted")
    await Promise.all([
      harness.adapter.applyPermissionMode(WANTA_SESSION_ID, "full_access"),
      harness.adapter.applyPermissionMode(WANTA_SESSION_ID, "read_only"),
    ])
    expect(harness.fake.setModeRequests.map((request) => request.modeId).sort()).toEqual([
      "agent-full-access",
      "read-only",
    ])
  })

  test("an agent without a permissionModeMap ignores mode projection entirely", async () => {
    const harness = await createHarness(
      {
        newSession: () => ({ ...modelsShape("m1", ["m1"]), sessionId: "acp-session-1", modes: MODES_ALL }),
      },
      "grok",
    )
    await harness.adapter.send(promptInput())
    await harness.waitFor((event) => event.event === "messageCompleted")
    await expect(harness.adapter.applyPermissionMode(WANTA_SESSION_ID, "full_access")).resolves.toBeUndefined()
    expect(harness.fake.setModeRequests).toHaveLength(0)
    // grok declares no effort selection; the input is rejected loudly, not dropped.
    await expect(
      harness.adapter.send({ type: "set-effort", sessionId: WANTA_SESSION_ID, effortId: "high" }),
    ).rejects.toThrow(/set-effort/u)
  })
})

describe("acp selection: catalog parsing resilience", () => {
  test("models entries with missing names, junk entries, and junk descriptions parse sanely", async () => {
    const harness = await createHarness({
      newSession: () =>
        ({
          sessionId: "acp-warm-1",
          models: {
            currentModelId: "m1",
            availableModels: [
              { modelId: "m1" }, // no name: label falls back to the id
              { modelId: "", name: "empty id" }, // dropped
              null,
              42,
              "junk",
              { name: "no id at all" }, // dropped
              { modelId: "m2", name: "M2", description: 7 }, // junk description ignored
            ],
          },
        }) as never,
    })
    await harness.adapter.warmCatalog()
    const status = await harness.adapter.runtimeStatus()
    expect(status.catalog?.models).toEqual([
      { id: "m1", label: "m1" },
      { id: "m2", label: "M2" },
    ])
    expect(status.catalog?.defaultModelId).toBe("m1")
  })

  test("duplicate modelIds are deduplicated for the picker", async () => {
    const harness = await createHarness({
      newSession: () =>
        ({
          sessionId: "acp-warm-1",
          models: {
            currentModelId: "m1",
            availableModels: [
              { modelId: "m1", name: "First" },
              { modelId: "m1", name: "Duplicate" },
              { modelId: "m2", name: "Second" },
            ],
          },
        }) as never,
    })
    await harness.adapter.warmCatalog()
    const status = await harness.adapter.runtimeStatus()
    // AgentOptionPicker keys rows by option id; duplicate ids collide.
    expect(status.catalog?.models.map((model) => model.id)).toEqual(["m1", "m2"])
  })

  test("a currentModelId absent from availableModels does not throw and keeps the list", async () => {
    const harness = await createHarness({
      newSession: () => modelsShape("ghost-model", ["m1", "m2"]),
    })
    await harness.adapter.warmCatalog()
    const status = await harness.adapter.runtimeStatus()
    expect(status.catalog?.models.map((model) => model.id)).toEqual(["m1", "m2"])
    // Current behavior: the ghost id is surfaced verbatim as the default. The
    // picker resolves it to no row and falls back to its generic caption.
    expect(status.catalog?.defaultModelId).toBe("ghost-model")
  })

  test("configOptions with unknown categories, junk entries, and grouped options parse sanely", async () => {
    const harness = await createHarness({
      newSession: () =>
        ({
          sessionId: "acp-warm-1",
          configOptions: [
            null,
            42,
            "junk",
            { type: "select", id: "verbosity", category: "verbosity", options: [{ value: "high", name: "High" }] },
            { type: "text", id: "note", category: "model" },
            {
              type: "select",
              id: "model",
              category: "model",
              currentValue: "m1",
              options: [
                { value: "m1", name: "M1" },
                // Grouped select options are flattened; junk inside is dropped.
                { options: [{ value: "m2", name: "M2" }, null, { value: "" }, "junk"] },
                { value: 9 },
              ],
            },
            // A second model select must not override the first.
            { type: "select", id: "model2", category: "model", options: [{ value: "zz", name: "ZZ" }] },
          ],
        }) as never,
    })
    await harness.adapter.warmCatalog()
    const status = await harness.adapter.runtimeStatus()
    expect(status.catalog?.models).toEqual([
      { id: "m1", label: "M1" },
      { id: "m2", label: "M2" },
    ])
    expect(status.catalog?.defaultModelId).toBe("m1")
    expect(status.catalog?.efforts).toEqual([])
  })

  test("selects of only unknown categories leave the catalog absent and the warm retryable", async () => {
    const harness = await createHarness({
      newSession: () =>
        ({
          sessionId: "acp-warm-1",
          configOptions: [
            { type: "select", id: "style", category: "verbosity", options: [{ value: "terse", name: "Terse" }] },
          ],
        }) as never,
    })
    await harness.adapter.warmCatalog()
    let status = await harness.adapter.runtimeStatus()
    expect(status.catalog).toBeUndefined()
    // An empty warm result must not latch: a later warm may try again.
    await harness.adapter.warmCatalog()
    expect(harness.fake.newSessionRequests).toHaveLength(2)
    status = await harness.adapter.runtimeStatus()
    expect(status.catalog).toBeUndefined()
  })
})
