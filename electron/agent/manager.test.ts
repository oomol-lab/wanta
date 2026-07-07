import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AgentManager, isUserVisibleSession } from "./manager.ts"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("AgentManager", () => {
  it("hides OpenCode subagent sessions from the user task list", () => {
    expect(isUserVisibleSession({ id: "root", title: "Root" })).toBe(true)
    expect(isUserVisibleSession({ id: "child", parentID: "root", title: "Child" })).toBe(false)
    expect(isUserVisibleSession({ id: "child", parentId: "root", title: "Child" })).toBe(false)
    expect(isUserVisibleSession({ id: "child", parent_id: "root", title: "Child" })).toBe(false)
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
      expect(system).toContain("For questions about which providers are connected, use list_apps")
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

  it("syncs the oo CLI default identity with the active organization", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "wanta-agent-"))
    try {
      const manager = new AgentManager({
        authToken: "test",
        opencodeBinPath: "/tmp/opencode",
        ooBinPath: "/tmp/oo",
        rootDir,
      })
      const settingsPath = path.join(rootDir, "oo-store", "config", "settings.toml")

      await manager.setOrganizationName("acme-corp")
      await expect(readFile(settingsPath, "utf8")).resolves.toContain('organization = "acme-corp"')

      await manager.setOrganizationName(undefined)
      await expect(readFile(settingsPath, "utf8")).resolves.not.toContain("organization =")
    } finally {
      await rm(rootDir, { force: true, recursive: true })
    }
  })

  it("restores the default identity when scope persistence fails", async () => {
    const manager = new AgentManager({
      authToken: "test",
      opencodeBinPath: "/tmp/opencode",
      ooBinPath: "/tmp/oo",
      rootDir: "/tmp/wanta-agent",
    })
    const writes: string[] = []
    const internals = manager as unknown as {
      organizationName: string | undefined
      writeOoIdentity: (organizationName: string | undefined) => Promise<void>
      writeOrganizationScope: (organizationName: string | undefined) => Promise<void>
      writeOrganizationState: (organizationName: string | undefined) => Promise<void>
    }
    internals.organizationName = "old-org"
    internals.writeOoIdentity = async (organizationName) => {
      writes.push(`identity:${organizationName ?? ""}`)
    }
    internals.writeOrganizationScope = async (organizationName) => {
      writes.push(`scope:${organizationName ?? ""}`)
      if (organizationName === "new-org") {
        throw new Error("scope failed")
      }
    }

    await expect(internals.writeOrganizationState("new-org")).rejects.toThrow("scope failed")

    expect(writes).toEqual(["identity:new-org", "scope:new-org", "identity:old-org"])
  })

  it("preserves the scope write failure when identity rollback also fails", async () => {
    const manager = new AgentManager({
      authToken: "test",
      opencodeBinPath: "/tmp/opencode",
      ooBinPath: "/tmp/oo",
      rootDir: "/tmp/wanta-agent",
    })
    const scopeFailure = new Error("scope failed")
    const rollbackFailure = new Error("rollback failed")
    const internals = manager as unknown as {
      organizationName: string | undefined
      writeOoIdentity: (organizationName: string | undefined) => Promise<void>
      writeOrganizationScope: (organizationName: string | undefined) => Promise<void>
      writeOrganizationState: (organizationName: string | undefined) => Promise<void>
    }
    internals.organizationName = "old-org"
    internals.writeOoIdentity = async (organizationName) => {
      if (organizationName === "old-org") {
        throw rollbackFailure
      }
    }
    internals.writeOrganizationScope = async () => {
      throw scopeFailure
    }

    await expect(internals.writeOrganizationState("new-org")).rejects.toMatchObject({
      errors: [scopeFailure, rollbackFailure],
    })
  })

  it("preserves existing oo settings when updating the default organization", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "wanta-agent-"))
    try {
      const manager = new AgentManager({
        authToken: "test",
        opencodeBinPath: "/tmp/opencode",
        ooBinPath: "/tmp/oo",
        rootDir,
      })
      const settingsPath = path.join(rootDir, "oo-store", "config", "settings.toml")
      await mkdir(path.dirname(settingsPath), { recursive: true })
      await writeFile(
        settingsPath,
        ["[skills.recommend]", "muted = true", "", "[identity]", 'organization = "old"', 'note = "keep"'].join("\n"),
        "utf8",
      )

      await manager.setOrganizationName('team "quoted"')

      const settings = await readFile(settingsPath, "utf8")
      expect(settings).toContain("[skills.recommend]")
      expect(settings).toContain("muted = true")
      expect(settings).toContain("[identity]")
      expect(settings).toContain('organization = "team \\"quoted\\""')
      expect(settings).toContain('note = "keep"')
    } finally {
      await rm(rootDir, { force: true, recursive: true })
    }
  })

  it("passes OpenCode agent names and reasoning variants to promptAsync", async () => {
    const promptAsync = vi.fn(async () => ({ data: true }))
    const manager = new AgentManager({
      authToken: "test",
      opencodeBinPath: "/tmp/opencode",
      ooBinPath: "/tmp/oo",
      rootDir: "/tmp/wanta-agent",
    })
    ;(manager as unknown as { sidecar: unknown }).sidecar = { client: { session: { promptAsync } } }
    manager.buildAuthorizedSystem = async () => undefined

    await manager.promptStreaming("session-1", "plan it", { mode: "plan", reasoningLevel: "high" })
    await manager.promptStreaming("session-1", "build it", { reasoningLevel: "medium" })
    await manager.promptStreaming("session-1", "default reasoning", { reasoningLevel: "default" })

    const calls = promptAsync.mock.calls as unknown as Array<[parameters: { agent?: string; variant?: string }]>
    expect(calls[0]?.[0].agent).toBe("plan")
    expect(calls[0]?.[0].variant).toBe("high")
    expect(calls[1]?.[0].agent).toBe("build")
    expect(calls[1]?.[0].variant).toBe("medium")
    expect(calls[2]?.[0]).not.toHaveProperty("variant")
  })

  it("restarts the OpenCode event stream after an unexpected disconnect", async () => {
    vi.useFakeTimers()
    const subscribe = vi
      .fn()
      .mockRejectedValueOnce(new Error("stream disconnected"))
      .mockResolvedValueOnce({
        stream: (async function* () {
          yield { type: "session.idle", properties: { sessionID: "session-1" } }
        })(),
      })
    const manager = new AgentManager({
      authToken: "test",
      opencodeBinPath: "/tmp/opencode",
      ooBinPath: "/tmp/oo",
      rootDir: "/tmp/wanta-agent",
    })
    ;(manager as unknown as { sidecar: unknown; started: boolean }).sidecar = {
      client: { event: { subscribe } },
    }
    ;(manager as unknown as { started: boolean }).started = true

    const events: Array<{ type: string; properties?: Record<string, unknown> }> = []
    const statuses: string[] = []
    const unsubscribe = manager.subscribe(
      (event) => events.push(event),
      (status) => statuses.push(status.status),
    )

    await vi.waitFor(() => {
      expect(subscribe).toHaveBeenCalledTimes(1)
      expect(statuses).toContain("failed")
      expect(statuses).toContain("reconnecting")
    })

    await vi.advanceTimersByTimeAsync(500)
    await vi.waitFor(() => {
      expect(subscribe).toHaveBeenCalledTimes(2)
      expect(events).toEqual([{ type: "session.idle", properties: { sessionID: "session-1" } }])
    })

    unsubscribe()
  })

  it("uses session-scoped question APIs for pending questions and replies", async () => {
    const list = vi.fn(async () => ({
      data: [
        {
          id: "q1",
          sessionID: "session-1",
          questions: [{ header: "Answer", question: "Pick one", options: [{ label: "A" }] }],
        },
      ],
    }))
    const reply = vi.fn(async () => ({ data: true }))
    const reject = vi.fn(async () => ({ data: true }))
    const manager = new AgentManager({
      authToken: "test",
      opencodeBinPath: "/tmp/opencode",
      ooBinPath: "/tmp/oo",
      rootDir: "/tmp/wanta-agent",
    })
    ;(manager as unknown as { sidecar: unknown; started: boolean }).sidecar = {
      client: { v2: { session: { question: { list, reject, reply } } } },
    }
    ;(manager as unknown as { started: boolean }).started = true

    await expect(manager.getPendingQuestions("session-1")).resolves.toEqual([
      {
        id: "q1",
        sessionId: "session-1",
        questions: [{ header: "Answer", question: "Pick one", options: [{ label: "A" }] }],
      },
    ])
    await manager.answerQuestion("session-1", "q1", [["A"]])
    await manager.rejectQuestion("session-1", "q1")

    expect(list).toHaveBeenCalledWith({ sessionID: "session-1" })
    expect(reply).toHaveBeenCalledWith({
      sessionID: "session-1",
      requestID: "q1",
      questionV2Reply: { answers: [["A"]] },
    })
    expect(reject).toHaveBeenCalledWith({ sessionID: "session-1", requestID: "q1" })
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
