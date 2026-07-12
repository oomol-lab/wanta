import type { AgentManager } from "../agent/manager.ts"
import type { SessionProject } from "../session/common.ts"
import type { ChatMessage } from "./common.ts"

import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, test, vi } from "vitest"
import { ArtifactBundleStore, buildArtifactBundle, recordArtifactBundle } from "./artifact-bundles.ts"
import { AuthorizationOverlayStore } from "./authorization.ts"
import { buildContextMentionsSystem, ChatServiceImpl, isAbortErrorMessage } from "./node.ts"
import { TurnOutputStore } from "./turn-outputs.ts"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function createBridgeAgent(): {
  agent: AgentManager
  abort: ReturnType<typeof vi.fn>
  answerPermission: ReturnType<typeof vi.fn>
  answerQuestion: ReturnType<typeof vi.fn>
  artifactSessionDir: ReturnType<typeof vi.fn>
  createArtifactDir: ReturnType<typeof vi.fn>
  createProcessDir: ReturnType<typeof vi.fn>
  emit: (event: { type: string; data?: Record<string, unknown>; properties?: Record<string, unknown> }) => void
  getMessages: ReturnType<typeof vi.fn>
  getPendingPermissions: ReturnType<typeof vi.fn>
  getPendingQuestions: ReturnType<typeof vi.fn>
  promptStreaming: ReturnType<typeof vi.fn>
  rejectQuestion: ReturnType<typeof vi.fn>
  setSessionOrganizationName: ReturnType<typeof vi.fn>
} {
  let listener:
    | ((event: { type: string; data?: Record<string, unknown>; properties?: Record<string, unknown> }) => void)
    | undefined
  const abort = vi.fn(async () => undefined)
  const answerPermission = vi.fn(async () => undefined)
  const answerQuestion = vi.fn(async () => undefined)
  const artifactSessionDir = vi.fn(() => path.join(os.tmpdir(), "wanta-test-artifacts"))
  const createArtifactDir = vi.fn(async () => path.join(os.tmpdir(), "wanta-test-artifacts"))
  const createProcessDir = vi.fn(async () => path.join(os.tmpdir(), "wanta-test-process"))
  const getMessages = vi.fn(async () => [])
  const getPendingPermissions = vi.fn(async () => [])
  const getPendingQuestions = vi.fn(async () => [])
  const promptStreaming = vi.fn(async () => undefined)
  const rejectQuestion = vi.fn(async () => undefined)
  const clearSessionOrganizationName = vi.fn(async () => undefined)
  const setSessionOrganizationName = vi.fn(async () => undefined)
  const agent = {
    isReady: () => true,
    subscribe: (
      callback: (event: { type: string; data?: Record<string, unknown>; properties?: Record<string, unknown> }) => void,
    ) => {
      listener = callback
      return () => {
        listener = undefined
      }
    },
    abort,
    answerPermission,
    answerQuestion,
    artifactSessionDir,
    createArtifactDir,
    createProcessDir,
    clearSessionOrganizationName,
    rejectQuestion,
    setSessionOrganizationName,
    promptStreaming,
    getMessages,
    getPendingPermissions,
    getPendingQuestions,
  } as unknown as AgentManager
  return {
    agent,
    abort,
    answerPermission,
    answerQuestion,
    artifactSessionDir,
    createArtifactDir,
    createProcessDir,
    emit: (event) => listener?.(event),
    getPendingPermissions,
    getPendingQuestions,
    getMessages,
    promptStreaming,
    rejectQuestion,
    setSessionOrganizationName,
  }
}

function captureServiceEvents(service: ChatServiceImpl): Array<{ event: string; data: unknown }> {
  const events: Array<{ event: string; data: unknown }> = []
  ;(service as unknown as { send: (event: string, data: unknown) => Promise<void> }).send = async (event, data) => {
    events.push({ event, data })
  }
  return events
}

function projectStore(projects: SessionProject[]): { read: () => Promise<Map<string, SessionProject>> } {
  return {
    read: async () => new Map(projects.map((project) => [project.id, project])),
  }
}

async function waitForInactiveGeneration(service: ChatServiceImpl): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!service.hasActiveGeneration()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

async function waitForEventCount(events: Array<{ event: string; data: unknown }>, count: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (events.length >= count) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (condition()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail("Timed out waiting for condition")
}

async function waitForMessageErrorCount(events: Array<{ event: string; data: unknown }>, count: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (events.filter((event) => event.event === "messageError").length >= count) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function lastEventData<T>(events: Array<{ event: string; data: unknown }>): T {
  const event = events.at(-1)
  assert.ok(event)
  return event.data as T
}

test("isAbortErrorMessage recognizes controlled stop errors only", () => {
  assert.equal(isAbortErrorMessage("Aborted"), true)
  assert.equal(isAbortErrorMessage("AbortError"), true)
  assert.equal(isAbortErrorMessage("AbortError: The operation was aborted."), true)
  assert.equal(isAbortErrorMessage("The operation was aborted."), true)
  assert.equal(isAbortErrorMessage("Task failed"), false)
  assert.equal(isAbortErrorMessage("Remote service cancelled the request"), false)
})

test("setAgentOrganization waits for the scope synchronization callback", async () => {
  let resolveScope: (() => void) | undefined
  const service = new ChatServiceImpl(null, {
    onSetAgentOrganization: async () =>
      new Promise<void>((resolve) => {
        resolveScope = resolve
      }),
  })

  let completed = false
  const request = service.setAgentOrganization({ organizationName: "acme-corp" }).then(() => {
    completed = true
  })
  await waitForCondition(() => Boolean(resolveScope))

  assert.equal(completed, false)
  resolveScope?.()
  await request
  assert.equal(completed, true)
})

test("sendMessage waits for the request organization scope before prompting", async () => {
  const bridge = createBridgeAgent()
  let resolveScope: (() => void) | undefined
  bridge.setSessionOrganizationName.mockImplementationOnce(
    async () =>
      new Promise<void>((resolve) => {
        resolveScope = resolve
      }),
  )
  const service = new ChatServiceImpl(bridge.agent)

  const request = service.sendMessage({
    scope: { type: "organization", organizationId: "org-id", organizationName: " acme-corp " },
    sessionId: "session-1",
    text: "hello",
  })
  await waitForCondition(() => Boolean(resolveScope))

  assert.deepEqual(bridge.setSessionOrganizationName.mock.calls, [["session-1", "acme-corp"]])
  assert.equal((await service.getActiveRun("session-1"))?.phase, "sending")
  assert.equal(bridge.createArtifactDir.mock.calls.length, 0)
  assert.equal(bridge.promptStreaming.mock.calls.length, 0)

  resolveScope?.()
  await request

  assert.equal(bridge.createArtifactDir.mock.calls.length, 1)
  assert.equal(bridge.promptStreaming.mock.calls.length, 1)
})

test("sendMessage exposes active run snapshots with the request workspace", async () => {
  const bridge = createBridgeAgent()
  const service = new ChatServiceImpl(bridge.agent)
  const events = captureServiceEvents(service)

  await service.sendMessage({
    scope: { type: "organization", organizationId: "org-id", organizationName: " acme-corp " },
    sessionId: "session-1",
    text: "hello",
  })

  const run = await service.getActiveRun("session-1")
  assert.equal(run?.sessionId, "session-1")
  assert.equal(run?.phase, "submitted")
  assert.deepEqual(run?.workspace, { type: "organization", organizationId: "org-id", organizationName: "acme-corp" })
  assert.ok(events.some((event) => event.event === "activeRunUpdated"))
})

test("getSessionSnapshot returns messages, pending asks, and active run together", async () => {
  const bridge = createBridgeAgent()
  const service = new ChatServiceImpl(bridge.agent)
  const messages: ChatMessage[] = [
    { id: "user-1", role: "user", createdAt: 1, parts: [{ kind: "text", partId: "text-1", text: "hello" }] },
  ]
  bridge.getMessages.mockResolvedValue(messages)
  bridge.getPendingQuestions.mockResolvedValue([
    {
      id: "question-1",
      sessionId: "session-1",
      questions: [{ header: "Pick", question: "Which one?", options: [{ label: "A" }] }],
    },
  ])

  await service.sendMessage({ sessionId: "session-1", text: "hello" })

  const snapshot = await service.getSessionSnapshot("session-1")

  assert.equal(snapshot.sessionId, "session-1")
  assert.deepEqual(snapshot.messages, messages)
  assert.equal(snapshot.pendingQuestions[0]?.id, "question-1")
  assert.deepEqual(snapshot.pendingPermissions, [])
  assert.equal(snapshot.activeRun?.phase, "submitted")
  assert.equal(bridge.getMessages.mock.calls.length, 1)
  assert.equal(bridge.getPendingQuestions.mock.calls.length, 1)
  assert.equal(bridge.getPendingPermissions.mock.calls.length, 1)
})

test("setAgent clears active run snapshots", async () => {
  const bridge = createBridgeAgent()
  const service = new ChatServiceImpl(bridge.agent)
  const events = captureServiceEvents(service)

  await service.sendMessage({ sessionId: "session-1", text: "hello" })
  assert.notEqual(await service.getActiveRun("session-1"), null)

  service.setAgent(null)

  assert.equal(await service.getActiveRun("session-1"), null)
  assert.ok(
    events.some(
      (event) =>
        event.event === "activeRunUpdated" &&
        (event.data as { endedRunId?: string; run?: unknown }).run === null &&
        Boolean((event.data as { endedRunId?: string }).endedRunId),
    ),
  )
})

test("active run snapshots track permission waits and completion", async () => {
  const bridge = createBridgeAgent()
  const service = new ChatServiceImpl(bridge.agent)
  const events = captureServiceEvents(service)
  service.startEventBridge()

  await service.sendMessage({ sessionId: "session-1", text: "hello" })
  bridge.emit({
    type: "permission.asked",
    properties: {
      action: "bash",
      id: "permission-1",
      resources: ["npm install"],
      metadata: { command: "npm install" },
      sessionID: "session-1",
    },
  })

  assert.equal((await service.getActiveRun("session-1"))?.phase, "awaiting_permission")
  assert.deepEqual((await service.getActiveRun("session-1"))?.blockingRequestIds, ["permission-1"])

  bridge.emit({ type: "session.idle", properties: { sessionID: "session-1" } })
  await waitForInactiveGeneration(service)

  assert.equal(await service.getActiveRun("session-1"), null)
  assert.ok(
    events.some(
      (event) =>
        event.event === "activeRunUpdated" &&
        (event.data as { run?: { phase?: string } | null }).run?.phase === "awaiting_permission",
    ),
  )
  assert.ok(
    events.some((event) => event.event === "activeRunUpdated" && (event.data as { run?: unknown }).run === null),
  )
})

test("sendMessage allows concurrent generations in different organization scopes", async () => {
  const bridge = createBridgeAgent()
  const service = new ChatServiceImpl(bridge.agent)
  service.startEventBridge()

  await service.sendMessage({
    scope: { type: "organization", organizationId: "org-a", organizationName: "org-a" },
    sessionId: "session-1",
    text: "first",
  })
  let secondCompleted = false
  const second = service
    .sendMessage({
      scope: { type: "organization", organizationId: "org-b", organizationName: "org-b" },
      sessionId: "session-2",
      text: "second",
    })
    .then(() => {
      secondCompleted = true
    })

  await second

  assert.equal(secondCompleted, true)
  assert.deepEqual(bridge.setSessionOrganizationName.mock.calls, [
    ["session-1", "org-a"],
    ["session-2", "org-b"],
  ])
  assert.equal(bridge.promptStreaming.mock.calls.length, 2)
  assert.equal(bridge.promptStreaming.mock.calls[0]?.[2]?.organizationName, "org-a")
  assert.equal(bridge.promptStreaming.mock.calls[1]?.[2]?.organizationName, "org-b")
})

test("sendMessage allows concurrent generations in the same organization scope", async () => {
  const bridge = createBridgeAgent()
  const service = new ChatServiceImpl(bridge.agent)
  service.startEventBridge()

  await service.sendMessage({
    scope: { type: "organization", organizationId: "org-a", organizationName: "org-a" },
    sessionId: "session-1",
    text: "first",
  })
  let secondCompleted = false
  const second = service
    .sendMessage({
      scope: { type: "organization", organizationId: "org-a", organizationName: "org-a" },
      sessionId: "session-2",
      text: "second",
    })
    .then(() => {
      secondCompleted = true
    })

  await second

  assert.equal(secondCompleted, true)
  assert.deepEqual(bridge.setSessionOrganizationName.mock.calls, [
    ["session-1", "org-a"],
    ["session-2", "org-a"],
  ])
  assert.equal(service.hasActiveGeneration(), true)
  assert.equal(bridge.promptStreaming.mock.calls.length, 2)
})

test("setAgentOrganization applies only the latest queued workspace scope", async () => {
  const bridge = createBridgeAgent()
  const scopeCalls: Array<string | undefined> = []
  const service = new ChatServiceImpl(bridge.agent, {
    onSetAgentOrganization: async (organizationName) => {
      scopeCalls.push(organizationName)
    },
  })
  service.startEventBridge()

  await service.sendMessage({
    scope: { type: "organization", organizationId: "org-a", organizationName: "org-a" },
    sessionId: "session-1",
    text: "first",
  })

  const firstSync = service.setAgentOrganization({ organizationName: "org-b" })
  const secondSync = service.setAgentOrganization({ organizationName: "org-c" })
  await Promise.resolve()

  await Promise.all([firstSync, secondSync])

  assert.deepEqual(scopeCalls, ["org-c"])
})

test("setAgentOrganization is not superseded by per-turn organization scopes", async () => {
  const bridge = createBridgeAgent()
  const scopeCalls: Array<string | undefined> = []
  let releaseFirstScope: (() => void) | undefined
  const service = new ChatServiceImpl(bridge.agent, {
    onSetAgentOrganization: async (organizationName) => {
      scopeCalls.push(organizationName)
      if (organizationName === "org-a") {
        await new Promise<void>((resolve) => {
          releaseFirstScope = resolve
        })
      }
    },
  })
  service.startEventBridge()

  const firstSync = service.setAgentOrganization({ organizationName: "org-a" })
  await waitForCondition(() => Boolean(releaseFirstScope))
  const secondSync = service.setAgentOrganization({ organizationName: "org-b" })
  await service.sendMessage({
    scope: { type: "organization", organizationId: "org-c", organizationName: "org-c" },
    sessionId: "session-1",
    text: "turn scoped to org-c",
  })

  releaseFirstScope?.()
  await Promise.all([firstSync, secondSync])

  assert.deepEqual(scopeCalls, ["org-a", "org-b"])
})

test("setAgentOrganization does not interrupt active generations from other organization scopes", async () => {
  const bridge = createBridgeAgent()
  const scopeCalls: Array<string | undefined> = []
  const service = new ChatServiceImpl(bridge.agent, {
    onSetAgentOrganization: async (organizationName) => {
      scopeCalls.push(organizationName)
    },
  })
  service.startEventBridge()

  await service.sendMessage({
    scope: { type: "organization", organizationId: "org-a", organizationName: "org-a" },
    sessionId: "session-1",
    text: "first",
  })
  assert.equal(service.hasActiveGeneration(), true)

  await service.setAgentOrganization({ organizationName: "org-b" })

  assert.deepEqual(scopeCalls, ["org-b"])
  assert.equal(bridge.abort.mock.calls.length, 0)
  assert.equal(service.hasActiveGeneration(), true)
})

test("setAgentOrganization does not wait on active generations for the requested organization scope", async () => {
  const bridge = createBridgeAgent()
  const scopeCalls: Array<string | undefined> = []
  const service = new ChatServiceImpl(bridge.agent, {
    onSetAgentOrganization: async (organizationName) => {
      scopeCalls.push(organizationName)
    },
  })
  service.startEventBridge()

  await service.sendMessage({
    scope: { type: "organization", organizationId: "org-a", organizationName: "org-a" },
    sessionId: "session-1",
    text: "first",
  })
  let completed = false
  const sync = service.setAgentOrganization({ organizationName: "org-a" }).then(() => {
    completed = true
  })

  await sync

  assert.equal(bridge.abort.mock.calls.length, 0)
  assert.equal(completed, true)
  assert.deepEqual(scopeCalls, ["org-a"])
})

test("stopGeneration suppresses delayed streaming events until the next send", async () => {
  const bridge = createBridgeAgent()
  const service = new ChatServiceImpl(bridge.agent)
  const events = captureServiceEvents(service)
  service.startEventBridge()

  bridge.emit({
    type: "message.updated",
    properties: { info: { id: "assistant-1", sessionID: "session-1", role: "assistant" } },
  })
  assert.deepEqual(
    events.map((event) => event.event),
    ["messageStarted"],
  )

  await service.stopGeneration("session-1")
  assert.equal(bridge.abort.mock.calls.length, 1)
  assert.equal(events.at(-1)?.event, "generationStopped")

  const stoppedEventCount = events.length
  bridge.emit({
    type: "message.part.updated",
    properties: {
      part: { id: "text-1", sessionID: "session-1", messageID: "assistant-1", type: "text", text: "late" },
    },
  })
  bridge.emit({
    type: "message.part.updated",
    properties: {
      part: {
        id: "tool-1",
        sessionID: "session-1",
        messageID: "assistant-1",
        type: "tool",
        callID: "call-1",
        tool: "search_actions",
        state: { status: "running", input: {} },
      },
    },
  })
  bridge.emit({
    type: "message.part.updated",
    properties: { part: { id: "step-1", sessionID: "session-1", messageID: "assistant-1", type: "step-start" } },
  })
  assert.equal(events.length, stoppedEventCount)

  const beforeAbortEventCount = events.length
  bridge.emit({
    type: "session.error",
    properties: { sessionID: "session-1", error: { name: "AbortError" } },
  })
  await waitForEventCount(events, beforeAbortEventCount + 1)
  assert.equal(events.length, beforeAbortEventCount + 1)
  assert.equal(events.at(-1)?.event, "generationStopped")
  const abortEventCount = events.length
  bridge.emit({
    type: "message.part.updated",
    properties: {
      part: { id: "text-2", sessionID: "session-1", messageID: "assistant-1", type: "text", text: "later" },
    },
  })
  assert.equal(events.length, abortEventCount)

  await service.sendMessage({ sessionId: "session-1", text: "next" })
  bridge.emit({
    type: "message.updated",
    properties: { info: { id: "assistant-2", sessionID: "session-1", role: "assistant" } },
  })
  assert.equal(events.at(-1)?.event, "messageStarted")
})

test("event bridge deduplicates message starts and coalesces text updates", async () => {
  const bridge = createBridgeAgent()
  const service = new ChatServiceImpl(bridge.agent)
  const events = captureServiceEvents(service)
  service.startEventBridge()

  const started = {
    type: "message.updated",
    properties: { info: { id: "assistant-1", sessionID: "session-1", role: "assistant" } },
  }
  bridge.emit(started)
  bridge.emit(started)
  for (const text of ["H", "Hello", "Hello world"]) {
    bridge.emit({
      type: "message.part.updated",
      properties: {
        delta: text === "H" ? "H" : undefined,
        part: { id: "text-1", sessionID: "session-1", messageID: "assistant-1", type: "text", text },
      },
    })
  }

  await waitForCondition(() => events.some((event) => event.event === "messageDelta"))

  assert.equal(events.filter((event) => event.event === "messageStarted").length, 1)
  const deltas = events.filter((event) => event.event === "messageDelta")
  assert.equal(deltas.length, 1)
  assert.equal((deltas[0]?.data as { text?: string } | undefined)?.text, "Hello world")
})

test("stopGeneration finalizes process files produced before cancellation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-chat-stop-turn-output-"))
  try {
    const artifactDir = path.join(root, "artifacts")
    const processDir = path.join(root, "process")
    await mkdir(artifactDir, { recursive: true })
    await mkdir(processDir, { recursive: true })

    const bridge = createBridgeAgent()
    bridge.createArtifactDir.mockResolvedValue(artifactDir)
    bridge.createProcessDir.mockResolvedValue(processDir)
    const store = new TurnOutputStore(root)
    const service = new ChatServiceImpl(bridge.agent, { turnOutputStore: store })
    const events = captureServiceEvents(service)
    service.startEventBridge()

    await service.sendMessage({ sessionId: "session-1", text: "hello" })
    bridge.emit({
      type: "message.updated",
      properties: { info: { id: "assistant-1", sessionID: "session-1", role: "assistant" } },
    })
    await writeFile(path.join(processDir, "create.js"), "console.log(1)\n", "utf8")

    await service.stopGeneration("session-1")
    const record = (await store.read()).get("session-1")?.get("assistant-1")

    assert.equal(record?.summary.processFileCount, 1)
    assert.equal(record?.files[0]?.name, "create.js")
    assert.ok(events.some((event) => event.event === "turnOutputUpdated"))
    assert.equal(events.at(-1)?.event, "generationStopped")
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("getTurnOutputs returns requested records in order without exposing stored diffs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-chat-turn-outputs-"))
  try {
    const store = new TurnOutputStore(root)
    await store.write(
      new Map([
        [
          "session-1",
          new Map([
            [
              "assistant-1",
              {
                sessionId: "session-1",
                messageId: "assistant-1",
                processRoot: path.join(root, "process-1"),
                createdAt: 1,
                completedAt: 2,
                files: [
                  {
                    path: path.join(root, "process-1", "create.js"),
                    name: "create.js",
                    role: "process",
                    changeKind: "added",
                    mime: "text/plain",
                    additions: 1,
                    deletions: 0,
                    diff: {
                      kind: "text",
                      path: path.join(root, "process-1", "create.js"),
                      mime: "text/plain",
                      additions: 1,
                      deletions: 0,
                      patch: "+console.log(1)\n",
                    },
                  },
                ],
                summary: { processFileCount: 1, changedFileCount: 0, additions: 1, deletions: 0 },
              },
            ],
            [
              "assistant-2",
              {
                sessionId: "session-1",
                messageId: "assistant-2",
                createdAt: 3,
                completedAt: 4,
                files: [],
                summary: { processFileCount: 0, changedFileCount: 1, additions: 0, deletions: 0 },
              },
            ],
          ]),
        ],
      ]),
    )
    const service = new ChatServiceImpl(null, { turnOutputStore: store })

    const result = await service.getTurnOutputs({
      sessionId: "session-1",
      messageIds: ["assistant-2", "assistant-2", "missing", "assistant-1"],
    })

    assert.deepEqual(
      result.map((record) => record.messageId),
      ["assistant-2", "assistant-1"],
    )
    assert.deepEqual(Object.keys(result[1]?.files[0] ?? {}).includes("diff"), false)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("message completion records intermediate code files left in artifact root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-chat-artifact-intermediate-"))
  try {
    const artifactDir = path.join(root, "artifacts")
    const processDir = path.join(root, "process")
    await mkdir(artifactDir, { recursive: true })
    await mkdir(processDir, { recursive: true })

    const bridge = createBridgeAgent()
    bridge.createArtifactDir.mockResolvedValue(artifactDir)
    bridge.createProcessDir.mockResolvedValue(processDir)
    const store = new TurnOutputStore(root)
    const service = new ChatServiceImpl(bridge.agent, { turnOutputStore: store })
    const events = captureServiceEvents(service)
    service.startEventBridge()

    await service.sendMessage({ sessionId: "session-1", text: "帮我生成一个 PPT" })
    bridge.emit({
      type: "message.updated",
      properties: { info: { id: "assistant-1", sessionID: "session-1", role: "assistant" } },
    })
    await writeFile(path.join(artifactDir, "create_ppt.js"), "console.log(1)\n", "utf8")
    bridge.emit({ type: "session.idle", properties: { sessionID: "session-1" } })
    await waitForCondition(() => events.some((event) => event.event === "turnOutputUpdated"))

    const record = (await store.read()).get("session-1")?.get("assistant-1")
    assert.equal(record?.summary.processFileCount, 1)
    assert.equal(record?.files[0]?.name, "create_ppt.js")
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("message completion publishes artifact-only outputs without turn output records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-chat-artifact-only-"))
  try {
    const artifactDir = path.join(root, "artifacts")
    const processDir = path.join(root, "process")
    await mkdir(artifactDir, { recursive: true })
    await mkdir(processDir, { recursive: true })

    const bridge = createBridgeAgent()
    bridge.createArtifactDir.mockResolvedValue(artifactDir)
    bridge.createProcessDir.mockResolvedValue(processDir)
    const artifactBundleStore = new ArtifactBundleStore(root)
    const turnOutputStore = new TurnOutputStore(root)
    const service = new ChatServiceImpl(bridge.agent, { artifactBundleStore, turnOutputStore })
    const events = captureServiceEvents(service)
    service.startEventBridge()

    await service.sendMessage({ sessionId: "session-1", text: "Create a report" })
    bridge.emit({
      type: "message.updated",
      properties: { info: { id: "assistant-1", sessionID: "session-1", role: "assistant" } },
    })
    await writeFile(path.join(artifactDir, "report.pdf"), "pdf", "utf8")
    bridge.emit({ type: "session.idle", properties: { sessionID: "session-1" } })
    await waitForCondition(() => events.some((event) => event.event === "artifactBundleUpdated"))

    assert.equal((await artifactBundleStore.read()).get("session-1")?.get("assistant-1")?.items[0]?.name, "report.pdf")
    assert.equal((await turnOutputStore.read()).get("session-1")?.get("assistant-1"), undefined)
    assert.equal(
      events.some((event) => event.event === "turnOutputUpdated"),
      false,
    )
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("message completion recovers files that a reused script writes into an old artifact turn", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-chat-artifact-recovery-"))
  try {
    const sessionRoot = path.join(root, "artifacts", "session-1")
    const oldArtifactDir = path.join(sessionRoot, "old-turn")
    const artifactDir = path.join(sessionRoot, "current-turn")
    const processDir = path.join(root, "process", "session-1", "current-turn")
    await mkdir(oldArtifactDir, { recursive: true })
    await mkdir(artifactDir)
    await mkdir(processDir, { recursive: true })
    await writeFile(path.join(oldArtifactDir, "existing.pdf"), "existing")

    const artifactBundleStore = new ArtifactBundleStore(root)
    const oldBundle = await buildArtifactBundle({
      artifactRoot: oldArtifactDir,
      completedAt: 2,
      createdAt: 1,
      generatedPreviewCount: 0,
      messageId: "assistant-old",
      sessionId: "session-1",
    })
    assert.ok(oldBundle)
    const records = new Map()
    recordArtifactBundle(records, oldBundle)
    await artifactBundleStore.write(records)

    const bridge = createBridgeAgent()
    bridge.artifactSessionDir.mockReturnValue(sessionRoot)
    bridge.createArtifactDir.mockResolvedValue(artifactDir)
    bridge.createProcessDir.mockResolvedValue(processDir)
    const service = new ChatServiceImpl(bridge.agent, { artifactBundleStore })
    const events = captureServiceEvents(service)
    service.startEventBridge()

    await service.sendMessage({ sessionId: "session-1", text: "Create three mock files" })
    bridge.emit({
      type: "message.updated",
      properties: { info: { id: "assistant-1", sessionID: "session-1", role: "assistant" } },
    })
    await writeFile(path.join(oldArtifactDir, "sales.xlsx"), "sales")
    await writeFile(path.join(oldArtifactDir, "training.pdf"), "training")
    await writeFile(path.join(oldArtifactDir, "budget.pdf"), "budget")
    bridge.emit({ type: "session.idle", properties: { sessionID: "session-1" } })
    await waitForCondition(() => events.some((event) => event.event === "artifactBundleUpdated"))

    const stored = await artifactBundleStore.read()
    const currentBundle = stored.get("session-1")?.get("assistant-1")
    assert.deepEqual(
      currentBundle?.items.map((item) => item.name),
      ["budget.pdf", "sales.xlsx", "training.pdf"],
    )
    assert.ok(currentBundle?.items.every((item) => item.origin === "recovered_output"))
    assert.deepEqual(
      stored
        .get("session-1")
        ?.get("assistant-old")
        ?.items.map((item) => item.name),
      ["existing.pdf"],
    )
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("message completion exposes a failed artifact bundle when an image preview was not persisted", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-chat-artifact-failed-"))
  try {
    const artifactDir = path.join(root, "artifacts")
    const processDir = path.join(root, "process")
    await mkdir(artifactDir, { recursive: true })
    await mkdir(processDir, { recursive: true })

    const bridge = createBridgeAgent()
    bridge.createArtifactDir.mockResolvedValue(artifactDir)
    bridge.createProcessDir.mockResolvedValue(processDir)
    bridge.getMessages.mockResolvedValue([
      {
        id: "assistant-1",
        role: "assistant",
        createdAt: 1,
        parts: [
          {
            kind: "text",
            partId: "text-1",
            text: "![generated](https://127.0.0.1/generated.png)",
          },
        ],
      },
    ])
    const artifactBundleStore = new ArtifactBundleStore(root)
    const service = new ChatServiceImpl(bridge.agent, { artifactBundleStore })
    const events = captureServiceEvents(service)
    service.startEventBridge()

    await service.sendMessage({ sessionId: "session-1", text: "Create an image" })
    bridge.emit({
      type: "message.updated",
      properties: { info: { id: "assistant-1", sessionID: "session-1", role: "assistant" } },
    })
    bridge.emit({ type: "session.idle", properties: { sessionID: "session-1" } })
    await waitForCondition(() => events.some((event) => event.event === "artifactBundleUpdated"))

    const bundle = (await artifactBundleStore.read()).get("session-1")?.get("assistant-1")
    assert.equal(bundle?.status, "failed")
    assert.equal(bundle?.failure, "generated_preview_not_persisted")
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("message completion materializes a data image preview into a ready artifact bundle", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-chat-artifact-data-preview-"))
  try {
    const artifactDir = path.join(root, "artifacts")
    const processDir = path.join(root, "process")
    await mkdir(artifactDir, { recursive: true })
    await mkdir(processDir, { recursive: true })

    const bridge = createBridgeAgent()
    bridge.createArtifactDir.mockResolvedValue(artifactDir)
    bridge.createProcessDir.mockResolvedValue(processDir)
    bridge.getMessages.mockResolvedValue([
      {
        id: "assistant-1",
        role: "assistant",
        createdAt: 1,
        parts: [
          {
            kind: "text",
            partId: "text-1",
            text: "![generated](data:image/png;base64,aW1hZ2U=)",
          },
        ],
      },
    ])
    const artifactBundleStore = new ArtifactBundleStore(root)
    const service = new ChatServiceImpl(bridge.agent, { artifactBundleStore })
    const events = captureServiceEvents(service)
    service.startEventBridge()

    await service.sendMessage({ sessionId: "session-1", text: "Create an image" })
    bridge.emit({
      type: "message.updated",
      properties: { info: { id: "assistant-1", sessionID: "session-1", role: "assistant" } },
    })
    bridge.emit({ type: "session.idle", properties: { sessionID: "session-1" } })
    await waitForCondition(() => events.some((event) => event.event === "artifactBundleUpdated"))

    const bundle = (await artifactBundleStore.read()).get("session-1")?.get("assistant-1")
    assert.equal(bundle?.status, "ready")
    assert.equal(bundle?.items[0]?.name, "generated-001.png")
    assert.equal(bundle?.items[0]?.origin, "assistant_preview")
    assert.equal(await readFile(path.join(artifactDir, "generated-001.png"), "utf8"), "image")
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("message completion materializes assistant file attachments into managed artifact storage", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-chat-artifact-attachment-"))
  try {
    const artifactDir = path.join(root, "artifacts")
    const processDir = path.join(root, "process")
    const temporaryImage = path.join(root, "generated.png")
    await mkdir(artifactDir, { recursive: true })
    await mkdir(processDir, { recursive: true })
    await writeFile(temporaryImage, "image")

    const bridge = createBridgeAgent()
    bridge.createArtifactDir.mockResolvedValue(artifactDir)
    bridge.createProcessDir.mockResolvedValue(processDir)
    bridge.getMessages.mockResolvedValue([
      {
        id: "assistant-1",
        role: "assistant",
        createdAt: 1,
        parts: [
          {
            kind: "attachment",
            partId: "image-1",
            attachment: {
              id: "image-1",
              kind: "file",
              mime: "image/png",
              name: "generated.png",
              path: temporaryImage,
              size: 5,
            },
          },
        ],
      },
    ])
    const artifactBundleStore = new ArtifactBundleStore(root)
    const service = new ChatServiceImpl(bridge.agent, { artifactBundleStore })
    const events = captureServiceEvents(service)
    service.startEventBridge()

    await service.sendMessage({ sessionId: "session-1", text: "Create an image" })
    bridge.emit({
      type: "message.updated",
      properties: { info: { id: "assistant-1", sessionID: "session-1", role: "assistant" } },
    })
    bridge.emit({ type: "session.idle", properties: { sessionID: "session-1" } })
    await waitForCondition(() => events.some((event) => event.event === "artifactBundleUpdated"))

    const item = (await artifactBundleStore.read()).get("session-1")?.get("assistant-1")?.items[0]
    assert.equal(item?.name, "generated.png")
    assert.equal(item?.origin, "assistant_attachment")
    assert.equal(await readFile(path.join(artifactDir, "generated.png"), "utf8"), "image")
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("late prompt rejection does not clear the replacement generation output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-chat-late-generation-"))
  try {
    let artifactIndex = 0
    let processIndex = 0
    let rejectFirstPrompt: ((error: Error) => void) | undefined
    const bridge = createBridgeAgent()
    bridge.createArtifactDir.mockImplementation(async () => {
      artifactIndex += 1
      const dir = path.join(root, `artifacts-${artifactIndex}`)
      await mkdir(dir, { recursive: true })
      return dir
    })
    bridge.createProcessDir.mockImplementation(async () => {
      processIndex += 1
      const dir = path.join(root, `process-${processIndex}`)
      await mkdir(dir, { recursive: true })
      return dir
    })
    bridge.promptStreaming
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, reject) => {
            rejectFirstPrompt = reject
          }),
      )
      .mockImplementationOnce(async () => undefined)
    const store = new TurnOutputStore(root)
    const service = new ChatServiceImpl(bridge.agent, { turnOutputStore: store })
    const events = captureServiceEvents(service)
    service.startEventBridge()

    await service.sendMessage({ sessionId: "session-1", text: "first" })
    await service.stopGeneration("session-1")
    await service.sendMessage({ sessionId: "session-1", text: "second" })
    rejectFirstPrompt?.(new Error("first failed late"))
    await new Promise((resolve) => setTimeout(resolve, 0))

    bridge.emit({
      type: "message.updated",
      properties: { info: { id: "assistant-2", sessionID: "session-1", role: "assistant" } },
    })
    await writeFile(path.join(root, "process-2", "second.js"), "console.log(2)\n", "utf8")
    bridge.emit({ type: "session.idle", properties: { sessionID: "session-1" } })
    await waitForCondition(() => events.some((event) => event.event === "turnOutputUpdated"))

    const records = (await store.read()).get("session-1")
    assert.equal(records?.get("assistant-1"), undefined)
    assert.equal(records?.get("assistant-2")?.files[0]?.name, "second.js")
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("agent errors from multiple opencode channels produce one message error per send", async () => {
  const bridge = createBridgeAgent()
  let rejectPrompt: ((error: Error) => void) | undefined
  bridge.promptStreaming.mockImplementationOnce(
    () =>
      new Promise<void>((_, reject) => {
        rejectPrompt = reject
      }),
  )
  const service = new ChatServiceImpl(bridge.agent)
  const events = captureServiceEvents(service)
  service.startEventBridge()

  await service.sendMessage({ sessionId: "session-1", text: "hello" })

  const error = {
    name: "APIError",
    data: { message: "The selected model does not exist." },
  }
  bridge.emit({
    type: "message.updated",
    properties: { info: { id: "assistant-1", sessionID: "session-1", role: "assistant", error } },
  })
  bridge.emit({
    type: "session.error",
    properties: { sessionID: "session-1", error },
  })
  rejectPrompt?.(new Error("The selected model does not exist."))
  await waitForMessageErrorCount(events, 1)

  const messageErrors = events.filter((event) => event.event === "messageError")
  assert.equal(messageErrors.length, 1)
  const messageError = messageErrors[0] as { data: { message?: string } }
  assert.equal(messageError.data.message, "The selected model does not exist.")

  await service.sendMessage({ sessionId: "session-1", text: "retry" })
  bridge.emit({
    type: "message.updated",
    properties: { info: { id: "assistant-2", sessionID: "session-1", role: "assistant", error } },
  })

  await waitForMessageErrorCount(events, 2)
  assert.equal(events.filter((event) => event.event === "messageError").length, 2)
})

test("hasActiveGeneration tracks pending and completed assistant turns", async () => {
  const bridge = createBridgeAgent()
  const service = new ChatServiceImpl(bridge.agent)
  captureServiceEvents(service)
  service.startEventBridge()

  assert.equal(service.hasActiveGeneration(), false)

  await service.sendMessage({ sessionId: "session-1", text: "hello" })
  assert.equal(service.hasActiveGeneration(), true)

  bridge.emit({
    type: "message.updated",
    properties: { info: { id: "assistant-1", sessionID: "session-1", role: "assistant" } },
  })
  assert.equal(service.hasActiveGeneration(), true)

  bridge.emit({
    type: "session.idle",
    properties: { sessionID: "session-1" },
  })
  await waitForInactiveGeneration(service)
  assert.equal(service.hasActiveGeneration(), false)
})

test("authorization overlays survive service restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-chat-auth-overlays-"))
  const store = new AuthorizationOverlayStore(root)
  const bridge = createBridgeAgent()
  const service = new ChatServiceImpl(bridge.agent, { authorizationOverlayStore: store })
  captureServiceEvents(service)
  service.startEventBridge()

  bridge.emit({
    type: "message.part.updated",
    properties: {
      part: {
        id: "tool-1",
        sessionID: "session-1",
        messageID: "assistant-1",
        type: "tool",
        callID: "call-1",
        tool: "call_action",
        state: {
          status: "completed",
          input: {},
          output: JSON.stringify({
            status: "authorization_required",
            service: "supabase",
            action: "list_projects",
            displayName: "Supabase",
            errorCode: "connection_required",
          }),
        },
      },
    },
  })

  await vi.waitFor(async () => {
    assert.equal((await store.read()).get("session-1")?.get("assistant-1")?.get("tool-1")?.service, "supabase")
  })

  const restartedBridge = createBridgeAgent()
  const restoredMessage: ChatMessage = {
    id: "assistant-1",
    role: "assistant",
    createdAt: 1,
    parts: [
      {
        kind: "tool",
        partId: "tool-1",
        callId: "call-1",
        tool: "call_action",
        status: "completed",
        input: {},
      },
    ],
  }
  restartedBridge.agent.getMessages = vi.fn(async () => [restoredMessage]) as AgentManager["getMessages"]
  const restarted = new ChatServiceImpl(restartedBridge.agent, { authorizationOverlayStore: store })

  const [message] = await restarted.getMessages("session-1")

  assert.equal(message?.parts[0]?.authorization?.service, "supabase")
  assert.equal(message?.parts[0]?.authorization?.displayName, "Supabase")
})

test("stopGeneration cancels a submitted turn before prompt streaming starts", async () => {
  const bridge = createBridgeAgent()
  let resolveArtifactDir: ((value: string) => void) | undefined
  bridge.createArtifactDir.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        resolveArtifactDir = resolve
      }),
  )
  const service = new ChatServiceImpl(bridge.agent)
  const events = captureServiceEvents(service)

  const sendPromise = service.sendMessage({ sessionId: "session-1", text: "hello" })
  await vi.waitFor(() => {
    assert.equal(bridge.createArtifactDir.mock.calls.length, 1)
  })
  assert.equal(service.hasActiveGeneration(), true)

  await service.stopGeneration("session-1")
  assert.equal(bridge.abort.mock.calls.length, 1)
  assert.equal(events.at(-1)?.event, "generationStopped")
  assert.equal(service.hasActiveGeneration(), false)

  resolveArtifactDir?.(path.join(os.tmpdir(), "wanta-test-artifacts"))
  await sendPromise
  await Promise.resolve()

  assert.equal(bridge.promptStreaming.mock.calls.length, 0)
})

test("sendMessage does not start the OpenCode submit watchdog before prompt streaming starts", async () => {
  vi.useFakeTimers()
  const bridge = createBridgeAgent()
  let resolveArtifactDir: ((value: string) => void) | undefined
  bridge.createArtifactDir.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        resolveArtifactDir = resolve
      }),
  )
  bridge.promptStreaming.mockImplementationOnce(() => new Promise<void>(() => undefined))
  const service = new ChatServiceImpl(bridge.agent)
  const events = captureServiceEvents(service)

  const sendPromise = service.sendMessage({ sessionId: "session-1", text: "hello" })
  await vi.waitFor(() => {
    assert.equal(bridge.createArtifactDir.mock.calls.length, 1)
  })

  await vi.advanceTimersByTimeAsync(45_000)
  assert.equal(service.hasActiveGeneration(), true)
  assert.equal(bridge.abort.mock.calls.length, 0)
  assert.equal(
    events.some((event) => event.event === "messageError"),
    false,
  )

  resolveArtifactDir?.(path.join(os.tmpdir(), "wanta-test-artifacts"))
  await sendPromise
  assert.equal(bridge.promptStreaming.mock.calls.length, 1)

  await vi.advanceTimersByTimeAsync(45_000)
  await vi.waitFor(() => {
    assert.equal(service.hasActiveGeneration(), false)
    assert.equal(events.at(-1)?.event, "messageError")
  })
  const messageError = events.at(-1) as { data: { message?: string }; event: string }
  assert.equal(
    messageError.data.message,
    "CHAT_COMPLETION_INTERRUPTED: Agent runtime did not accept this message. Please retry.",
  )
})

test("sendMessage releases a submitted turn when OpenCode never accepts it", async () => {
  vi.useFakeTimers()
  const bridge = createBridgeAgent()
  bridge.promptStreaming.mockImplementationOnce(() => new Promise<void>(() => undefined))
  const service = new ChatServiceImpl(bridge.agent)
  const events = captureServiceEvents(service)

  await service.sendMessage({ sessionId: "session-1", text: "hello" })
  assert.equal(service.hasActiveGeneration(), true)

  await vi.advanceTimersByTimeAsync(45_000)
  await vi.waitFor(() => {
    assert.equal(service.hasActiveGeneration(), false)
    assert.equal(events.at(-1)?.event, "messageError")
  })

  assert.equal(bridge.abort.mock.calls.length, 1)
  assert.ok(events.some((event) => event.event === "generationInterrupted"))
  assert.equal(
    events.some((event) => event.event === "generationStopped"),
    false,
  )
  const messageError = events.at(-1) as { data: { message?: string }; event: string }
  assert.equal(
    messageError.data.message,
    "CHAT_COMPLETION_INTERRUPTED: Agent runtime did not accept this message. Please retry.",
  )
})

test("sendMessage releases an accepted turn when OpenCode never acknowledges it", async () => {
  vi.useFakeTimers()
  const bridge = createBridgeAgent()
  const service = new ChatServiceImpl(bridge.agent)
  const events = captureServiceEvents(service)

  await service.sendMessage({ sessionId: "session-1", text: "hello" })
  await Promise.resolve()
  assert.equal(service.hasActiveGeneration(), true)

  await vi.advanceTimersByTimeAsync(45_000)
  await vi.waitFor(() => {
    assert.equal(service.hasActiveGeneration(), false)
    assert.equal(events.at(-1)?.event, "messageError")
  })

  assert.equal(bridge.abort.mock.calls.length, 1)
  const interrupted = events.find((event) => event.event === "generationInterrupted") as
    | { data: { reason?: string } }
    | undefined
  assert.equal(interrupted?.data.reason, "start_timeout")
  const messageError = events.at(-1) as { data: { message?: string }; event: string }
  assert.equal(
    messageError.data.message,
    "CHAT_COMPLETION_INTERRUPTED: Agent runtime did not acknowledge this message. Please retry.",
  )
})

test("sendMessage reports a stale turn without stopping it when OpenCode is silent before idle", async () => {
  vi.useFakeTimers()
  const bridge = createBridgeAgent()
  bridge.promptStreaming.mockImplementationOnce(() => new Promise<void>(() => undefined))
  const service = new ChatServiceImpl(bridge.agent)
  const events = captureServiceEvents(service)
  service.startEventBridge()

  await service.sendMessage({ sessionId: "session-1", text: "hello" })
  bridge.emit({
    type: "message.updated",
    properties: { info: { id: "assistant-1", sessionID: "session-1", role: "assistant" } },
  })
  bridge.emit({
    type: "message.part.updated",
    properties: {
      part: {
        id: "tool-1",
        sessionID: "session-1",
        messageID: "assistant-1",
        type: "tool",
        callID: "call-1",
        tool: "search_actions",
        state: { status: "completed", input: {}, output: "{}", time: { start: 1_000, end: 2_000 } },
      },
    },
  })
  assert.equal(service.hasActiveGeneration(), true)

  await vi.advanceTimersByTimeAsync(2 * 60_000)
  assert.equal(service.hasActiveGeneration(), true)
  assert.equal(events.at(-1)?.event, "generationNotice")

  assert.equal(bridge.abort.mock.calls.length, 0)
  assert.equal(
    events.some((event) => event.event === "generationStopped"),
    false,
  )
  assert.equal(
    events.some((event) => event.event === "messageError"),
    false,
  )
  assert.equal(lastEventData<{ kind?: string }>(events).kind, "generation_stale")
})

test("sendMessage keeps a silent running tool alive past the short inactivity timeout", async () => {
  vi.useFakeTimers()
  const bridge = createBridgeAgent()
  bridge.promptStreaming.mockImplementationOnce(() => new Promise<void>(() => undefined))
  const service = new ChatServiceImpl(bridge.agent)
  const events = captureServiceEvents(service)
  service.startEventBridge()

  await service.sendMessage({ sessionId: "session-1", text: "hello" })
  bridge.emit({
    type: "message.updated",
    properties: { info: { id: "assistant-1", sessionID: "session-1", role: "assistant" } },
  })
  bridge.emit({
    type: "message.part.updated",
    properties: {
      part: {
        id: "tool-1",
        sessionID: "session-1",
        messageID: "assistant-1",
        type: "tool",
        callID: "call-1",
        tool: "bash",
        state: { status: "running", input: { command: "sleep 300" }, time: { start: 1_000 } },
      },
    },
  })

  await vi.advanceTimersByTimeAsync(2 * 60_000)
  assert.equal(service.hasActiveGeneration(), true)
  assert.equal(events.at(-1)?.event, "toolCallStarted")

  await vi.advanceTimersByTimeAsync(8 * 60_000)
  assert.equal(service.hasActiveGeneration(), true)
  assert.equal(events.at(-1)?.event, "generationNotice")
  assert.equal(lastEventData<{ kind?: string }>(events).kind, "tool_running_without_output")
  assert.equal(bridge.abort.mock.calls.length, 0)
})

test("answerQuestion restarts inactivity monitoring after a waiting question", async () => {
  vi.useFakeTimers()
  const bridge = createBridgeAgent()
  bridge.promptStreaming.mockImplementationOnce(() => new Promise<void>(() => undefined))
  const service = new ChatServiceImpl(bridge.agent)
  const events = captureServiceEvents(service)
  service.startEventBridge()

  await service.sendMessage({ sessionId: "session-1", text: "hello" })
  bridge.emit({
    type: "message.updated",
    properties: { info: { id: "assistant-1", sessionID: "session-1", role: "assistant" } },
  })
  bridge.emit({
    type: "message.part.updated",
    properties: {
      part: {
        id: "question-tool",
        sessionID: "session-1",
        messageID: "assistant-1",
        type: "tool",
        callID: "question-tool",
        tool: "question",
        state: {
          status: "running",
          input: {
            questions: [{ header: "Title", question: "What title?", options: [] }],
          },
        },
      },
    },
  })
  bridge.emit({
    type: "question.asked",
    properties: {
      id: "question-1",
      sessionID: "session-1",
      questions: [{ header: "Title", question: "What title?", options: [] }],
      tool: { messageID: "assistant-1", callID: "question-tool" },
    },
  })

  await vi.advanceTimersByTimeAsync(10 * 60_000)
  assert.equal(service.hasActiveGeneration(), true)

  await service.answerQuestion({ sessionId: "session-1", requestId: "question-1", answers: [["Test"]] })
  await vi.advanceTimersByTimeAsync(10 * 60_000)
  assert.equal(service.hasActiveGeneration(), true)
  assert.equal(events.at(-1)?.event, "generationNotice")
  assert.equal(lastEventData<{ kind?: string }>(events).kind, "tool_running_without_output")
  assert.equal(bridge.abort.mock.calls.length, 0)
})

test("answerPermission restarts inactivity monitoring after a waiting permission", async () => {
  vi.useFakeTimers()
  const bridge = createBridgeAgent()
  bridge.promptStreaming.mockImplementationOnce(() => new Promise<void>(() => undefined))
  const service = new ChatServiceImpl(bridge.agent)
  const events = captureServiceEvents(service)
  service.startEventBridge()

  await service.sendMessage({ sessionId: "session-1", text: "hello" })
  bridge.emit({
    type: "message.updated",
    properties: { info: { id: "assistant-1", sessionID: "session-1", role: "assistant" } },
  })
  bridge.emit({
    type: "permission.v2.asked",
    properties: {
      id: "permission-1",
      sessionID: "session-1",
      action: "bash",
      resources: ["npm install"],
      metadata: { command: "npm install" },
    },
  })

  await vi.advanceTimersByTimeAsync(2 * 60_000)
  assert.equal(service.hasActiveGeneration(), true)

  await service.answerPermission({ sessionId: "session-1", requestId: "permission-1", reply: "once" })
  await vi.advanceTimersByTimeAsync(2 * 60_000)
  assert.equal(service.hasActiveGeneration(), true)
  assert.equal(events.at(-1)?.event, "generationNotice")
  assert.equal(lastEventData<{ kind?: string }>(events).kind, "generation_stale")
  assert.equal(bridge.abort.mock.calls.length, 0)
})

test("rejectQuestion resolves the waiting question without stopping the generation", async () => {
  const bridge = createBridgeAgent()
  const service = new ChatServiceImpl(bridge.agent)
  service.startEventBridge()

  await service.sendMessage({ sessionId: "session-1", text: "hello" })
  bridge.emit({
    type: "message.updated",
    properties: { info: { id: "assistant-1", sessionID: "session-1", role: "assistant" } },
  })
  bridge.emit({
    type: "message.part.updated",
    properties: {
      part: {
        id: "question-tool",
        sessionID: "session-1",
        messageID: "assistant-1",
        type: "tool",
        callID: "question-tool",
        tool: "question",
        state: { status: "running", input: {} },
      },
    },
  })
  bridge.emit({
    type: "question.asked",
    properties: {
      id: "question-1",
      sessionID: "session-1",
      questions: [{ header: "Title", question: "What title?", options: [] }],
      tool: { messageID: "assistant-1", callID: "question-tool" },
    },
  })
  assert.equal(service.hasActiveGeneration(), true)
  const waitingRun = await service.getActiveRun("session-1")
  assert.equal(waitingRun?.activeAssistantMessageId, "assistant-1")
  assert.deepEqual(waitingRun?.activeToolPartIds, ["question-tool"])
  assert.deepEqual(waitingRun?.blockingRequestIds, ["question-1"])
  assert.equal(waitingRun?.phase, "awaiting_question")
  assert.equal(waitingRun?.sessionId, "session-1")
  assert.deepEqual(waitingRun?.workspace, { type: "personal" })

  await service.rejectQuestion({ sessionId: "session-1", requestId: "question-1" })

  assert.deepEqual(bridge.rejectQuestion.mock.calls, [["session-1", "question-1"]])
  assert.equal(bridge.abort.mock.calls.length, 0)
  assert.equal(service.hasActiveGeneration(), true)
  const activeRun = await service.getActiveRun("session-1")
  assert.equal(activeRun?.phase, "thinking")
  assert.deepEqual(activeRun?.blockingRequestIds, [])
})

test("rejectQuestion does not stop the generation when OpenCode rejects the cancellation", async () => {
  const bridge = createBridgeAgent()
  bridge.rejectQuestion.mockRejectedValueOnce(new Error("reject failed"))
  const service = new ChatServiceImpl(bridge.agent)

  await service.sendMessage({ sessionId: "session-1", text: "hello" })
  assert.equal(service.hasActiveGeneration(), true)

  await assert.rejects(() => service.rejectQuestion({ sessionId: "session-1", requestId: "question-1" }), {
    message: "reject failed",
  })

  assert.equal(bridge.abort.mock.calls.length, 0)
  assert.equal(service.hasActiveGeneration(), true)
})

test("rejectQuestion times out without stopping the generation", async () => {
  vi.useFakeTimers()
  const bridge = createBridgeAgent()
  bridge.rejectQuestion.mockImplementationOnce(() => new Promise<void>(() => undefined))
  const service = new ChatServiceImpl(bridge.agent)

  await service.sendMessage({ sessionId: "session-1", text: "hello" })
  assert.equal(service.hasActiveGeneration(), true)

  const request = service.rejectQuestion({ sessionId: "session-1", requestId: "question-1" })
  const rejection = assert.rejects(request, {
    message: "Timed out (question rejection, 5000ms)",
  })
  await vi.advanceTimersByTimeAsync(5_000)
  await rejection
  assert.equal(bridge.abort.mock.calls.length, 0)
  assert.equal(service.hasActiveGeneration(), true)
})

test("sendMessage passes selected context, organization skills, and project as per-turn system prompt", async () => {
  const bridge = createBridgeAgent()
  const service = new ChatServiceImpl(bridge.agent)

  await service.sendMessage({
    contextMentions: [
      { description: "Generate market-ready assets", id: "ecommerce-image-studio", kind: "skill", name: "Ecommerce" },
      {
        accountLabel: "work",
        appId: "app-1",
        displayName: "Gmail",
        kind: "connection",
        service: "gmail",
      },
    ],
    organizationSkills: [
      {
        description: "Summarize inbound sales mail consistently",
        id: "organization:org-skill-1",
        name: "Sales Mail Summary",
        packageName: "@acme/sales-skills",
        version: "1.2.3",
      },
    ],
    projectContext: {
      id: "project-1",
      name: "wanta",
      path: "/Users/example/code/wanta",
    },
    reasoningLevel: "high",
    mode: "plan",
    sessionId: "session-1",
    text: "summarize new leads",
  })

  assert.equal(bridge.promptStreaming.mock.calls.length, 1)
  const options = bridge.promptStreaming.mock.calls[0]?.[2] as
    | {
        mode?: string
        reasoningLevel?: string
        system?: string
      }
    | undefined
  assert.equal(options?.mode, "plan")
  assert.equal(options?.reasoningLevel, "high")
  assert.match(options?.system ?? "", /Organization-configured skills/)
  assert.match(options?.system ?? "", /Sales Mail Summary/)
  assert.match(options?.system ?? "", /@acme\/sales-skills/)
  assert.match(options?.system ?? "", /User-selected context for this turn/)
  assert.match(options?.system ?? "", /ecommerce-image-studio/)
  assert.match(options?.system ?? "", /gmail/)
  assert.doesNotMatch(options?.system ?? "", /account: "work"/)
  assert.match(options?.system ?? "", /consider the selected connection first/)
  assert.match(options?.system ?? "", /Do not use it for unrelated local files/)
  assert.match(options?.system ?? "", /Current local project context/)
  assert.match(options?.system ?? "", /\/Users\/example\/code\/wanta/)
  assert.match(options?.system ?? "", /use this project directory as an absolute path/)
  assert.match(options?.system ?? "", /Do not mention the full project directory/)
  assert.deepEqual(bridge.createArtifactDir.mock.calls, [["session-1", undefined]])
})

test("build mode stores artifacts under the registered project", async () => {
  const bridge = createBridgeAgent()
  const projectPath = "/Users/example/code/wanta"
  const service = new ChatServiceImpl(bridge.agent, {
    projectStore: projectStore([
      {
        id: "project-1",
        name: "wanta",
        path: projectPath,
        createdAt: 1_000,
        updatedAt: 1_000,
      },
    ]),
  })

  await service.sendMessage({
    projectContext: { id: "project-1", name: "wanta", path: projectPath },
    sessionId: "session-1",
    text: "Create a report",
  })

  assert.deepEqual(bridge.createArtifactDir.mock.calls, [["session-1", projectPath]])
  assert.deepEqual(bridge.artifactSessionDir.mock.calls, [["session-1", projectPath]])
})

test("unregistered project context keeps artifacts in managed storage", async () => {
  const bridge = createBridgeAgent()
  const service = new ChatServiceImpl(bridge.agent)

  await service.sendMessage({
    projectContext: { id: "project-1", name: "wanta", path: "/Users/example/code/wanta" },
    sessionId: "session-1",
    text: "Create a report",
  })

  assert.deepEqual(bridge.createArtifactDir.mock.calls, [["session-1", undefined]])
  assert.deepEqual(bridge.artifactSessionDir.mock.calls, [["session-1", undefined]])
})

test("trusted project permissions are approved without showing a permission card", async () => {
  const bridge = createBridgeAgent()
  const projectPath = "/Users/example/code/wanta"
  const service = new ChatServiceImpl(bridge.agent, {
    projectStore: projectStore([
      {
        id: "project-1",
        name: "wanta",
        path: projectPath,
        createdAt: 1_000,
        updatedAt: 1_000,
      },
    ]),
  })
  const events = captureServiceEvents(service)
  service.startEventBridge()

  await service.sendMessage({
    projectContext: {
      id: "project-1",
      name: "wanta",
      path: projectPath,
    },
    sessionId: "session-1",
    text: "Analyze this project",
  })

  bridge.emit({
    type: "permission.v2.asked",
    properties: {
      id: "permission-1",
      sessionID: "session-1",
      action: "external_directory",
      resources: [`${projectPath}/src`],
      save: [`${projectPath}/*`],
    },
  })
  bridge.emit({
    type: "permission.v2.asked",
    properties: {
      id: "permission-2",
      sessionID: "session-1",
      action: "edit",
      resources: [`${projectPath}/src/main.tsx`],
    },
  })

  await waitForCondition(() => bridge.answerPermission.mock.calls.length === 2)

  assert.deepEqual(bridge.answerPermission.mock.calls, [
    ["session-1", "permission-1", "once"],
    ["session-1", "permission-2", "once"],
  ])
  assert.equal(
    events.some((event) => event.event === "permissionAsked"),
    false,
  )
})

test("trusted project permission approval restarts inactivity monitoring", async () => {
  vi.useFakeTimers()
  const bridge = createBridgeAgent()
  bridge.promptStreaming.mockImplementationOnce(() => new Promise<void>(() => undefined))
  const projectPath = "/Users/example/code/wanta"
  const service = new ChatServiceImpl(bridge.agent, {
    projectStore: projectStore([
      {
        id: "project-1",
        name: "wanta",
        path: projectPath,
        createdAt: 1_000,
        updatedAt: 1_000,
      },
    ]),
  })
  const events = captureServiceEvents(service)
  service.startEventBridge()

  await service.sendMessage({
    projectContext: {
      id: "project-1",
      name: "wanta",
      path: projectPath,
    },
    sessionId: "session-1",
    text: "Analyze this project",
  })
  bridge.emit({
    type: "message.updated",
    properties: { info: { id: "assistant-1", sessionID: "session-1", role: "assistant" } },
  })
  bridge.emit({
    type: "permission.v2.asked",
    properties: {
      id: "permission-1",
      sessionID: "session-1",
      action: "external_directory",
      resources: [`${projectPath}/src`],
      save: [`${projectPath}/*`],
    },
  })

  await vi.waitFor(() => {
    assert.equal(bridge.answerPermission.mock.calls.length, 1)
  })
  await vi.advanceTimersByTimeAsync(2 * 60_000)
  assert.equal(service.hasActiveGeneration(), true)
  assert.equal(events.at(-1)?.event, "generationNotice")
  assert.equal(lastEventData<{ kind?: string }>(events).kind, "generation_stale")
  assert.equal(bridge.abort.mock.calls.length, 0)
})

test("trusted project permissions are approved for task subagent sessions", async () => {
  const bridge = createBridgeAgent()
  const projectPath = "/Users/example/code/wanta"
  const service = new ChatServiceImpl(bridge.agent, {
    projectStore: projectStore([
      {
        id: "project-1",
        name: "wanta",
        path: projectPath,
        createdAt: 1_000,
        updatedAt: 1_000,
      },
    ]),
  })
  const events = captureServiceEvents(service)
  service.startEventBridge()

  await service.sendMessage({
    projectContext: {
      id: "project-1",
      name: "wanta",
      path: projectPath,
    },
    sessionId: "parent-session",
    text: "Analyze this project",
  })

  bridge.emit({
    type: "message.part.updated",
    properties: {
      part: {
        id: "task-1",
        sessionID: "parent-session",
        messageID: "assistant-1",
        type: "tool",
        callID: "call-1",
        tool: "task",
        state: {
          status: "running",
          input: {},
          metadata: {
            parentSessionId: "parent-session",
            sessionId: "child-session",
          },
        },
      },
    },
  })
  bridge.emit({
    type: "permission.v2.asked",
    properties: {
      id: "permission-1",
      sessionID: "child-session",
      action: "external_directory",
      resources: [`${projectPath}/*`],
    },
  })

  await waitForCondition(() => bridge.answerPermission.mock.calls.length === 1)

  assert.deepEqual(bridge.answerPermission.mock.calls, [["child-session", "permission-1", "once"]])
  assert.equal(
    events.some((event) => event.event === "permissionAsked"),
    false,
  )
})

test("task subagent permission prompts pause the parent generation inactivity watchdog", async () => {
  vi.useFakeTimers()
  const bridge = createBridgeAgent()
  bridge.promptStreaming.mockImplementationOnce(() => new Promise<void>(() => undefined))
  const projectPath = "/Users/example/code/wanta"
  const service = new ChatServiceImpl(bridge.agent, {
    projectStore: projectStore([
      {
        id: "project-1",
        name: "wanta",
        path: projectPath,
        createdAt: 1_000,
        updatedAt: 1_000,
      },
    ]),
  })
  const events = captureServiceEvents(service)
  service.startEventBridge()

  await service.sendMessage({
    projectContext: {
      id: "project-1",
      name: "wanta",
      path: projectPath,
    },
    sessionId: "parent-session",
    text: "Analyze this project",
  })
  bridge.emit({
    type: "message.updated",
    properties: { info: { id: "assistant-1", sessionID: "parent-session", role: "assistant" } },
  })
  bridge.emit({
    type: "message.part.updated",
    properties: {
      part: {
        id: "task-1",
        sessionID: "parent-session",
        messageID: "assistant-1",
        type: "tool",
        callID: "call-1",
        tool: "task",
        state: {
          status: "running",
          input: {},
          metadata: {
            parentSessionId: "parent-session",
            sessionId: "child-session",
          },
        },
      },
    },
  })
  bridge.emit({
    type: "permission.v2.asked",
    properties: {
      id: "permission-1",
      sessionID: "child-session",
      action: "external_directory",
      resources: ["/Users/example/.ssh"],
    },
  })

  assert.ok(events.some((event) => event.event === "permissionAsked"))
  await vi.advanceTimersByTimeAsync(10 * 60_000)

  assert.equal(service.hasActiveGeneration(), true)
  assert.equal(bridge.abort.mock.calls.length, 0)
})

test("task subagent activity keeps the parent generation fresh without trusted project context", async () => {
  vi.useFakeTimers()
  const bridge = createBridgeAgent()
  bridge.promptStreaming.mockImplementationOnce(() => new Promise<void>(() => undefined))
  const service = new ChatServiceImpl(bridge.agent)
  const events = captureServiceEvents(service)
  service.startEventBridge()

  await service.sendMessage({ sessionId: "parent-session", text: "Analyze broadly" })
  bridge.emit({
    type: "message.updated",
    properties: { info: { id: "assistant-1", sessionID: "parent-session", role: "assistant" } },
  })
  bridge.emit({
    type: "message.part.updated",
    properties: {
      part: {
        id: "task-1",
        sessionID: "parent-session",
        messageID: "assistant-1",
        type: "tool",
        callID: "call-1",
        tool: "task",
        state: {
          status: "running",
          input: {},
          metadata: {
            parentSessionId: "parent-session",
            sessionId: "child-session",
          },
        },
      },
    },
  })

  await vi.advanceTimersByTimeAsync(9 * 60_000)
  bridge.emit({
    type: "message.updated",
    properties: { info: { id: "child-assistant-1", sessionID: "child-session", role: "assistant" } },
  })
  await vi.advanceTimersByTimeAsync(2 * 60_000)

  assert.equal(service.hasActiveGeneration(), true)
  assert.equal(
    events.some((event) => event.event === "generationNotice"),
    false,
  )

  await vi.advanceTimersByTimeAsync(8 * 60_000)
  assert.equal(events.at(-1)?.event, "generationNotice")
  assert.equal(lastEventData<{ kind?: string }>(events).kind, "tool_running_without_output")
})

test("task subagent abort errors are attributed to the user-stopped parent generation", async () => {
  const bridge = createBridgeAgent()
  const service = new ChatServiceImpl(bridge.agent)
  const events = captureServiceEvents(service)
  service.startEventBridge()

  await service.sendMessage({ sessionId: "parent-session", text: "Analyze broadly" })
  bridge.emit({
    type: "message.updated",
    properties: { info: { id: "assistant-1", sessionID: "parent-session", role: "assistant" } },
  })
  bridge.emit({
    type: "message.part.updated",
    properties: {
      part: {
        id: "task-1",
        sessionID: "parent-session",
        messageID: "assistant-1",
        type: "tool",
        callID: "call-1",
        tool: "task",
        state: {
          status: "running",
          input: {},
          metadata: { parentSessionId: "parent-session", sessionId: "child-session" },
        },
      },
    },
  })
  bridge.abort.mockImplementationOnce(async () => {
    bridge.emit({
      type: "session.error",
      properties: { sessionID: "child-session", error: { name: "AbortError" } },
    })
  })

  await service.stopGeneration("parent-session")
  await waitForCondition(() => events.some((event) => event.event === "generationStopped"))

  assert.equal(
    events.some((event) => event.event === "messageError"),
    false,
  )
  assert.equal(
    events
      .filter((event) => event.event === "generationStopped")
      .every((event) => (event.data as { sessionId?: string }).sessionId === "parent-session"),
    true,
  )
})

test("task subagent permission prompts are displayed on the parent run without trusted project context", async () => {
  vi.useFakeTimers()
  const bridge = createBridgeAgent()
  bridge.promptStreaming.mockImplementationOnce(() => new Promise<void>(() => undefined))
  const service = new ChatServiceImpl(bridge.agent)
  const events = captureServiceEvents(service)
  service.startEventBridge()

  await service.sendMessage({ sessionId: "parent-session", text: "Analyze broadly" })
  bridge.emit({
    type: "message.updated",
    properties: { info: { id: "assistant-1", sessionID: "parent-session", role: "assistant" } },
  })
  bridge.emit({
    type: "message.part.updated",
    properties: {
      part: {
        id: "task-1",
        sessionID: "parent-session",
        messageID: "assistant-1",
        type: "tool",
        callID: "call-1",
        tool: "task",
        state: {
          status: "running",
          input: {},
          metadata: {
            parentSessionId: "parent-session",
            sessionId: "child-session",
          },
        },
      },
    },
  })
  bridge.emit({
    type: "permission.v2.asked",
    properties: {
      id: "permission-1",
      sessionID: "child-session",
      action: "external_directory",
      resources: ["/Users/example"],
    },
  })

  const permissionEvent = events.find((event) => event.event === "permissionAsked") as
    | { data: { request?: { sessionId?: string }; sessionId?: string } }
    | undefined
  assert.equal(permissionEvent?.data.sessionId, "parent-session")
  assert.equal(permissionEvent?.data.request?.sessionId, "parent-session")
  assert.equal((await service.getActiveRun("parent-session"))?.phase, "awaiting_permission")

  await vi.advanceTimersByTimeAsync(10 * 60_000)

  assert.equal(service.hasActiveGeneration(), true)
  assert.equal(
    events.some((event) => event.event === "generationNotice"),
    false,
  )
  assert.equal(bridge.abort.mock.calls.length, 0)
})

test("full access mode propagates to active task subagents and clears their parent-facing permissions", async () => {
  const bridge = createBridgeAgent()
  const service = new ChatServiceImpl(bridge.agent)
  const events = captureServiceEvents(service)
  service.startEventBridge()

  await service.sendMessage({
    permissionMode: "default",
    permissionModeVersion: 1,
    sessionId: "parent-session",
    text: "Analyze broadly",
  })
  bridge.emit({
    type: "message.part.updated",
    properties: {
      part: {
        id: "task-1",
        sessionID: "parent-session",
        messageID: "assistant-1",
        type: "tool",
        callID: "call-1",
        tool: "task",
        state: {
          status: "running",
          input: {},
          metadata: {
            parentSessionId: "parent-session",
            sessionId: "child-session",
          },
        },
      },
    },
  })
  const childPermission = {
    id: "permission-1",
    sessionId: "child-session",
    action: "bash",
    resources: ["npm install"],
    metadata: { command: "npm install" },
  }
  bridge.getPendingPermissions.mockImplementation(async (sessionId: string) =>
    sessionId === "child-session" ? [childPermission] : [],
  )

  assert.deepEqual(await service.getPendingPermissions("parent-session"), [
    { ...childPermission, sessionId: "parent-session" },
  ])
  await service.setPermissionMode({
    permissionMode: "full_access",
    sessionId: "parent-session",
    version: 2,
  })
  await waitForCondition(() => bridge.answerPermission.mock.calls.length === 1)

  assert.deepEqual(bridge.answerPermission.mock.calls, [["child-session", "permission-1", "once"]])
  await waitForCondition(() => events.some((event) => event.event === "permissionReplied"))
  const replied = events.find((event) => event.event === "permissionReplied") as
    | { data: { requestId?: string; sessionId?: string } }
    | undefined
  assert.deepEqual(replied?.data, { requestId: "permission-1", sessionId: "parent-session" })

  bridge.getPendingPermissions.mockResolvedValue([])
  bridge.emit({
    type: "permission.v2.asked",
    properties: {
      id: "permission-2",
      sessionID: "child-session",
      action: "bash",
      resources: ["npm install another-package"],
      metadata: { command: "npm install another-package" },
    },
  })
  await waitForCondition(() => bridge.answerPermission.mock.calls.length === 2)

  assert.deepEqual(bridge.answerPermission.mock.calls[1], ["child-session", "permission-2", "once"])
  assert.equal(
    events.some(
      (event) =>
        event.event === "permissionAsked" &&
        (event.data as { request?: { id?: string } }).request?.id === "permission-2",
    ),
    false,
  )
})

test("trusted project permission approval does not cover paths outside the project", async () => {
  const bridge = createBridgeAgent()
  const projectPath = "/Users/example/code/wanta"
  const service = new ChatServiceImpl(bridge.agent, {
    projectStore: projectStore([
      {
        id: "project-1",
        name: "wanta",
        path: projectPath,
        createdAt: 1_000,
        updatedAt: 1_000,
      },
    ]),
  })
  const events = captureServiceEvents(service)
  service.startEventBridge()

  await service.sendMessage({
    projectContext: {
      id: "project-1",
      name: "wanta",
      path: projectPath,
    },
    sessionId: "session-1",
    text: "Analyze this project",
  })

  bridge.emit({
    type: "permission.v2.asked",
    properties: {
      id: "permission-1",
      sessionID: "session-1",
      action: "external_directory",
      resources: ["/Users/example/.ssh"],
    },
  })

  await waitForCondition(() => events.some((event) => event.event === "permissionAsked"))

  assert.equal(bridge.answerPermission.mock.calls.length, 0)
})

test("trusted project read-only shell commands are approved without showing a permission card", async () => {
  const bridge = createBridgeAgent()
  const projectPath = "/Users/example/code/wanta"
  const service = new ChatServiceImpl(bridge.agent, {
    projectStore: projectStore([
      {
        id: "project-1",
        name: "wanta",
        path: projectPath,
        createdAt: 1_000,
        updatedAt: 1_000,
      },
    ]),
  })
  const events = captureServiceEvents(service)
  service.startEventBridge()

  await service.sendMessage({
    projectContext: {
      id: "project-1",
      name: "wanta",
      path: projectPath,
    },
    sessionId: "session-1",
    text: "Inspect this project",
  })
  bridge.emit({
    type: "permission.v2.asked",
    properties: {
      id: "permission-1",
      sessionID: "session-1",
      action: "bash",
      resources: [`rg "permissionMode" ${projectPath}`],
      metadata: { command: `rg "permissionMode" ${projectPath}` },
    },
  })

  await waitForCondition(() => bridge.answerPermission.mock.calls.length === 1)

  assert.deepEqual(bridge.answerPermission.mock.calls, [["session-1", "permission-1", "once"]])
  assert.equal(
    events.some((event) => event.event === "permissionAsked"),
    false,
  )
})

test("full access permissions are approved in the main process", async () => {
  const bridge = createBridgeAgent()
  const service = new ChatServiceImpl(bridge.agent)
  const events = captureServiceEvents(service)
  service.startEventBridge()

  await service.setPermissionMode({ sessionId: "session-1", permissionMode: "full_access" })
  bridge.emit({
    type: "permission.v2.asked",
    properties: {
      id: "permission-1",
      sessionID: "session-1",
      action: "bash",
      resources: ["npm install"],
      metadata: { command: "npm install" },
    },
  })

  await waitForCondition(() => bridge.answerPermission.mock.calls.length === 1)

  assert.deepEqual(bridge.answerPermission.mock.calls, [["session-1", "permission-1", "once"]])
  assert.equal(
    events.some((event) => event.event === "permissionAsked"),
    false,
  )
})

test("stale permission mode updates do not override newer modes", async () => {
  const bridge = createBridgeAgent()
  const service = new ChatServiceImpl(bridge.agent)
  service.startEventBridge()

  await service.setPermissionMode({ sessionId: "session-1", permissionMode: "full_access", version: 2 })
  await service.setPermissionMode({ sessionId: "session-1", permissionMode: "default", version: 1 })
  bridge.emit({
    type: "permission.v2.asked",
    properties: {
      id: "permission-1",
      sessionID: "session-1",
      action: "bash",
      resources: ["npm install"],
      metadata: { command: "npm install" },
    },
  })

  await waitForCondition(() => bridge.answerPermission.mock.calls.length === 1)

  assert.deepEqual(bridge.answerPermission.mock.calls, [["session-1", "permission-1", "once"]])
})

test("unchanged permission mode updates do not emit session activity", async () => {
  const bridge = createBridgeAgent()
  const service = new ChatServiceImpl(bridge.agent)
  const activities: Array<{ sessionId: string; usedAt: number }> = []
  service.sessionActivity.on((activity) => activities.push(activity))

  await service.setPermissionMode({ sessionId: "session-1", permissionMode: "default", version: 1 })
  await service.setPermissionMode({ sessionId: "session-1", permissionMode: "full_access", version: 2 })
  await service.setPermissionMode({ sessionId: "session-1", permissionMode: "full_access", version: 3 })

  assert.equal(activities.length, 1)
  assert.equal(activities[0]?.sessionId, "session-1")
})

test("automatic permission replies are deduplicated across pending reload and events", async () => {
  const bridge = createBridgeAgent()
  const service = new ChatServiceImpl(bridge.agent)
  const events = captureServiceEvents(service)
  service.startEventBridge()
  await service.setPermissionMode({ sessionId: "session-1", permissionMode: "full_access" })
  let resolveReply: (() => void) | undefined
  bridge.answerPermission.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        resolveReply = resolve
      }),
  )
  bridge.getPendingPermissions.mockResolvedValueOnce([
    {
      id: "permission-1",
      sessionId: "session-1",
      action: "bash",
      resources: ["npm install"],
      metadata: { command: "npm install" },
    },
  ])

  const pending = await service.getPendingPermissions("session-1")
  bridge.emit({
    type: "permission.v2.asked",
    properties: {
      id: "permission-1",
      sessionID: "session-1",
      action: "bash",
      resources: ["npm install"],
      metadata: { command: "npm install" },
    },
  })

  assert.deepEqual(pending, [])
  assert.deepEqual(bridge.answerPermission.mock.calls, [["session-1", "permission-1", "once"]])
  resolveReply?.()
  await waitForCondition(() => events.some((event) => event.event === "permissionReplied"))
})

test("pure oo permissions are approved in the main process", async () => {
  const bridge = createBridgeAgent()
  const service = new ChatServiceImpl(bridge.agent)
  const events = captureServiceEvents(service)
  service.startEventBridge()

  bridge.emit({
    type: "permission.v2.asked",
    properties: {
      id: "permission-1",
      sessionID: "session-1",
      action: "bash",
      resources: ['oo search "gmail" --json'],
    },
  })

  await waitForCondition(() => bridge.answerPermission.mock.calls.length === 1)

  assert.deepEqual(bridge.answerPermission.mock.calls, [["session-1", "permission-1", "once"]])
  assert.equal(
    events.some((event) => event.event === "permissionAsked"),
    false,
  )
})

test("always permission reply stores a main-process session grant", async () => {
  const bridge = createBridgeAgent()
  const service = new ChatServiceImpl(bridge.agent)
  const events = captureServiceEvents(service)
  service.startEventBridge()
  bridge.emit({
    type: "permission.v2.asked",
    properties: {
      id: "permission-1",
      sessionID: "session-1",
      action: "external_directory",
      resources: ["/Users/example"],
    },
  })

  await waitForCondition(() => events.some((event) => event.event === "permissionAsked"))

  await service.answerPermission({ sessionId: "session-1", requestId: "permission-1", reply: "always" })
  bridge.emit({
    type: "permission.v2.asked",
    properties: {
      id: "permission-2",
      sessionID: "session-1",
      action: "external_directory",
      resources: ["/Users/example/Documents/finance/report.xlsx"],
    },
  })

  await waitForCondition(() => bridge.answerPermission.mock.calls.length === 2)

  assert.deepEqual(bridge.answerPermission.mock.calls, [
    ["session-1", "permission-1", "once"],
    ["session-1", "permission-2", "once"],
  ])
  assert.equal(events.filter((event) => event.event === "permissionAsked").length, 1)
  assert.equal(bridge.getPendingPermissions.mock.calls.length, 0)
})

test("managed Python dependency task approval reuses only the active turn environment", async () => {
  const bridge = createBridgeAgent()
  const processRoot = path.join(os.tmpdir(), "wanta-python-task-1")
  bridge.createProcessDir.mockResolvedValue(processRoot)
  const service = new ChatServiceImpl(bridge.agent)
  const events = captureServiceEvents(service)
  service.startEventBridge()
  await service.sendMessage({ sessionId: "session-1", text: "Create a spreadsheet" })

  const command = `${processRoot}/.wanta-python/bin/python -m pip install openpyxl fpdf2`
  bridge.emit({
    type: "permission.v2.asked",
    properties: {
      id: "permission-1",
      sessionID: "session-1",
      action: "bash",
      resources: [command],
      metadata: { command },
    },
  })
  await waitForCondition(() => events.some((event) => event.event === "permissionAsked"))

  await service.answerPermission({ sessionId: "session-1", requestId: "permission-1", reply: "always" })
  bridge.emit({
    type: "permission.v2.asked",
    properties: {
      id: "permission-2",
      sessionID: "session-1",
      action: "bash",
      resources: [`${processRoot}/.wanta-python/bin/python -m pip install openpyxl`],
      metadata: { command: `${processRoot}/.wanta-python/bin/python -m pip install openpyxl` },
    },
  })

  await waitForCondition(() => bridge.answerPermission.mock.calls.length === 2)
  assert.deepEqual(bridge.answerPermission.mock.calls, [
    ["session-1", "permission-1", "once"],
    ["session-1", "permission-2", "once"],
  ])
  assert.equal(events.filter((event) => event.event === "permissionAsked").length, 1)
})

test("default command approvals still prompt unsafe package mutations", async () => {
  const bridge = createBridgeAgent()
  const projectPath = "/Users/example/code/wanta"
  const service = new ChatServiceImpl(bridge.agent, {
    projectStore: projectStore([
      {
        id: "project-1",
        name: "wanta",
        path: projectPath,
        createdAt: 1_000,
        updatedAt: 1_000,
      },
    ]),
  })
  const events = captureServiceEvents(service)
  service.startEventBridge()

  await service.sendMessage({
    projectContext: {
      id: "project-1",
      name: "wanta",
      path: projectPath,
    },
    sessionId: "session-1",
    text: "Run checks",
  })
  bridge.emit({
    type: "permission.v2.asked",
    properties: {
      id: "permission-1",
      sessionID: "session-1",
      action: "bash",
      resources: ["npm test"],
      metadata: { command: "npm test" },
    },
  })
  bridge.emit({
    type: "permission.v2.asked",
    properties: {
      id: "permission-2",
      sessionID: "session-1",
      action: "bash",
      resources: ["pnpm lint"],
      metadata: { command: "pnpm lint" },
    },
  })
  bridge.emit({
    type: "permission.v2.asked",
    properties: {
      id: "permission-3",
      sessionID: "session-1",
      action: "bash",
      resources: ["npm install"],
      metadata: { command: "npm install" },
    },
  })

  await waitForCondition(() => bridge.answerPermission.mock.calls.length === 2)
  await waitForCondition(() => events.filter((event) => event.event === "permissionAsked").length === 1)

  assert.deepEqual(bridge.answerPermission.mock.calls, [
    ["session-1", "permission-1", "once"],
    ["session-1", "permission-2", "once"],
  ])
})

test("project dependency task approval avoids repeated prompts during the active generation", async () => {
  const bridge = createBridgeAgent()
  const projectPath = "/Users/example/code/wanta"
  const service = new ChatServiceImpl(bridge.agent, {
    projectStore: projectStore([
      {
        id: "project-1",
        name: "wanta",
        path: projectPath,
        createdAt: 1_000,
        updatedAt: 1_000,
      },
    ]),
  })
  const events = captureServiceEvents(service)
  service.startEventBridge()

  await service.sendMessage({
    projectContext: { id: "project-1", name: "wanta", path: projectPath },
    sessionId: "session-1",
    text: "Install and use the dependency",
  })
  const install = `cd ${projectPath} && pnpm install`
  bridge.emit({
    type: "permission.v2.asked",
    properties: {
      id: "permission-1",
      sessionID: "session-1",
      action: "bash",
      resources: [install],
      metadata: { command: install },
    },
  })
  await waitForCondition(() => events.some((event) => event.event === "permissionAsked"))

  await service.answerPermission({ sessionId: "session-1", requestId: "permission-1", reply: "always" })
  const addDependency = `cd ${projectPath} && pnpm add zod`
  bridge.emit({
    type: "permission.v2.asked",
    properties: {
      id: "permission-2",
      sessionID: "session-1",
      action: "bash",
      resources: [addDependency],
      metadata: { command: addDependency },
    },
  })

  await waitForCondition(() => bridge.answerPermission.mock.calls.length === 2)
  assert.deepEqual(bridge.answerPermission.mock.calls, [
    ["session-1", "permission-1", "once"],
    ["session-1", "permission-2", "once"],
  ])
  assert.equal(events.filter((event) => event.event === "permissionAsked").length, 1)

  await service.sendMessage({
    projectContext: { id: "project-1", name: "wanta", path: projectPath },
    sessionId: "session-1",
    text: "Start a new task",
  })
  bridge.emit({
    type: "permission.v2.asked",
    properties: {
      id: "permission-3",
      sessionID: "session-1",
      action: "bash",
      resources: [addDependency],
      metadata: { command: addDependency },
    },
  })
  await waitForCondition(() => events.filter((event) => event.event === "permissionAsked").length === 2)
  assert.equal(bridge.answerPermission.mock.calls.length, 2)
})

test("buildContextMentionsSystem returns undefined without selected context", () => {
  assert.equal(buildContextMentionsSystem(undefined), undefined)
  assert.equal(buildContextMentionsSystem([]), undefined)
})

test("resolveLocalArtifacts resolves a registered artifact directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-artifacts-"))
  const artifactRoot = path.join(root, "turn")
  await mkdir(artifactRoot, { recursive: true })
  await writeFile(path.join(artifactRoot, "fresh.png"), "fresh")

  const artifactBundleStore = new ArtifactBundleStore(root)
  const bundle = await buildArtifactBundle({
    artifactRoot,
    completedAt: 2,
    createdAt: 1,
    generatedPreviewCount: 0,
    messageId: "assistant-1",
    sessionId: "session-1",
  })
  assert.ok(bundle)
  const records = new Map()
  recordArtifactBundle(records, bundle)
  await artifactBundleStore.write(records)
  const service = new ChatServiceImpl(null, { artifactBundleStore })
  const result = await service.resolveLocalArtifacts({ artifactRoot })

  assert.equal(result.groups.length, 1)
  assert.equal(result.groups[0]?.root?.path, artifactRoot)
  assert.deepEqual(
    result.groups[0]?.items.map((item) => item.name),
    ["fresh.png"],
  )
})

test("resolveLocalArtifacts reads artifact pack manifests", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-artifacts-manifest-"))
  const artifactRoot = path.join(root, "turn")
  const filesDir = path.join(artifactRoot, "files")
  const supportDir = path.join(artifactRoot, "support")
  await mkdir(filesDir, { recursive: true })
  await mkdir(supportDir, { recursive: true })
  await writeFile(path.join(filesDir, "001.jpg"), "one")
  await writeFile(path.join(filesDir, "002.jpg"), "two")
  await writeFile(path.join(supportDir, "download-summary.md"), "# Summary")
  await writeFile(path.join(root, "outside.jpg"), "outside")
  await writeFile(
    path.join(artifactRoot, ".wanta-artifact.json"),
    JSON.stringify({
      version: 1,
      title: "1688 images",
      kind: "image_set",
      display: "gallery",
      summary: "Downloaded two images.",
      items: [
        { path: "files/002.jpg", role: "primary", order: 2 },
        { path: "files/001.jpg", role: "primary", order: 1 },
        { path: "../outside.jpg", role: "primary", order: 3 },
      ],
      supporting: [{ path: "support/download-summary.md", role: "summary", title: "Download summary" }],
    }),
  )

  const artifactBundleStore = new ArtifactBundleStore(root)
  const bundle = await buildArtifactBundle({
    artifactRoot,
    completedAt: 2,
    createdAt: 1,
    generatedPreviewCount: 0,
    messageId: "assistant-1",
    sessionId: "session-1",
  })
  assert.ok(bundle)
  const records = new Map()
  recordArtifactBundle(records, bundle)
  await artifactBundleStore.write(records)
  const service = new ChatServiceImpl(null, { artifactBundleStore })
  const result = await service.resolveLocalArtifacts({ artifactRoot })

  assert.equal(result.groups.length, 1)
  assert.equal(result.pack?.title, "1688 images")
  assert.equal(result.pack?.kind, "image_set")
  assert.equal(result.pack?.display, "gallery")
  assert.deepEqual(
    result.pack?.items.map((item) => item.name),
    ["001.jpg", "002.jpg"],
  )
  assert.deepEqual(
    result.pack?.supporting.map((item) => [item.name, item.role, item.title]),
    [["download-summary.md", "summary", "Download summary"]],
  )
})

test("resolveLocalArtifacts rejects an unregistered directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-artifacts-untrusted-"))
  try {
    const artifactRoot = path.join(root, "turn")
    await mkdir(artifactRoot, { recursive: true })
    await writeFile(path.join(artifactRoot, "secret.txt"), "secret")

    const service = new ChatServiceImpl(null)
    await assert.rejects(() => service.resolveLocalArtifacts({ artifactRoot }))
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("getLocalArtifactPreview rejects untrusted files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-artifact-preview-untrusted-"))
  try {
    const filePath = path.join(root, "script.py")
    await writeFile(filePath, "print('hello')\n")
    const service = new ChatServiceImpl(null)

    await assert.rejects(() => service.getLocalArtifactPreview({ path: filePath }))
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("getAttachmentPreview rejects untrusted files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-attachment-preview-untrusted-"))
  try {
    const filePath = path.join(root, "image.png")
    await writeFile(filePath, Buffer.from([1, 2, 3]))
    const service = new ChatServiceImpl(null)

    await assert.rejects(() => service.getAttachmentPreview({ path: filePath, mime: "image/png" }))
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("getAttachmentPreview allows user-selected attachment paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-attachment-preview-trusted-"))
  try {
    const filePath = path.join(root, "image.png")
    await writeFile(filePath, Buffer.from([1, 2, 3]))
    const service = new ChatServiceImpl(null, { trustedAttachmentPaths: new Set([filePath]) })

    const result = await service.getAttachmentPreview({ path: filePath, mime: "image/png" })

    assert.equal(result.dataUrl, "data:image/png;base64,AQID")
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("getAttachmentPreview allows attachment paths restored from message history", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-attachment-preview-history-"))
  try {
    const filePath = path.join(root, "image.png")
    await writeFile(filePath, Buffer.from([1, 2, 3]))
    const bridge = createBridgeAgent()
    bridge.getMessages.mockResolvedValue([
      {
        id: "user-1",
        role: "user",
        createdAt: 1,
        parts: [
          {
            kind: "attachment",
            partId: "attachment-1",
            attachment: {
              id: "attachment-1",
              name: "image.png",
              mime: "image/png",
              size: 3,
              path: filePath,
              kind: "file",
            },
          },
        ],
      },
    ])
    const service = new ChatServiceImpl(bridge.agent)

    await service.getMessages("session-1")
    const result = await service.getAttachmentPreview({ path: filePath, mime: "image/png" })

    assert.equal(result.dataUrl, "data:image/png;base64,AQID")
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("getAttachmentPreview allows paths approved by local permission asks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-attachment-preview-permission-"))
  try {
    const sensitiveRoot = path.join(root, ".ssh")
    await mkdir(sensitiveRoot, { recursive: true })
    const filePath = path.join(sensitiveRoot, "image.png")
    await writeFile(filePath, Buffer.from([1, 2, 3]))
    const bridge = createBridgeAgent()
    const service = new ChatServiceImpl(bridge.agent)
    const events = captureServiceEvents(service)
    service.startEventBridge()

    bridge.emit({
      type: "permission.v2.asked",
      properties: {
        id: "permission-1",
        sessionID: "session-1",
        action: "external_directory",
        resources: [sensitiveRoot],
      },
    })
    await waitForCondition(() => events.some((event) => event.event === "permissionAsked"))
    await service.answerPermission({ sessionId: "session-1", requestId: "permission-1", reply: "once" })

    const result = await service.getAttachmentPreview({ path: filePath, mime: "image/png" })

    assert.equal(result.dataUrl, "data:image/png;base64,AQID")
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("getLocalArtifactPreview returns text for code artifacts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-artifact-preview-"))
  const filePath = path.join(root, "script.py")
  await writeFile(filePath, "print('hello')\n")

  const service = new ChatServiceImpl(null, { trustedAttachmentPaths: new Set([root]) })
  const result = await service.getLocalArtifactPreview({ path: filePath })

  assert.equal(result.kind, "text")
  assert.equal(result.mime, "text/plain")
  assert.equal(result.text, "print('hello')\n")
  assert.equal(result.truncated, false)
})

test("getLocalArtifactPreview rejects binary-looking text files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-artifact-preview-"))
  const filePath = path.join(root, "output.txt")
  await writeFile(filePath, Buffer.from([0, 1, 2, 3]))

  const service = new ChatServiceImpl(null, { trustedAttachmentPaths: new Set([root]) })
  const result = await service.getLocalArtifactPreview({ path: filePath })

  assert.equal(result.kind, "unsupported")
  assert.equal(result.mime, "text/plain")
})
