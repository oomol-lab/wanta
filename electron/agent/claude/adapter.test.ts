import type { AgentEvent } from "../contract/event.ts"
import type { ExternalAgentRuntimeStatus } from "../external/probe.ts"
import type { ClaudeCodeAdapterOptions } from "./adapter.ts"
import type {
  Options,
  PermissionUpdate,
  Query,
  SDKMessage,
  SDKUserMessage,
  query,
} from "@anthropic-ai/claude-agent-sdk"

import { mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ClaudeCodeAgentAdapter } from "./adapter.ts"

// The adapter is exercised against a fake queryFn: an async-iterable Query
// stand-in fed by a controllable push stream, with spies for the control
// methods and a recorder for the options and prompt messages it received.

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

function findPermissionAsked(events: AgentEvent[]): Extract<AgentEvent, { event: "permissionAsked" }> | undefined {
  return events.findLast(
    (event): event is Extract<AgentEvent, { event: "permissionAsked" }> => event.event === "permissionAsked",
  )
}

const scratchDirs: string[] = []
const startedAdapters: ClaudeCodeAgentAdapter[] = []

async function createHarness(
  status: ExternalAgentRuntimeStatus = detectedStatus(),
  extras: { hostMcpServers?: ClaudeCodeAdapterOptions["hostMcpServers"]; transcriptDir?: string } = {},
) {
  const scratchRootDir = await mkdtemp(path.join(os.tmpdir(), "wanta-claude-adapter-test-"))
  scratchDirs.push(scratchRootDir)
  const probe = vi.fn(() => Promise.resolve(status))
  const { queryFn, calls } = createFakeQueryFn()
  const adapter = new ClaudeCodeAgentAdapter({
    probe,
    scratchRootDir,
    commandPath: () => Promise.resolve("/fake/path-bin"),
    queryFn,
    hostMcpServers: extras.hostMcpServers,
    ...(extras.transcriptDir ? { transcriptDir: extras.transcriptDir } : {}),
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

describe("ClaudeCodeAgentAdapter", () => {
  it("creates the query lazily on first prompt with the verified option set", async () => {
    const { adapter, calls, scratchRootDir } = await createHarness()

    await adapter.send({ type: "prompt", sessionId, text: "hello" })

    expect(calls).toHaveLength(1)
    const options = calls[0].options
    expect(options.sessionId).toBe(sessionUuid)
    expect(options.cwd).toBe(path.join(scratchRootDir, sessionUuid))
    expect(options.pathToClaudeCodeExecutable).toBe("/fake/claude")
    expect(options.permissionMode).toBe("default")
    expect(options.allowDangerouslySkipPermissions).toBe(true)
    expect(options.includePartialMessages).toBe(true)
    expect(options.env?.["PATH"]).toBe("/fake/path-bin")
    expect(typeof options.canUseTool).toBe("function")
    expect(options.abortController).toBeInstanceOf(AbortController)
    // The scratch cwd is created on demand.
    await expect(stat(path.join(scratchRootDir, sessionUuid))).resolves.toBeTruthy()

    // The prompt is enqueued as a streaming-input SDKUserMessage.
    await vi.waitFor(() => expect(calls[0].fake.promptMessages).toHaveLength(1))
    expect(calls[0].fake.promptMessages[0]).toEqual({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "hello" }] },
      parent_tool_use_id: null,
      session_id: sessionUuid,
    })

    // A second prompt reuses the live query instead of spawning another.
    await adapter.send({ type: "prompt", sessionId, text: "again" })
    expect(calls).toHaveLength(1)
    await vi.waitFor(() => expect(calls[0].fake.promptMessages).toHaveLength(2))
  })

  it("appends attachments as a path-note text block the CLI resolves itself", async () => {
    const { adapter, calls } = await createHarness()
    await adapter.send({
      type: "prompt",
      sessionId,
      text: "read the notes",
      attachments: [
        { id: "att-1", name: "notes.md", mime: "text/markdown", size: 12, path: "/tmp/notes.md" },
        {
          id: "att-2",
          name: "assets",
          mime: "inode/directory",
          size: 0,
          path: "/tmp/raw-assets",
          kind: "directory",
          agentPath: "/tmp/assets",
        },
      ],
    })

    await vi.waitFor(() => expect(calls[0].fake.promptMessages).toHaveLength(1))
    const content = calls[0].fake.promptMessages[0].message.content
    expect(Array.isArray(content) && content).toEqual([
      { type: "text", text: "read the notes" },
      {
        type: "text",
        text: "The user attached the following files for this message. Read them as needed:\n- /tmp/notes.md\n- /tmp/assets (directory)",
      },
    ])
  })

  it("registers Wanta host MCP servers on the native Claude session", async () => {
    const { adapter, calls } = await createHarness(detectedStatus(), {
      hostMcpServers: async () => [
        {
          name: "wanta_link",
          url: "http://127.0.0.1:4321/mcp",
          headers: { Authorization: "Bearer opaque-token" },
        },
      ],
    })
    await adapter.send({ type: "prompt", sessionId, text: "query PostHog" })

    expect(calls[0].options.strictMcpConfig).toBeUndefined()
    expect(calls[0].options.mcpServers).toEqual({
      wanta_link: {
        type: "http",
        url: "http://127.0.0.1:4321/mcp",
        headers: { Authorization: "Bearer opaque-token" },
        alwaysLoad: true,
      },
    })
  })

  it("places dynamic Wanta host context before the user request", async () => {
    const { adapter, calls } = await createHarness()
    await adapter.send({
      type: "prompt",
      sessionId,
      text: "query PostHog",
      system: 'Current-turn Wanta Link workspace: team "team-a".',
    })

    await vi.waitFor(() => expect(calls[0].fake.promptMessages).toHaveLength(1))
    expect(calls[0].fake.promptMessages[0].message.content).toEqual([
      {
        type: "text",
        text: '<wanta_host_context>\nThe following context is supplied by Wanta for this turn and is authoritative for Wanta-managed capabilities.\nCurrent-turn Wanta Link workspace: team "team-a".\n</wanta_host_context>\n\n<user_request>\nquery PostHog\n</user_request>',
      },
    ])
  })

  it("resumes the native session when persisted history exists, instead of recreating the id", async () => {
    // A restored session already owns its deterministic uuid on the CLI side;
    // creating it again fails with "Session ID already in use".
    const transcriptDir = await mkdtemp(path.join(os.tmpdir(), "wanta-claude-transcripts-"))
    scratchDirs.push(transcriptDir)
    await writeFile(
      path.join(transcriptDir, `${sessionUuid}.json`),
      JSON.stringify({
        version: 1,
        messages: [{ id: "u1", role: "user", parts: [{ kind: "text", partId: "u1:text", text: "earlier" }] }],
      }),
    )
    const { adapter, calls } = await createHarness(detectedStatus(), { transcriptDir })
    await adapter.send({ type: "prompt", sessionId, text: "continue" })
    expect(calls[0].options.resume).toBe(sessionUuid)
    expect(calls[0].options.sessionId).toBeUndefined()
  })

  it("falls back to a fresh native session when the resume start fails outright", async () => {
    const transcriptDir = await mkdtemp(path.join(os.tmpdir(), "wanta-claude-transcripts-"))
    scratchDirs.push(transcriptDir)
    await writeFile(
      path.join(transcriptDir, `${sessionUuid}.json`),
      JSON.stringify({
        version: 1,
        messages: [{ id: "u1", role: "user", parts: [{ kind: "text", partId: "u1:text", text: "earlier" }] }],
      }),
    )
    const { adapter, calls, events } = await createHarness(detectedStatus(), { transcriptDir })
    await adapter.send({ type: "prompt", sessionId, text: "continue" })
    expect(calls[0].options.resume).toBe(sessionUuid)
    // The CLI-side session vanished: the query dies before any message.
    calls[0].fake.fail(new Error("Claude Code process exited with code 1"))
    await vi.waitFor(() => expect(events.some((event) => event.event === "agentError")).toBe(true))

    await adapter.send({ type: "prompt", sessionId, text: "retry" })
    expect(calls).toHaveLength(2)
    expect(calls[1].options.sessionId).toBe(sessionUuid)
    expect(calls[1].options.resume).toBeUndefined()
  })

  it("uses outputProjectRoot as cwd when the session has a project", async () => {
    const { adapter, calls, scratchRootDir } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "hi", outputProjectRoot: scratchRootDir })
    expect(calls[0].options.cwd).toBe(scratchRootDir)
  })

  it("does nothing when the prompt signal is already aborted", async () => {
    const { adapter, calls } = await createHarness()
    const controller = new AbortController()
    controller.abort()
    await adapter.send({ type: "prompt", sessionId, text: "hello" }, { signal: controller.signal })
    expect(calls).toHaveLength(0)
  })

  it("rejects the prompt when the binary probe is not detected", async () => {
    const { adapter, calls } = await createHarness({ ...detectedStatus(), binary: { status: "not_found" } })
    await expect(adapter.send({ type: "prompt", sessionId, text: "hello" })).rejects.toThrow(/binary was not found/u)
    expect(calls).toHaveLength(0)
  })

  it("maps full_access to bypassPermissions at creation and live via setPermissionMode", async () => {
    const { adapter, calls } = await createHarness()

    await adapter.applyPermissionMode(sessionId, "full_access")
    await adapter.send({ type: "prompt", sessionId, text: "hello" })
    expect(calls[0].options.permissionMode).toBe("bypassPermissions")

    await adapter.applyPermissionMode(sessionId, "default")
    expect(calls[0].fake.setPermissionMode).toHaveBeenCalledWith("default")
    await adapter.applyPermissionMode(sessionId, "full_access")
    expect(calls[0].fake.setPermissionMode).toHaveBeenCalledWith("bypassPermissions")
  })

  it("maps auto to the SDK classifier mode at creation and live via setPermissionMode", async () => {
    const { adapter, calls } = await createHarness()

    await adapter.applyPermissionMode(sessionId, "auto")
    await adapter.send({ type: "prompt", sessionId, text: "hello" })
    expect(calls[0].options.permissionMode).toBe("auto")

    await adapter.applyPermissionMode(sessionId, "accept_edits")
    expect(calls[0].fake.setPermissionMode).toHaveBeenCalledWith("acceptEdits")
    await adapter.applyPermissionMode(sessionId, "auto")
    expect(calls[0].fake.setPermissionMode).toHaveBeenCalledWith("auto")
  })

  it("emits translated contract events for SDK messages flowing out of the query", async () => {
    const { adapter, events, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "hello" })

    calls[0].fake.push({
      type: "assistant",
      message: { id: "msg_1", type: "message", role: "assistant", content: [{ type: "text", text: "Hi!" }] },
      parent_tool_use_id: null,
      uuid: "aaaaaaaa-0000-4000-8000-000000000001",
      session_id: sessionUuid,
    } as unknown as SDKMessage)
    calls[0].fake.push({ type: "result", subtype: "success", is_error: false } as unknown as SDKMessage)

    await vi.waitFor(() => expect(events.some((event) => event.event === "messageCompleted")).toBe(true))
    expect(events).toEqual([
      // The CLI never echoes live user turns; the adapter synthesizes them so
      // the persisted transcript keeps the user side of the conversation.
      { event: "messageStarted", data: { sessionId, messageId: "claude-code-user-1", role: "user" } },
      {
        event: "messageDelta",
        data: {
          sessionId,
          messageId: "claude-code-user-1",
          partId: "claude-code-user-1:text",
          text: "hello",
          delta: "hello",
        },
      },
      { event: "messageStarted", data: { sessionId, messageId: "msg_1", role: "assistant" } },
      { event: "messageDelta", data: { sessionId, messageId: "msg_1", partId: "msg_1:0", text: "Hi!" } },
      { event: "messageCompleted", data: { sessionId } },
    ])
  })

  it("synthesizes the user turn under the caller-provided message id", async () => {
    const { adapter, events } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "count", messageId: "user-msg-7" })
    expect(events[0]).toEqual({
      event: "messageStarted",
      data: { sessionId, messageId: "user-msg-7", role: "user" },
    })
    expect(events[1]).toEqual({
      event: "messageDelta",
      data: { sessionId, messageId: "user-msg-7", partId: "user-msg-7:text", text: "count", delta: "count" },
    })
  })

  it("round-trips canUseTool through permissionAsked and permission-response replies", async () => {
    const { adapter, events, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "hello" })
    const canUseTool = calls[0].options.canUseTool
    expect(canUseTool).toBeDefined()
    const suggestions: PermissionUpdate[] = [
      { type: "addRules", rules: [{ toolName: "Bash" }], behavior: "allow", destination: "session" },
    ]

    // "once" => allow while preserving the SDK tool input.
    const oncePromise = canUseTool!(
      "Bash",
      { command: "ls -la" },
      {
        signal: new AbortController().signal,
        requestId: "req-1",
        toolUseID: "toolu_1",
        suggestions,
        title: "Claude wants to run ls -la",
        description: "Runs in the project directory",
        displayName: "Run command",
      },
    )
    const asked = findPermissionAsked(events)
    expect(asked).toBeDefined()
    expect(asked?.data).toEqual({
      sessionId,
      request: {
        id: "req-1",
        sessionId,
        action: "Bash",
        resources: ["ls -la"],
        metadata: {
          title: "Claude wants to run ls -la",
          description: "Runs in the project directory",
          displayName: "Run command",
          toolInput: { command: "ls -la" },
        },
      },
    })
    await adapter.send({ type: "permission-response", sessionId, requestId: "req-1", reply: "once" })
    await expect(oncePromise).resolves.toEqual({ behavior: "allow", updatedInput: { command: "ls -la" } })
    expect(events.some((event) => event.event === "permissionReplied" && event.data.requestId === "req-1")).toBe(true)

    // "always" => allow with the SDK's suggested permission updates.
    const alwaysPromise = canUseTool!(
      "Read",
      { file_path: "/tmp/a", extra: 1 },
      {
        signal: new AbortController().signal,
        requestId: "req-2",
        toolUseID: "toolu_2",
        suggestions,
      },
    )
    await adapter.send({ type: "permission-response", sessionId, requestId: "req-2", reply: "always" })
    await expect(alwaysPromise).resolves.toEqual({
      behavior: "allow",
      updatedInput: { file_path: "/tmp/a", extra: 1 },
      updatedPermissions: suggestions,
    })

    // "always" without suggestions still preserves the SDK tool input.
    const bareAlwaysPromise = canUseTool!(
      "Read",
      { file_path: "/tmp/b" },
      {
        signal: new AbortController().signal,
        requestId: "req-3",
        toolUseID: "toolu_3",
      },
    )
    await adapter.send({ type: "permission-response", sessionId, requestId: "req-3", reply: "always" })
    const bareAlways = await bareAlwaysPromise
    expect(bareAlways).toEqual({ behavior: "allow", updatedInput: { file_path: "/tmp/b" } })
    expect(Object.keys(bareAlways ?? {})).toEqual(["behavior", "updatedInput"])

    // "reject" => deny with the user-facing decline message.
    const rejectPromise = canUseTool!(
      "Write",
      { file_path: "/tmp/c" },
      {
        signal: new AbortController().signal,
        requestId: "req-4",
        toolUseID: "toolu_4",
      },
    )
    await adapter.send({ type: "permission-response", sessionId, requestId: "req-4", reply: "reject" })
    await expect(rejectPromise).resolves.toEqual({
      behavior: "deny",
      message: "The user declined this action in Wanta.",
    })
  })

  it("auto-allows Claude Skill loading without surfacing a permission card", async () => {
    const { adapter, events, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "use the PostHog skill" })
    const canUseTool = calls[0].options.canUseTool

    await expect(
      canUseTool!(
        "Skill",
        { skill: "oo-posthog", args: "analyze this week" },
        { signal: new AbortController().signal, requestId: "req-skill", toolUseID: "toolu-skill" },
      ),
    ).resolves.toEqual({
      behavior: "allow",
      updatedInput: { skill: "oo-posthog", args: "analyze this week" },
    })
    expect(events.some((event) => event.event === "permissionAsked")).toBe(false)
  })

  it("marks Claude Wanta MCP permission requests as host-owned", async () => {
    const { adapter, events, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "load a Wanta skill" })
    const canUseTool = calls[0].options.canUseTool
    const permission = canUseTool!(
      "mcp__wanta_skills__load_skill",
      { skill_id: "oo-posthog" },
      { signal: new AbortController().signal, requestId: "req-host", toolUseID: "toolu-host" },
    )

    const asked = findPermissionAsked(events)
    expect(asked?.data.request.metadata).toMatchObject({
      wantaHostTool: "load_skill",
      toolInput: { skill_id: "oo-posthog" },
    })
    await adapter.send({ type: "permission-response", sessionId, requestId: "req-host", reply: "once" })
    await expect(permission).resolves.toEqual({
      behavior: "allow",
      updatedInput: { skill_id: "oo-posthog" },
    })
  })

  it("resolves a parked permission with deny and permissionReplied when the SDK aborts it", async () => {
    const { adapter, events, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "hello" })
    const canUseTool = calls[0].options.canUseTool
    const controller = new AbortController()
    const promise = canUseTool!(
      "Bash",
      { command: "sleep 100" },
      {
        signal: controller.signal,
        requestId: "req-abort",
        toolUseID: "toolu_5",
      },
    )
    controller.abort()
    await expect(promise).resolves.toEqual({ behavior: "deny", message: "Cancelled." })
    expect(events.some((event) => event.event === "permissionReplied" && event.data.requestId === "req-abort")).toBe(
      true,
    )
  })

  it("throws for a permission response with an unknown requestId", async () => {
    const { adapter } = await createHarness()
    await expect(
      adapter.send({ type: "permission-response", sessionId, requestId: "missing", reply: "once" }),
    ).rejects.toThrow(/unknown permission request/u)
  })

  it("collects up to three salient resources from string-typed input keys", async () => {
    const { adapter, events, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "hello" })
    const canUseTool = calls[0].options.canUseTool
    const promise = canUseTool!(
      "Custom",
      { file_path: "/a", path: "/b", command: "c", url: "https://d", pattern: 42 },
      { signal: new AbortController().signal, requestId: "req-res", toolUseID: "toolu_6" },
    )
    const asked = findPermissionAsked(events)
    expect(asked?.data.request.resources).toEqual(["/a", "/b", "c"])
    await adapter.send({ type: "permission-response", sessionId, requestId: "req-res", reply: "reject" })
    await promise
  })

  it("cancel interrupts the live query and tolerates unknown sessions", async () => {
    const { adapter, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "hello" })
    await adapter.send({ type: "cancel", sessionId })
    expect(calls[0].fake.interrupt).toHaveBeenCalledTimes(1)
    await expect(adapter.send({ type: "cancel", sessionId: "wanta-ext:claude-code:unknown" })).resolves.toBeUndefined()
  })

  it("stop closes every live query", async () => {
    const { adapter, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "hello" })
    await adapter.stop()
    expect(calls[0].fake.close).toHaveBeenCalledTimes(1)
  })

  it("forgetSession closes the session query and drops its state", async () => {
    const { adapter, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "hello" })
    adapter.forgetSession(sessionId)
    expect(calls[0].fake.close).toHaveBeenCalledTimes(1)
    // The next prompt creates a fresh query.
    await adapter.send({ type: "prompt", sessionId, text: "hello again" })
    expect(calls).toHaveLength(2)
  })

  it("emits agentError with the login hint when the query loop fails on authentication", async () => {
    const { adapter, events, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "hello" })
    calls[0].fake.fail(new Error("API error: authentication_failed"))
    await vi.waitFor(() => expect(events.some((event) => event.event === "agentError")).toBe(true))
    const errorEvent = events.find(
      (event): event is Extract<AgentEvent, { event: "agentError" }> => event.event === "agentError",
    )
    expect(errorEvent?.data.sessionId).toBe(sessionId)
    expect(errorEvent?.data.message).toContain("authentication_failed")
    expect(errorEvent?.data.message).toContain("Run `claude` in a terminal and sign in")
  })

  it("emits agentError without the login hint for non-auth loop failures", async () => {
    const { adapter, events, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "hello" })
    calls[0].fake.fail(new Error("process exited with code 1"))
    await vi.waitFor(() => expect(events.some((event) => event.event === "agentError")).toBe(true))
    const errorEvent = events.find(
      (event): event is Extract<AgentEvent, { event: "agentError" }> => event.event === "agentError",
    )
    expect(errorEvent?.data.message).toBe("process exited with code 1")
  })

  it("caches the runtime probe for 30 seconds", async () => {
    const { adapter, probe } = await createHarness()
    await adapter.runtimeStatus()
    await adapter.runtimeStatus()
    expect(probe).toHaveBeenCalledTimes(1)
    // The prompt path reuses the cached probe as well.
    await adapter.send({ type: "prompt", sessionId, text: "hello" })
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it("threads prompt-borne agent model and effort into query creation", async () => {
    const { adapter, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "hi", agentModelId: "sonnet", agentEffortId: "high" })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.options.model).toBe("sonnet")
    expect(calls[0]?.options.effort).toBe("high")
  })

  it("applies set-model and set-effort made before the first prompt at session creation", async () => {
    const { adapter, calls } = await createHarness()
    await adapter.send({ type: "set-model", sessionId, modelId: "sonnet" })
    await adapter.send({ type: "set-effort", sessionId, effortId: "low" })
    await adapter.send({ type: "prompt", sessionId, text: "hi" })
    expect(calls[0]?.options.model).toBe("sonnet")
    expect(calls[0]?.options.effort).toBe("low")
  })

  it("switches the live query on set-model and set-effort", async () => {
    const { adapter, calls } = await createHarness()
    await adapter.send({ type: "prompt", sessionId, text: "hi" })
    await adapter.send({ type: "set-model", sessionId, modelId: "haiku" })
    expect(calls[0]?.fake.setModel).toHaveBeenCalledWith("haiku")
    await adapter.send({ type: "set-effort", sessionId, effortId: "xhigh" })
    expect(calls[0]?.fake.applyFlagSettings).toHaveBeenCalledWith({ effortLevel: "xhigh" })
    // Reset must clear the flag layer explicitly: applyFlagSettings is a
    // shallow merge, so {} would silently keep the previous effort in force.
    await adapter.send({ type: "set-effort", sessionId })
    expect(calls[0]?.fake.applyFlagSettings).toHaveBeenLastCalledWith({ effortLevel: null })
  })

  it("rejects unknown effort ids loudly", async () => {
    const { adapter } = await createHarness()
    await expect(adapter.send({ type: "set-effort", sessionId, effortId: "ultra" })).rejects.toThrow(
      'claude-code: unknown effort "ultra"',
    )
  })

  it("exposes the static model and effort catalog on runtime status", async () => {
    const { adapter } = await createHarness()
    const status = await adapter.runtimeStatus()
    expect(status.catalog?.models.map((model) => model.id)).toEqual([
      "default",
      "opus[1m]",
      "claude-fable-5[1m]",
      "sonnet",
      "haiku",
    ])
    // The CLI's "default" entry is what Auto resolves to; the picker captions
    // its Default row with it.
    expect(status.catalog?.defaultModelId).toBe("default")
    expect(status.catalog?.efforts.map((effort) => effort.id)).toEqual(["low", "medium", "high", "xhigh"])
  })
})
