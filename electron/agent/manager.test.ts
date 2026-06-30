import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AgentManager, isUserVisibleSession } from "./manager.ts"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("AgentManager", () => {
  it("hides OpenCode subagent sessions from the user task list", () => {
    expect(isUserVisibleSession({ id: "root", title: "Root" })).toBe(true)
    expect(isUserVisibleSession({ id: "child", parentID: "root", title: "Child" })).toBe(false)
    expect(isUserVisibleSession({ id: "child", parentId: "root", title: "Child" })).toBe(false)
    expect(isUserVisibleSession({ id: "child", parent_id: "root", title: "Child" })).toBe(false)
  })

  it("reads visible sessions across cursor pages", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          data: [
            { id: "newer", title: "Newer", time: { created: 10, updated: 20 } },
            { id: "child", parentID: "newer", title: "Child", time: { created: 11, updated: 21 } },
          ],
          cursor: { next: "page-2" },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: [{ id: "older", title: "Older", time: { created: 1, updated: 2 } }],
          cursor: {},
        },
      })
    const manager = new AgentManager({
      authToken: "test",
      opencodeBinPath: "/tmp/opencode",
      ooBinPath: "/tmp/oo",
      rootDir: "/tmp/wanta-agent",
    })
    ;(manager as unknown as { sidecar: unknown; started: boolean; workspaceDir: string }).sidecar = {
      client: { v2: { session: { list } } },
    }
    ;(manager as unknown as { started: boolean; workspaceDir: string }).started = true
    ;(manager as unknown as { workspaceDir: string }).workspaceDir = "/tmp/wanta-agent/workspace"

    await expect(manager.listSessions()).resolves.toEqual([
      { id: "newer", title: "Newer", createdAt: 10, updatedAt: 20 },
      { id: "older", title: "Older", createdAt: 1, updatedAt: 2 },
    ])
    expect(list).toHaveBeenNthCalledWith(1, { directory: "/tmp/wanta-agent/workspace", order: "desc", limit: 200 })
    expect(list).toHaveBeenNthCalledWith(2, { directory: "/tmp/wanta-agent/workspace", cursor: "page-2", limit: 200 })
  })

  it("aborts the backend session in the active workspace", async () => {
    const abort = vi.fn(async () => ({ data: true }))
    const manager = new AgentManager({
      authToken: "test",
      opencodeBinPath: "/tmp/opencode",
      ooBinPath: "/tmp/oo",
      rootDir: "/tmp/wanta-agent",
    })
    ;(manager as unknown as { sidecar: unknown; workspaceDir: string }).sidecar = {
      client: { session: { abort } },
    }
    ;(manager as unknown as { workspaceDir: string }).workspaceDir = "/tmp/wanta-agent/workspace"

    await manager.abort("session-1")

    expect(abort).toHaveBeenCalledWith({ sessionID: "session-1", directory: "/tmp/wanta-agent/workspace" })
  })

  it("frames connected providers as authorization awareness only", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "wanta-agent-"))
    try {
      const manager = new AgentManager({
        authToken: "test",
        opencodeBinPath: "/tmp/opencode",
        ooBinPath: "/tmp/oo",
        rootDir,
      })
      manager.listAuthorizedServices = async () => ["gmail", "slack"]

      const system = await manager.buildAuthorizedSystem()

      expect(system).toContain("Some Link providers are already authorized")
      expect(system).toContain("availability awareness only")
      expect(system).toContain("not a recommendation to use Link tools")
      expect(system).toContain("search results include whether a provider is authenticated")
      expect(system).toContain("concrete URLs")
      expect(system).not.toContain("gmail")
      expect(system).not.toContain("slack")
    } finally {
      await rm(rootDir, { force: true, recursive: true })
    }
  })

  it("keeps artifact directories inside the artifacts root", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "wanta-agent-"))
    try {
      const manager = new AgentManager({
        authToken: "test",
        opencodeBinPath: "/tmp/opencode",
        ooBinPath: "/tmp/oo",
        rootDir,
      })

      const dir = await manager.createArtifactDir("..")
      const artifactsRoot = path.resolve(rootDir, "artifacts")
      const relative = path.relative(artifactsRoot, dir)

      expect(relative).not.toBe("..")
      expect(relative.startsWith(`..${path.sep}`)).toBe(false)
      expect(path.isAbsolute(relative)).toBe(false)
    } finally {
      await rm(rootDir, { force: true, recursive: true })
    }
  })

  it("passes OpenCode agent names and reasoning variants through V2 session APIs", async () => {
    const switchAgent = vi.fn(async () => ({ data: undefined }))
    const switchModel = vi.fn(async () => ({ data: undefined }))
    const prompt = vi.fn(async () => ({ data: undefined }))
    const wait = vi.fn(async () => ({ data: undefined }))
    const manager = new AgentManager({
      authToken: "test",
      opencodeBinPath: "/tmp/opencode",
      ooBinPath: "/tmp/oo",
      rootDir: "/tmp/wanta-agent",
    })
    ;(manager as unknown as { sidecar: unknown }).sidecar = {
      client: { v2: { session: { prompt, switchAgent, switchModel, wait } } },
    }
    manager.buildAuthorizedSystem = async () => undefined

    await manager.promptStreaming("session-1", "plan it", { mode: "plan", reasoningLevel: "high" })
    await manager.promptStreaming("session-1", "build it", { reasoningLevel: "medium" })
    await manager.promptStreaming("session-1", "default reasoning", { reasoningLevel: "default" })

    const agentCalls = switchAgent.mock.calls as unknown as Array<[{ sessionID: string; agent: string }]>
    const modelCalls = switchModel.mock.calls as unknown as Array<
      [{ sessionID: string; model: { id: string; providerID: string; variant?: string } }]
    >
    const promptCalls = prompt.mock.calls as unknown as Array<
      [
        {
          delivery: string
          prompt: { text: string }
          resume: boolean
          sessionID: string
        },
      ]
    >

    expect(agentCalls[0]?.[0]).toEqual({ sessionID: "session-1", agent: "plan" })
    expect(agentCalls[1]?.[0]).toEqual({ sessionID: "session-1", agent: "build" })
    expect(modelCalls[0]?.[0].model.variant).toBe("high")
    expect(modelCalls[1]?.[0].model.variant).toBe("medium")
    expect(modelCalls[2]?.[0].model).not.toHaveProperty("variant")
    expect(promptCalls.map((call) => call[0].delivery)).toEqual(["queue", "queue", "queue"])
    expect(promptCalls.map((call) => call[0].resume)).toEqual([true, true, true])
    expect(promptCalls[0]?.[0].prompt).toEqual({ text: "plan it" })
  })

  it("fails fast when the pinned sidecar cannot execute V2 prompts", async () => {
    const switchAgent = vi.fn(async () => ({ data: undefined }))
    const switchModel = vi.fn(async () => ({ data: undefined }))
    const prompt = vi.fn(async () => ({ data: undefined }))
    const wait = vi.fn(async () => ({
      error: { _tag: "ServiceUnavailableError", message: "Session wait is not available yet", service: "session.wait" },
    }))
    const manager = new AgentManager({
      authToken: "test",
      opencodeBinPath: "/tmp/opencode",
      ooBinPath: "/tmp/oo",
      rootDir: "/tmp/wanta-agent",
    })
    ;(manager as unknown as { sidecar: unknown }).sidecar = {
      client: { v2: { session: { prompt, switchAgent, switchModel, wait } } },
    }

    await expect(manager.promptStreaming("session-1", "hello")).rejects.toThrow("V2 prompt execution is not available")

    expect(prompt).not.toHaveBeenCalled()
    expect(switchAgent).not.toHaveBeenCalled()
    expect(switchModel).not.toHaveBeenCalled()
  })

  it("rebuilds chat history from V2 sync events when projected messages only contain control events", async () => {
    const messages = vi.fn(async () => ({
      data: {
        data: [
          { id: "agent-1", type: "agent-switched", agent: "build", time: { created: 1 } },
          {
            id: "model-1",
            type: "model-switched",
            model: { id: "oopilot", providerID: "oomol" },
            time: { created: 2 },
          },
        ],
      },
    }))
    const history = vi.fn(async () => ({
      data: [
        {
          aggregate_id: "session-1",
          seq: 1,
          type: "message.updated.1",
          data: { info: { id: "u1", role: "user", sessionID: "session-1", time: { created: 1 } } },
        },
        {
          aggregate_id: "u1",
          seq: 2,
          type: "message.part.updated.1",
          data: {
            part: { id: "p1", messageID: "u1", sessionID: "session-1", type: "text", text: "hello" },
          },
        },
        {
          aggregate_id: "session-1",
          seq: 3,
          type: "message.updated.1",
          data: { info: { id: "a1", role: "assistant", sessionID: "session-1", time: { created: 2 } } },
        },
        {
          aggregate_id: "a1",
          seq: 4,
          type: "message.part.updated.1",
          data: {
            part: { id: "p2", messageID: "a1", sessionID: "session-1", type: "text", text: "Hi" },
          },
        },
      ],
    }))
    const manager = new AgentManager({
      authToken: "test",
      opencodeBinPath: "/tmp/opencode",
      ooBinPath: "/tmp/oo",
      rootDir: "/tmp/wanta-agent",
    })
    ;(manager as unknown as { sidecar: unknown; started: boolean }).sidecar = {
      client: { sync: { history: { list: history } }, v2: { session: { messages } } },
    }
    ;(manager as unknown as { started: boolean }).started = true

    const result = await manager.getMessages("session-1")

    expect(history).toHaveBeenCalledWith({ body: { _: 0 } })
    expect(result).toEqual([
      { id: "u1", role: "user", parts: [{ kind: "text", partId: "p1", text: "hello" }], createdAt: 1 },
      { id: "a1", role: "assistant", parts: [{ kind: "text", partId: "p2", text: "Hi" }], createdAt: 2 },
    ])
  })

  it("reads V2 projected messages across cursor pages", async () => {
    const messages = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          data: [{ id: "agent-1", type: "agent-switched", agent: "build", time: { created: 1 } }],
          cursor: { next: "next-page" },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: [{ id: "u1", type: "user", text: "hello", time: { created: 2 } }],
          cursor: {},
        },
      })
    const manager = new AgentManager({
      authToken: "test",
      opencodeBinPath: "/tmp/opencode",
      ooBinPath: "/tmp/oo",
      rootDir: "/tmp/wanta-agent",
    })
    ;(manager as unknown as { sidecar: unknown; started: boolean }).sidecar = {
      client: { v2: { session: { messages } } },
    }
    ;(manager as unknown as { started: boolean }).started = true

    const result = await manager.getMessages("session-1")

    expect(messages).toHaveBeenNthCalledWith(1, { sessionID: "session-1", order: "asc", limit: 200 })
    expect(messages).toHaveBeenNthCalledWith(2, { sessionID: "session-1", cursor: "next-page", limit: 200 })
    expect(result).toEqual([
      { id: "u1", role: "user", parts: [{ kind: "text", partId: "u1-text", text: "hello" }], createdAt: 2 },
    ])
  })

  it("uses V2 prompt and wait for blocking sends", async () => {
    const switchAgent = vi.fn(async () => ({ data: undefined }))
    const switchModel = vi.fn(async () => ({ data: undefined }))
    const prompt = vi.fn(async () => ({ data: undefined }))
    const wait = vi.fn(async () => ({ data: undefined }))
    const messages = vi.fn(async () => ({
      data: {
        data: [
          { id: "u1", type: "user", text: "hello", time: { created: 1 } },
          {
            id: "a1",
            type: "assistant",
            agent: "build",
            model: { id: "oopilot", providerID: "oomol" },
            content: [{ id: "t1", type: "text", text: "Hi" }],
            time: { created: 2 },
          },
        ],
      },
    }))
    const manager = new AgentManager({
      authToken: "test",
      opencodeBinPath: "/tmp/opencode",
      ooBinPath: "/tmp/oo",
      rootDir: "/tmp/wanta-agent",
    })
    ;(manager as unknown as { sidecar: unknown; started: boolean }).sidecar = {
      client: { v2: { session: { messages, prompt, switchAgent, switchModel, wait } } },
    }
    ;(manager as unknown as { started: boolean }).started = true

    const result = await manager.sendMessage("hello", "session-1")

    expect(prompt).toHaveBeenCalledWith({
      sessionID: "session-1",
      delivery: "queue",
      resume: true,
      prompt: { text: "hello" },
    })
    expect(wait).toHaveBeenNthCalledWith(1, { sessionID: "session-1" })
    expect(wait).toHaveBeenNthCalledWith(2, { sessionID: "session-1" })
    expect(messages).toHaveBeenCalledWith({ sessionID: "session-1", order: "asc", limit: 200 })
    expect(result.messages).toEqual([
      { id: "u1", role: "user", parts: [{ kind: "text", partId: "u1-text", text: "hello" }], createdAt: 1 },
      { id: "a1", role: "assistant", parts: [{ kind: "text", partId: "t1", text: "Hi" }], createdAt: 2 },
    ])
  })

  it("uses a generated session title without local length scoring or rewrite", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"title":"PostHog 近 3 天注册来源分析报告"}',
              },
            },
          ],
        }),
        { status: 200 },
      )
    })
    vi.stubGlobal("fetch", fetchMock)

    const manager = new AgentManager({
      authToken: "test",
      opencodeBinPath: "/tmp/opencode",
      ooBinPath: "/tmp/oo",
      rootDir: "/tmp/wanta-agent",
    })

    const title = await manager.generateSessionTitle({
      text: "你 PostHog 看一下近三天的数据，帮我看一下他们注册主要是来自于哪里？",
    })

    expect(title).toEqual({ generated: true, title: "PostHog 近 3 天注册来源分析报告" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
