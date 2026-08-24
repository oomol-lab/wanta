import type { AgentEvent } from "../contract/event.ts"
import type { ExternalAgentRuntimeStatus } from "../external/probe.ts"
import type { AcpAdapterOptions, AcpTransport } from "./adapter.ts"
import type {
  AnyMessage,
  InitializeResponse,
  NewSessionRequest,
  NewSessionResponse,
  PermissionOption,
  PromptRequest,
  PromptResponse,
  RequestPermissionResponse,
  SessionUpdate,
  SetSessionModeRequest,
  Stream,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk"

import { agent, PROTOCOL_VERSION, RequestError } from "@agentclientprotocol/sdk"
import { mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { AGENT_PROFILES } from "../contract/profile.ts"
import { AcpAgentAdapter } from "./adapter.ts"
import { ACP_AGENT_REGISTRY } from "./registry.ts"

// Adapter tests against an IN-PROCESS fake ACP agent built with the SDK's
// agent-side builder, wired to the adapter through an in-memory stream pair
// injected via the AcpAdapterOptions.connect test seam. The fake speaks the
// real wire protocol (ndjson-equivalent AnyMessage streams), so schema
// validation on both sides is exercised.

const REGISTRATION = ACP_AGENT_REGISTRY["codex"]
const WANTA_SESSION_ID = "wanta-session-1"

interface FakePromptTurn {
  params: PromptRequest
  sendUpdate: (update: SessionUpdate) => Promise<void>
  requestPermission: (toolCall: ToolCallUpdate, options: PermissionOption[]) => Promise<RequestPermissionResponse>
  /** Resolves when the fake agent receives session/cancel. */
  cancelled: Promise<void>
}

interface FakeAgentBehavior {
  initialize?: Partial<InitializeResponse>
  initializeError?: Error
  failureDetail?: string
  /** Override session/new; may throw (for auth_required scenarios). */
  newSession?: (params: NewSessionRequest) => NewSessionResponse
  /** Drive a prompt turn; defaults to an immediate end_turn. */
  prompt?: (turn: FakePromptTurn) => Promise<PromptResponse>
}

interface FakeAgent {
  connect: () => Promise<AcpTransport>
  connectCount: () => number
  fireExit: (code: number | null) => void
  newSessionRequests: NewSessionRequest[]
  promptRequests: PromptRequest[]
  setModeRequests: SetSessionModeRequest[]
  setConfigOptionRequests: Array<{ sessionId: string; configId: string; value: unknown }>
  setModelRequests: Array<{ sessionId: string; modelId: string }>
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
  const setModeRequests: SetSessionModeRequest[] = []
  const setConfigOptionRequests: Array<{ sessionId: string; configId: string; value: unknown }> = []
  const setModelRequests: Array<{ sessionId: string; modelId: string }> = []
  const closedSessionIds: string[] = []
  const cancelledSessionIds: string[] = []
  const permissionResponses: RequestPermissionResponse[] = []

  const app = agent({ name: "fake-acp-agent" })
    .onRequest("initialize", () => {
      if (behavior.initializeError) {
        throw behavior.initializeError
      }
      return { protocolVersion: PROTOCOL_VERSION, ...behavior.initialize }
    })
    .onRequest("session/new", ({ params }) => {
      newSessionRequests.push(params)
      if (behavior.newSession) {
        return behavior.newSession(params)
      }
      sessionSeq += 1
      return { sessionId: `acp-session-${sessionSeq}` }
    })
    .onRequest("session/set_mode", ({ params }) => {
      setModeRequests.push(params)
      return {}
    })
    .onRequest("session/set_config_option", ({ params }) => {
      setConfigOptionRequests.push(params as { sessionId: string; configId: string; value: unknown })
      return { configOptions: [] }
    })
    .onRequest(
      "session/set_model",
      (params: unknown) => params as { sessionId: string; modelId: string },
      ({ params }) => {
        setModelRequests.push(params)
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
      const cancelled = new Promise<void>((resolve) => {
        cancelResolvers.push(resolve)
      })
      return promptBehavior({
        params,
        sendUpdate: (update) => agentClient.notify("session/update", { sessionId: params.sessionId, update }),
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
        failureDetail: behavior.failureDetail ? () => behavior.failureDetail : undefined,
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
    setModeRequests,
    setConfigOptionRequests,
    setModelRequests,
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
  probe: ReturnType<typeof vi.fn>
  scratchRootDir: string
  events: AgentEvent[]
  waitFor: (predicate: (event: AgentEvent) => boolean) => Promise<AgentEvent>
}

async function createHarness(
  behavior: FakeAgentBehavior = {},
  kind: keyof typeof ACP_AGENT_REGISTRY = "codex",
  hostMcpServers?: AcpAdapterOptions["hostMcpServers"],
  transcriptDir?: string,
): Promise<AdapterHarness> {
  const fake = createFakeAgent(behavior)
  const registration = ACP_AGENT_REGISTRY[kind]
  const scratchRootDir = await mkdtemp(path.join(os.tmpdir(), "acp-adapter-test-"))
  const probe = vi.fn(
    async (): Promise<ExternalAgentRuntimeStatus> => ({
      kind,
      displayName: registration.displayName,
      binary: { status: "detected", path: "/fake/bin/agent", version: "1.0.0" },
      login: { status: "unknown" },
      loginHint: registration.loginHint,
    }),
  )
  const adapter = new AcpAgentAdapter({
    kind,
    registration,
    probe,
    scratchRootDir,
    connect: fake.connect,
    hostMcpServers,
    transcriptDir,
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
  return { adapter, fake, probe, scratchRootDir, events, waitFor }
}

type AgentEventDataByKind = {
  [K in AgentEvent["event"]]: Extract<AgentEvent, { event: K }>["data"]
}

function eventData<K extends AgentEvent["event"]>(event: AgentEvent, kind: K): AgentEventDataByKind[K] {
  if (event.event !== kind) {
    throw new Error(`expected event ${kind}, got ${event.event}`)
  }
  return event.data as AgentEventDataByKind[K]
}

function promptInput(text = "hello agent") {
  return { type: "prompt", sessionId: WANTA_SESSION_ID, text, messageId: "user-1" } as const
}

const permissionOptions: PermissionOption[] = [
  { optionId: "opt-allow-once", name: "Allow once", kind: "allow_once" },
  { optionId: "opt-allow-always", name: "Always allow", kind: "allow_always" },
  { optionId: "opt-reject-once", name: "Reject", kind: "reject_once" },
]

describe("AcpAgentAdapter", () => {
  test("declares its registry-derived identity and capability surface", async () => {
    const harness = await createHarness()
    expect(harness.adapter.kind).toBe("codex")
    expect(harness.adapter.profile).toBe(AGENT_PROFILES["codex"])
    expect(harness.adapter.supportsInput("prompt")).toBe(true)
    expect(harness.adapter.supportsInput("cancel")).toBe(true)
    expect(harness.adapter.supportsInput("permission-response")).toBe(true)
    expect(harness.adapter.supportsInput("question-response")).toBe(false)
  })

  test("caches runtime probes for repeated status queries", async () => {
    const harness = await createHarness()
    await harness.adapter.runtimeStatus()
    await harness.adapter.runtimeStatus()
    expect(harness.probe).toHaveBeenCalledTimes(1)
  })

  test("streams a full turn: user synthesis, chunks, tool pair, completion", async () => {
    const harness = await createHarness({
      prompt: async (turn) => {
        await turn.sendUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello " } })
        await turn.sendUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "world" } })
        await turn.sendUpdate({
          sessionUpdate: "tool_call",
          toolCallId: "call-1",
          title: "Read file",
          kind: "read",
          status: "in_progress",
          rawInput: { path: "/tmp/a.txt" },
        })
        await turn.sendUpdate({
          sessionUpdate: "tool_call_update",
          toolCallId: "call-1",
          status: "completed",
          content: [{ type: "content", content: { type: "text", text: "file body" } }],
        })
        await turn.sendUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done" } })
        return { stopReason: "end_turn" }
      },
    })
    await harness.adapter.send(promptInput())
    // The user turn is synthesized synchronously on submission.
    expect(harness.events.slice(0, 2)).toEqual([
      {
        event: "messageStarted",
        data: { sessionId: WANTA_SESSION_ID, messageId: "user-1", role: "user" },
      },
      {
        event: "messageDelta",
        data: {
          sessionId: WANTA_SESSION_ID,
          messageId: "user-1",
          partId: "user-1:text",
          text: "hello agent",
          delta: "hello agent",
        },
      },
    ])
    await harness.waitFor((event) => event.event === "messageCompleted")
    expect(harness.events.map((event) => event.event)).toEqual([
      "messageStarted",
      "messageDelta",
      "messageStarted",
      "messageDelta",
      "messageDelta",
      "toolCallStarted",
      "toolCallResult",
      "messageStarted",
      "messageDelta",
      "messageCompleted",
    ])
    expect(harness.events[4]).toMatchObject({
      event: "messageDelta",
      data: { text: "Hello world", delta: "world" },
    })
    expect(harness.events[5]).toMatchObject({
      event: "toolCallStarted",
      data: { callId: "call-1", tool: "read", input: { path: "/tmp/a.txt" }, status: "running" },
    })
    expect(harness.events[6]).toMatchObject({
      event: "toolCallResult",
      data: { callId: "call-1", status: "completed", output: "file body" },
    })
    // Every event carries the WANTA session id, never the ACP one.
    for (const event of harness.events) {
      expect((event.data as { sessionId?: string }).sessionId).toBe(WANTA_SESSION_ID)
    }
    // The wire side: one session with the required empty mcpServers, one prompt.
    expect(harness.fake.newSessionRequests).toHaveLength(1)
    expect(harness.fake.newSessionRequests[0]!.mcpServers).toEqual([])
    expect(harness.fake.newSessionRequests[0]!.cwd.startsWith(harness.scratchRootDir)).toBe(true)
    expect(harness.fake.promptRequests[0]!.prompt).toEqual([{ type: "text", text: "hello agent" }])
  })

  test("does not report completion when a failed tool is the final agent step", async () => {
    const harness = await createHarness({
      prompt: async (turn) => {
        await turn.sendUpdate({
          sessionUpdate: "tool_call",
          toolCallId: "call-posthog",
          title: "PostHog list projects",
          kind: "execute",
          status: "in_progress",
          rawInput: { service: "posthog", action: "list_projects" },
        })
        await turn.sendUpdate({
          sessionUpdate: "tool_call_update",
          toolCallId: "call-posthog",
          status: "failed",
          content: [{ type: "content", content: { type: "text", text: "connection unavailable" } }],
        })
        return { stopReason: "end_turn" }
      },
    })

    await harness.adapter.send(promptInput())
    const error = await harness.waitFor((event) => event.event === "agentError")

    expect(eventData(error, "agentError")).toEqual({
      sessionId: WANTA_SESSION_ID,
      message: `${REGISTRATION.displayName} stopped after a tool call without producing a final response.`,
    })
    expect(harness.events.some((event) => event.event === "messageCompleted")).toBe(false)
  })

  test("accepts a final answer after a failed tool so the agent can recover", async () => {
    const harness = await createHarness({
      prompt: async (turn) => {
        await turn.sendUpdate({
          sessionUpdate: "tool_call",
          toolCallId: "call-posthog",
          title: "PostHog list projects",
          kind: "execute",
          status: "in_progress",
          rawInput: { service: "posthog", action: "list_projects" },
        })
        await turn.sendUpdate({
          sessionUpdate: "tool_call_update",
          toolCallId: "call-posthog",
          status: "failed",
          content: [{ type: "content", content: { type: "text", text: "connection unavailable" } }],
        })
        await turn.sendUpdate({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "PostHog is unavailable right now. Please reconnect it and retry." },
        })
        return { stopReason: "end_turn" }
      },
    })

    await harness.adapter.send(promptInput())
    await harness.waitFor((event) => event.event === "messageCompleted")

    expect(harness.events.some((event) => event.event === "agentError")).toBe(false)
  })

  test("does not let a later successful tool hide an unexplained failed tool", async () => {
    const harness = await createHarness({
      prompt: async (turn) => {
        await turn.sendUpdate({
          sessionUpdate: "tool_call",
          toolCallId: "call-posthog",
          title: "PostHog list projects",
          kind: "execute",
          status: "in_progress",
          rawInput: { service: "posthog", action: "list_projects" },
        })
        await turn.sendUpdate({
          sessionUpdate: "tool_call_update",
          toolCallId: "call-posthog",
          status: "failed",
          content: [{ type: "content", content: { type: "text", text: "connection unavailable" } }],
        })
        await turn.sendUpdate({
          sessionUpdate: "tool_call",
          toolCallId: "call-fallback",
          title: "Read cached project list",
          kind: "read",
          status: "in_progress",
          rawInput: { path: "/tmp/projects.json" },
        })
        await turn.sendUpdate({
          sessionUpdate: "tool_call_update",
          toolCallId: "call-fallback",
          status: "completed",
          content: [{ type: "content", content: { type: "text", text: "cached projects" } }],
        })
        return { stopReason: "end_turn" }
      },
    })

    await harness.adapter.send(promptInput())
    await harness.waitFor((event) => event.event === "agentError")

    expect(harness.events.some((event) => event.event === "messageCompleted")).toBe(false)
  })

  test("attachments ride the prompt as resource_link blocks after the text", async () => {
    const harness = await createHarness()
    await harness.adapter.send({
      type: "prompt",
      sessionId: WANTA_SESSION_ID,
      text: "read the notes",
      attachments: [
        { id: "att-1", name: "notes.md", mime: "text/markdown", size: 12, path: "/tmp/notes.md" },
        {
          id: "att-2",
          name: "shot.png",
          mime: "image/png",
          size: 99,
          path: "/tmp/raw.png",
          agentPath: "/tmp/optimized.png",
          agentName: "optimized.png",
          agentMime: "image/png",
        },
      ],
    })
    await harness.waitFor((event) => event.event === "messageCompleted")

    // The agent-optimized copy wins when present; the uri is a file URL the
    // agent resolves with its own tools.
    expect(harness.fake.promptRequests[0]!.prompt).toEqual([
      { type: "text", text: "read the notes" },
      { type: "resource_link", uri: "file:///tmp/notes.md", name: "notes.md", mimeType: "text/markdown" },
      { type: "resource_link", uri: "file:///tmp/optimized.png", name: "optimized.png", mimeType: "image/png" },
    ])
  })

  test("registers the host working directory and stable managed roots on session creation", async () => {
    const harness = await createHarness()
    const projectRoot = path.join(harness.scratchRootDir, "project")
    const artifactRoot = path.join(harness.scratchRootDir, "artifacts", WANTA_SESSION_ID)
    const processRoot = path.join(harness.scratchRootDir, "process", WANTA_SESSION_ID)
    await harness.adapter.send({
      type: "prompt",
      sessionId: WANTA_SESSION_ID,
      text: "create a file",
      workingDirectory: projectRoot,
      additionalDirectories: [projectRoot, artifactRoot, processRoot, artifactRoot],
    })

    expect(harness.fake.newSessionRequests[0]?.cwd).toBe(projectRoot)
    expect(harness.fake.newSessionRequests[0]?.additionalDirectories).toEqual([artifactRoot, processRoot])
  })

  test("registers Wanta host MCP servers on the external ACP session", async () => {
    const harness = await createHarness({}, "codex", async () => [
      {
        name: "wanta_link",
        url: "http://127.0.0.1:4321/mcp",
        headers: { Authorization: "Bearer opaque-token" },
      },
    ])
    await harness.adapter.send({ type: "prompt", sessionId: WANTA_SESSION_ID, text: "query PostHog" })

    expect(harness.fake.newSessionRequests[0]?.mcpServers).toEqual([
      {
        type: "http",
        name: "wanta_link",
        url: "http://127.0.0.1:4321/mcp",
        headers: [{ name: "Authorization", value: "Bearer opaque-token" }],
      },
    ])
  })

  test("Wanta host context precedes the user request without changing transcript text", async () => {
    const harness = await createHarness()
    await harness.adapter.send({
      type: "prompt",
      sessionId: WANTA_SESSION_ID,
      text: "query PostHog",
      system: 'Current-turn Wanta Link workspace: team "team-a".',
    })
    await harness.waitFor((event) => event.event === "messageCompleted")

    expect(harness.fake.promptRequests[0]!.prompt).toEqual([
      {
        type: "text",
        text: '<wanta_host_context>\nThe following context is supplied by Wanta for this turn and is authoritative for Wanta-managed capabilities.\nCurrent-turn Wanta Link workspace: team "team-a".\n</wanta_host_context>\n\n<user_request>\nquery PostHog\n</user_request>',
      },
    ])
    const messages = await harness.adapter.getMessages(WANTA_SESSION_ID)
    expect(messages.find((message) => message.role === "user")?.parts).toEqual([
      expect.objectContaining({ kind: "text", text: "query PostHog" }),
    ])
  })

  test("includes the external Link contract once when wanta_link is registered", async () => {
    const harness = await createHarness({}, "codex", async () => [
      { headers: { Authorization: "Bearer opaque-token" }, name: "wanta_link", url: "http://127.0.0.1:4321/mcp" },
    ])
    await harness.adapter.send({ type: "prompt", sessionId: WANTA_SESSION_ID, text: "query PostHog" })
    await harness.waitFor((event) => event.event === "messageCompleted")

    const first = harness.fake.promptRequests[0]?.prompt[0]
    expect(first && "text" in first ? first.text : "").toContain('<wanta_link_capability_contract version="1">')
    expect(first && "text" in first ? first.text : "").toContain("Do not run oo auth login")

    await harness.adapter.send({ type: "prompt", sessionId: WANTA_SESSION_ID, text: "continue" })
    await harness.waitFor(() => harness.fake.promptRequests.length === 2)
    const second = harness.fake.promptRequests[1]?.prompt[0]
    expect(second && "text" in second ? second.text : "").not.toContain("wanta_link_capability_contract")
  })

  test("restores persisted Wanta conversation context when ACP cannot load a native session", async () => {
    const transcriptDir = await mkdtemp(path.join(os.tmpdir(), "wanta-acp-transcripts-"))
    await writeFile(
      path.join(transcriptDir, `${encodeURIComponent(WANTA_SESSION_ID)}.json`),
      JSON.stringify({
        version: 1,
        messages: [
          { id: "u1", role: "user", parts: [{ kind: "text", partId: "u1:text", text: "earlier request" }] },
          { id: "a1", role: "assistant", parts: [{ kind: "text", partId: "a1:text", text: "earlier answer" }] },
        ],
      }),
      "utf8",
    )
    const harness = await createHarness({}, "codex", undefined, transcriptDir)

    await harness.adapter.send({ type: "prompt", sessionId: WANTA_SESSION_ID, text: "continue" })

    await vi.waitFor(() => expect(harness.fake.promptRequests).toHaveLength(1))
    const block = harness.fake.promptRequests[0]?.prompt[0]
    expect(block?.type).toBe("text")
    expect(block && "text" in block ? block.text : "").toContain("<wanta_restored_conversation>")
    expect(block && "text" in block ? block.text : "").toContain("earlier request")
    expect(block && "text" in block ? block.text : "").toContain("earlier answer")
    expect(block && "text" in block ? block.text : "").toMatch(/<\/wanta_restored_conversation>\n\ncontinue$/u)
  })

  test.each([
    ["once", "opt-allow-once"],
    ["always", "opt-allow-always"],
    ["reject", "opt-reject-once"],
  ] as const)("permission round trip: reply %s selects %s", async (reply, expectedOptionId) => {
    const harness = await createHarness({
      prompt: async (turn) => {
        await turn.requestPermission(
          {
            toolCallId: "call-1",
            title: "Write file",
            rawInput: { path: "/tmp/x" },
            locations: [{ path: "/tmp/x" }, { path: "/tmp/y" }],
          },
          permissionOptions,
        )
        return { stopReason: "end_turn" }
      },
    })
    await harness.adapter.send(promptInput())
    const asked = await harness.waitFor((event) => event.event === "permissionAsked")
    const request = eventData(asked, "permissionAsked").request
    expect(request.id).toMatch(/^acp-perm-\d+$/u)
    expect(request.sessionId).toBe(WANTA_SESSION_ID)
    expect(request.action).toBe("Write file")
    expect(request.resources).toEqual(["/tmp/x", "/tmp/y"])
    expect(request.metadata).toEqual({
      options: permissionOptions,
      toolCallId: "call-1",
      rawInput: { path: "/tmp/x" },
    })
    await harness.adapter.send({
      type: "permission-response",
      sessionId: WANTA_SESSION_ID,
      requestId: request.id,
      reply,
    })
    await harness.waitFor((event) => event.event === "permissionReplied")
    await harness.waitFor((event) => event.event === "messageCompleted")
    expect(harness.fake.permissionResponses).toEqual([{ outcome: { outcome: "selected", optionId: expectedOptionId } }])
  })

  test("correlates a generic codex permission request with its live Wanta MCP tool call", async () => {
    const harness = await createHarness(
      {
        prompt: async (turn) => {
          await turn.sendUpdate({
            sessionUpdate: "tool_call",
            toolCallId: "call-link",
            title: "mcp.wanta_link.call_action",
            kind: "execute",
            rawInput: {
              server: "wanta_link",
              tool: "call_action",
              arguments: { service: "posthog", action: "list_projects" },
            },
          })
          await turn.requestPermission({ toolCallId: "call-link" }, permissionOptions)
          await turn.sendUpdate({
            sessionUpdate: "tool_call_update",
            toolCallId: "call-link",
            status: "completed",
            content: [{ type: "content", content: { type: "text", text: "projects listed" } }],
          })
          return { stopReason: "end_turn" }
        },
      },
      "codex",
      async () => [{ headers: {}, name: "wanta_link", url: "http://127.0.0.1/mcp" }],
    )
    await harness.adapter.send(promptInput())
    const asked = await harness.waitFor((event) => event.event === "permissionAsked")
    const request = eventData(asked, "permissionAsked").request
    expect(request.metadata).toMatchObject({ toolCallId: "call-link", wantaHostTool: "call_action" })
    await harness.adapter.send({
      type: "permission-response",
      sessionId: WANTA_SESSION_ID,
      requestId: request.id,
      reply: "once",
    })
    await harness.waitFor((event) => event.event === "messageCompleted")
  })

  test("cancel answers a pending permission with the cancelled outcome", async () => {
    const harness = await createHarness({
      prompt: async (turn) => {
        await turn.requestPermission({ toolCallId: "call-1", title: "Delete file" }, permissionOptions)
        await turn.cancelled
        return { stopReason: "cancelled" }
      },
    })
    await harness.adapter.send(promptInput())
    const asked = await harness.waitFor((event) => event.event === "permissionAsked")
    await harness.adapter.send({ type: "cancel", sessionId: WANTA_SESSION_ID })
    const replied = await harness.waitFor((event) => event.event === "permissionReplied")
    expect(eventData(replied, "permissionReplied").requestId).toBe(eventData(asked, "permissionAsked").request.id)
    await harness.waitFor((event) => event.event === "messageCompleted")
    expect(harness.fake.permissionResponses).toEqual([{ outcome: { outcome: "cancelled" } }])
    expect(harness.fake.cancelledSessionIds).toEqual(["acp-session-1"])
  })

  test("stop settles a parked permission request with the cancelled outcome", async () => {
    const harness = await createHarness({
      prompt: async (turn) => {
        await turn.requestPermission({ toolCallId: "call-1", title: "Delete file" }, permissionOptions)
        return { stopReason: "end_turn" }
      },
    })
    await harness.adapter.send(promptInput())
    await harness.waitFor((event) => event.event === "permissionAsked")
    await harness.adapter.stop()
    const replies = harness.events.filter((event) => event.event === "permissionReplied")
    expect(replies).toHaveLength(1)
    await vi.waitFor(() => {
      expect(harness.fake.permissionResponses).toEqual([{ outcome: { outcome: "cancelled" } }])
    })
  })

  test("auth_required on session/new rejects the send and reports the login hint", async () => {
    const harness = await createHarness({
      newSession: () => {
        throw RequestError.authRequired()
      },
    })
    const expectedMessage = `${REGISTRATION.displayName} requires sign-in. ${REGISTRATION.loginHint}`
    await expect(harness.adapter.send(promptInput())).rejects.toThrow(expectedMessage)
    const error = await harness.waitFor((event) => event.event === "agentError")
    expect(eventData(error, "agentError")).toEqual({ sessionId: WANTA_SESSION_ID, message: expectedMessage })
  })

  test("a protocol version mismatch closes the connection with a clear error", async () => {
    const harness = await createHarness({
      initialize: { protocolVersion: (PROTOCOL_VERSION as number) + 1 },
    })
    await expect(harness.adapter.send(promptInput())).rejects.toThrow(/protocol version/u)
    const error = await harness.waitFor((event) => event.event === "agentError")
    const message = eventData(error, "agentError").message
    expect(message).toContain(`${(PROTOCOL_VERSION as number) + 1}`)
    expect(message).toContain(`${PROTOCOL_VERSION}`)
    expect(harness.fake.newSessionRequests).toHaveLength(0)
  })

  test.each(["codex", "grok"] as const)(
    "%s initialize failure includes the captured subprocess detail",
    async (kind) => {
      const registration = ACP_AGENT_REGISTRY[kind]
      const harness = await createHarness(
        {
          initializeError: new Error("ACP connection closed"),
          failureDetail: "Error: native ACP process failed during startup",
        },
        kind,
      )

      await expect(harness.adapter.send(promptInput())).rejects.toThrow(
        "ACP subprocess: Error: native ACP process failed during startup",
      )
      const error = await harness.waitFor((event) => event.event === "agentError")
      expect(eventData(error, "agentError").message).toContain(registration.displayName)
      expect(eventData(error, "agentError").message).toContain("native ACP process failed during startup")
    },
  )

  test("an unknown permission requestId is rejected loudly", async () => {
    const harness = await createHarness()
    await expect(
      harness.adapter.send({
        type: "permission-response",
        sessionId: WANTA_SESSION_ID,
        requestId: "acp-perm-unknown",
        reply: "once",
      }),
    ).rejects.toThrow("codex: unknown permission request acp-perm-unknown")
  })

  test("subprocess exit fails the in-flight turn and the next prompt respawns", async () => {
    let promptCalls = 0
    const harness = await createHarness({
      prompt: async (turn) => {
        promptCalls += 1
        if (promptCalls === 1) {
          await turn.sendUpdate({
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "working..." },
          })
          // Simulate a crash mid-turn: never resolve.
          return new Promise<PromptResponse>(() => {})
        }
        return { stopReason: "end_turn" }
      },
    })
    await harness.adapter.send(promptInput())
    await harness.waitFor((event) => event.event === "messageDelta" && event.data.text === "working...")
    harness.fake.fireExit(1)
    const error = await harness.waitFor((event) => event.event === "agentError")
    expect(eventData(error, "agentError")).toEqual({
      sessionId: WANTA_SESSION_ID,
      message: `${REGISTRATION.displayName} exited unexpectedly`,
    })
    // The connection was cleared: the next prompt respawns and opens a fresh ACP session.
    await harness.adapter.send(promptInput("second try"))
    await harness.waitFor((event) => event.event === "messageCompleted")
    expect(harness.fake.connectCount()).toBe(2)
    expect(harness.fake.newSessionRequests).toHaveLength(2)
  })

  test("applyPermissionMode projects full access onto the advertised session mode", async () => {
    const harness = await createHarness({
      newSession: () => ({
        sessionId: "acp-session-1",
        modes: {
          currentModeId: "default",
          availableModes: [
            { id: "agent", name: "Agent" },
            { id: "agent-full-access", name: "Full access" },
          ],
        },
      }),
    })
    await harness.adapter.send(promptInput())
    await harness.waitFor((event) => event.event === "messageCompleted")
    await harness.adapter.applyPermissionMode(WANTA_SESSION_ID, "full_access")
    await harness.adapter.applyPermissionMode(WANTA_SESSION_ID, "default")
    expect(harness.fake.setModeRequests.map((request) => request.modeId)).toEqual(["agent-full-access", "agent"])
    expect(harness.fake.setModeRequests.every((request) => request.sessionId === "acp-session-1")).toBe(true)
  })

  test("applyPermissionMode fails closed when the session does not advertise the mode", async () => {
    const harness = await createHarness()
    await harness.adapter.send(promptInput())
    await harness.waitFor((event) => event.event === "messageCompleted")
    await expect(harness.adapter.applyPermissionMode(WANTA_SESSION_ID, "full_access")).rejects.toThrow(
      /permission mode "full_access" is not available/u,
    )
    expect(harness.fake.setModeRequests).toEqual([])
  })

  test("forgetSession drops the ACP mapping so a new ACP session is opened", async () => {
    const harness = await createHarness()
    await harness.adapter.send(promptInput())
    await harness.waitFor((event) => event.event === "messageCompleted")
    harness.adapter.forgetSession(WANTA_SESSION_ID)
    await harness.adapter.send(promptInput("again"))
    await harness.waitFor((event) => event.event === "messageCompleted" && harness.fake.promptRequests.length === 2)
    expect(harness.fake.newSessionRequests).toHaveLength(2)
    // Same subprocess: forgetting a session must not tear down the connection.
    expect(harness.fake.connectCount()).toBe(1)
  })

  test("session config options populate the catalog and set-model switches the live session", async () => {
    const configOptions = [
      {
        id: "model",
        name: "Model",
        type: "select",
        category: "model",
        currentValue: "gpt-5.2-codex",
        options: [
          { value: "gpt-5.2-codex", name: "GPT-5.2 Codex" },
          { value: "gpt-5.2", name: "GPT-5.2" },
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
    const harness = await createHarness(
      { newSession: () => ({ sessionId: "acp-session-1", configOptions }) as never },
      "codex",
    )
    await harness.adapter.send(promptInput())
    const status = await harness.adapter.runtimeStatus()
    expect(status.catalog?.models.map((model) => model.id)).toEqual(["gpt-5.2-codex", "gpt-5.2"])
    expect(status.catalog?.defaultModelId).toBe("gpt-5.2-codex")
    expect(status.catalog?.efforts.map((effort) => effort.id)).toEqual(["low", "medium", "high"])

    await harness.adapter.send({ type: "set-model", sessionId: WANTA_SESSION_ID, modelId: "gpt-5.2" })
    expect(harness.fake.setConfigOptionRequests).toEqual([
      expect.objectContaining({ configId: "model", value: "gpt-5.2" }),
    ])
    await harness.adapter.send({ type: "set-effort", sessionId: WANTA_SESSION_ID, effortId: "high" })
    expect(harness.fake.setConfigOptionRequests.at(-1)).toEqual(
      expect.objectContaining({ configId: "reasoning_effort", value: "high" }),
    )
  })

  test("a model chosen before the session exists applies right after session creation", async () => {
    const configOptions = [
      {
        id: "model",
        name: "Model",
        type: "select",
        category: "model",
        currentValue: "gpt-5.2-codex",
        options: [
          { value: "gpt-5.2-codex", name: "GPT-5.2 Codex" },
          { value: "gpt-5.2", name: "GPT-5.2" },
        ],
      },
    ]
    const harness = await createHarness(
      { newSession: () => ({ sessionId: "acp-session-1", configOptions }) as never },
      "codex",
    )
    await harness.adapter.send({ type: "set-model", sessionId: WANTA_SESSION_ID, modelId: "gpt-5.2" })
    expect(harness.fake.setConfigOptionRequests).toHaveLength(0)
    await harness.adapter.send(promptInput())
    expect(harness.fake.setConfigOptionRequests).toEqual([
      expect.objectContaining({ configId: "model", value: "gpt-5.2" }),
    ])
  })

  test("usage_update translates to a usageUpdated event with total and context window", async () => {
    const harness = await createHarness({
      prompt: async (turn) => {
        await turn.sendUpdate({ sessionUpdate: "usage_update", used: 1234, size: 272_000 } as SessionUpdate)
        await turn.sendUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ok" } })
        return { stopReason: "end_turn" }
      },
    })
    await harness.adapter.send(promptInput())
    const usage = await harness.waitFor((event) => event.event === "usageUpdated")
    expect(eventData(usage, "usageUpdated").tokenUsage).toMatchObject({ total: 1234, contextWindow: 272_000 })
  })

  test("unstable models shape populates the catalog and set-model uses session/set_model", async () => {
    const harness = await createHarness({
      newSession: () =>
        ({
          sessionId: "acp-session-1",
          models: {
            currentModelId: "gpt-5.6-sol[xhigh]",
            availableModels: [
              { modelId: "gpt-5.6-sol[xhigh]", name: "GPT-5.6-Sol (xhigh)" },
              { modelId: "gpt-5.6-luna[low]", name: "GPT-5.6-Luna (low)", description: "Fast and affordable" },
            ],
          },
        }) as never,
    })
    await harness.adapter.send(promptInput())
    const status = await harness.adapter.runtimeStatus()
    expect(status.catalog?.models.map((model) => model.id)).toEqual(["gpt-5.6-sol[xhigh]", "gpt-5.6-luna[low]"])
    expect(status.catalog?.defaultModelId).toBe("gpt-5.6-sol[xhigh]")
    await harness.adapter.send({ type: "set-model", sessionId: WANTA_SESSION_ID, modelId: "gpt-5.6-luna[low]" })
    expect(harness.fake.setModelRequests).toEqual([
      expect.objectContaining({ sessionId: "acp-session-1", modelId: "gpt-5.6-luna[low]" }),
    ])
    expect(harness.fake.setConfigOptionRequests).toHaveLength(0)
  })

  test("warmCatalog opens and closes a throwaway session to pre-populate models", async () => {
    const harness = await createHarness({
      newSession: () =>
        ({
          sessionId: "acp-warm-1",
          models: {
            currentModelId: "gpt-5.6-sol[xhigh]",
            availableModels: [{ modelId: "gpt-5.6-sol[xhigh]", name: "GPT-5.6-Sol (xhigh)" }],
          },
        }) as never,
    })
    await harness.adapter.warmCatalog()
    const status = await harness.adapter.runtimeStatus()
    expect(status.catalog?.models.map((model) => model.id)).toEqual(["gpt-5.6-sol[xhigh]"])
    expect(harness.fake.closedSessionIds).toEqual(["acp-warm-1"])
    // A second warm is a no-op once the catalog is populated.
    await harness.adapter.warmCatalog()
    expect(harness.fake.newSessionRequests).toHaveLength(1)
  })

  test("permission modes map onto advertised session modes via the registry map", async () => {
    const harness = await createHarness({
      newSession: () => ({
        sessionId: "acp-session-1",
        modes: {
          currentModeId: "agent",
          availableModes: [
            { id: "read-only", name: "Read only" },
            { id: "agent", name: "Agent" },
            { id: "agent-full-access", name: "Full access" },
          ],
        },
      }),
    })
    await harness.adapter.send(promptInput())
    await harness.adapter.applyPermissionMode(WANTA_SESSION_ID, "read_only")
    expect(harness.fake.setModeRequests.at(-1)).toEqual(expect.objectContaining({ modeId: "read-only" }))
    await harness.adapter.applyPermissionMode(WANTA_SESSION_ID, "default")
    expect(harness.fake.setModeRequests.at(-1)).toEqual(expect.objectContaining({ modeId: "agent" }))
  })
})
