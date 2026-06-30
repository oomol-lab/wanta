import type { AgentManager } from "../agent/manager.ts"
import type { ChatMessage } from "./common.ts"

import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, test, vi } from "vitest"
import { AuthorizationOverlayStore } from "./authorization.ts"
import { buildContextMentionsSystem, ChatServiceImpl, isAbortErrorMessage } from "./node.ts"
import { TurnOutputStore } from "./turn-outputs.ts"

afterEach(() => {
  vi.unstubAllGlobals()
})

function createBridgeAgent(): {
  agent: AgentManager
  abort: ReturnType<typeof vi.fn>
  createArtifactDir: ReturnType<typeof vi.fn>
  createProcessDir: ReturnType<typeof vi.fn>
  emit: (event: { type: string; properties?: Record<string, unknown> }) => void
  promptStreaming: ReturnType<typeof vi.fn>
} {
  let listener: ((event: { type: string; properties?: Record<string, unknown> }) => void) | undefined
  const abort = vi.fn(async () => undefined)
  const createArtifactDir = vi.fn(async () => path.join(os.tmpdir(), "wanta-test-artifacts"))
  const createProcessDir = vi.fn(async () => path.join(os.tmpdir(), "wanta-test-process"))
  const promptStreaming = vi.fn(async () => undefined)
  const agent = {
    isReady: () => true,
    subscribe: (callback: (event: { type: string; properties?: Record<string, unknown> }) => void) => {
      listener = callback
      return () => {
        listener = undefined
      }
    },
    abort,
    createArtifactDir,
    createProcessDir,
    promptStreaming,
    getMessages: vi.fn(async () => []),
  } as unknown as AgentManager
  return {
    agent,
    abort,
    createArtifactDir,
    createProcessDir,
    emit: (event) => listener?.(event),
    promptStreaming,
  }
}

function captureServiceEvents(service: ChatServiceImpl): Array<{ event: string; data: unknown }> {
  const events: Array<{ event: string; data: unknown }> = []
  ;(service as unknown as { send: (event: string, data: unknown) => Promise<void> }).send = async (event, data) => {
    events.push({ event, data })
  }
  return events
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
  await Promise.resolve()

  assert.equal(completed, false)
  resolveScope?.()
  await request
  assert.equal(completed, true)
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
    await waitForEventCount(events, 3)

    const record = (await store.read()).get("session-1")?.get("assistant-1")
    assert.equal(record?.summary.processFileCount, 1)
    assert.equal(record?.files[0]?.name, "create_ppt.js")
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
  await Promise.resolve()

  const messageErrors = events.filter((event) => event.event === "messageError")
  assert.equal(messageErrors.length, 1)
  const messageError = messageErrors[0] as { data: { message?: string } }
  assert.equal(messageError.data.message, "The selected model does not exist.")

  await service.sendMessage({ sessionId: "session-1", text: "retry" })
  bridge.emit({
    type: "message.updated",
    properties: { info: { id: "assistant-2", sessionID: "session-1", role: "assistant", error } },
  })

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
    mode: "plan",
    sessionId: "session-1",
    text: "summarize new leads",
  })

  assert.equal(bridge.promptStreaming.mock.calls.length, 1)
  const options = bridge.promptStreaming.mock.calls[0]?.[2] as { mode?: string; system?: string } | undefined
  assert.equal(options?.mode, "plan")
  assert.match(options?.system ?? "", /Organization-configured skills/)
  assert.match(options?.system ?? "", /Sales Mail Summary/)
  assert.match(options?.system ?? "", /@acme\/sales-skills/)
  assert.match(options?.system ?? "", /User-selected context for this turn/)
  assert.match(options?.system ?? "", /ecommerce-image-studio/)
  assert.match(options?.system ?? "", /gmail/)
  assert.match(options?.system ?? "", /consider the selected connection first/)
  assert.match(options?.system ?? "", /Do not use it for unrelated local files/)
  assert.match(options?.system ?? "", /Current local project context/)
  assert.match(options?.system ?? "", /\/Users\/example\/code\/wanta/)
  assert.match(options?.system ?? "", /use this project directory as an absolute path/)
  assert.match(options?.system ?? "", /Do not mention the full project directory/)
})

test("buildContextMentionsSystem returns undefined without selected context", () => {
  assert.equal(buildContextMentionsSystem(undefined), undefined)
  assert.equal(buildContextMentionsSystem([]), undefined)
})

test("resolveLocalArtifacts resolves an explicit artifact root without scanning unrelated text paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-artifacts-"))
  const artifactRoot = path.join(root, "turn")
  const staleRoot = path.join(root, "stale")
  await mkdir(artifactRoot, { recursive: true })
  await mkdir(staleRoot, { recursive: true })
  await writeFile(path.join(artifactRoot, "fresh.png"), "fresh")
  await writeFile(path.join(staleRoot, "stale.png"), "stale")

  const service = new ChatServiceImpl(null)
  const result = await service.resolveLocalArtifacts({
    artifactRoot,
    text: `ignore ${staleRoot}`,
  })

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

  const service = new ChatServiceImpl(null)
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

test("resolveLocalArtifacts ignores broad directories extracted from assistant text", async () => {
  const service = new ChatServiceImpl(null)
  const result = await service.resolveLocalArtifacts({
    text: "The path separator is `/`, and CI/CD is green.",
  })

  assert.deepEqual(result.groups, [])
})

test("getLocalArtifactPreview returns text for code artifacts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-artifact-preview-"))
  const filePath = path.join(root, "script.py")
  await writeFile(filePath, "print('hello')\n")

  const service = new ChatServiceImpl(null)
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

  const service = new ChatServiceImpl(null)
  const result = await service.getLocalArtifactPreview({ path: filePath })

  assert.equal(result.kind, "unsupported")
  assert.equal(result.mime, "text/plain")
})
