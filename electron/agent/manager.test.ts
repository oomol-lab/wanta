import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AgentManager, buildArtifactSystem, buildWorkspaceIdentitySystem, isUserVisibleSession } from "./manager.ts"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("AgentManager", () => {
  it("pins raw connector CLI guidance to the current turn workspace", () => {
    const organization = buildWorkspaceIdentitySystem('team "quoted"')
    expect(organization).toContain('organization "team \\"quoted\\""')
    expect(organization).toContain('--organization "team \\"quoted\\""')

    const personal = buildWorkspaceIdentitySystem(undefined)
    expect(personal).toContain("workspace: personal")
    expect(personal).toContain("--personal")
  })

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

  it("stores project artifacts under the selected project", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "wanta-agent-"))
    const projectRoot = await mkdtemp(path.join(tmpdir(), "wanta-project-"))
    try {
      const manager = new AgentManager({
        authToken: "test",
        opencodeBinPath: "/tmp/opencode",
        ooBinPath: "/tmp/oo",
        rootDir,
      })

      const dir = await manager.createArtifactDir("session/one", projectRoot)
      const resolvedProjectRoot = await realpath(projectRoot)
      const sessionRoot = path.join(resolvedProjectRoot, ".wanta", "artifacts", "session_one")
      const relative = path.relative(sessionRoot, dir)

      expect(relative).not.toBe("..")
      expect(relative.startsWith(`..${path.sep}`)).toBe(false)
      expect(path.isAbsolute(relative)).toBe(false)
      await expect(realpath(manager.artifactSessionDir("session/one", projectRoot))).resolves.toBe(sessionRoot)
    } finally {
      await Promise.all([
        rm(rootDir, { force: true, recursive: true }),
        rm(projectRoot, { force: true, recursive: true }),
      ])
    }
  })

  it.skipIf(process.platform === "win32")("rejects symbolic links in the project artifact path", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "wanta-agent-"))
    const projectRoot = await mkdtemp(path.join(tmpdir(), "wanta-project-"))
    const outsideRoot = await mkdtemp(path.join(tmpdir(), "wanta-outside-"))
    try {
      const manager = new AgentManager({
        authToken: "test",
        opencodeBinPath: "/tmp/opencode",
        ooBinPath: "/tmp/oo",
        rootDir,
      })
      await symlink(outsideRoot, path.join(projectRoot, ".wanta"), "dir")

      await expect(manager.createArtifactDir("session", projectRoot)).rejects.toThrow(
        "Project artifact path contains a non-directory or symbolic link.",
      )
    } finally {
      await Promise.all([
        rm(rootDir, { force: true, recursive: true }),
        rm(projectRoot, { force: true, recursive: true }),
        rm(outsideRoot, { force: true, recursive: true }),
      ])
    }
  })

  it.skipIf(process.platform === "win32")("rejects a symbolic link used as the project root", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "wanta-agent-"))
    const projectRoot = await mkdtemp(path.join(tmpdir(), "wanta-project-"))
    const linkedProjectRoot = path.join(tmpdir(), `wanta-project-link-${Date.now()}`)
    try {
      const manager = new AgentManager({
        authToken: "test",
        opencodeBinPath: "/tmp/opencode",
        ooBinPath: "/tmp/oo",
        rootDir,
      })
      await symlink(projectRoot, linkedProjectRoot, "dir")

      await expect(manager.createArtifactDir("session", linkedProjectRoot)).rejects.toThrow(
        "Project artifact root is not a directory.",
      )
    } finally {
      await Promise.all([
        rm(rootDir, { force: true, recursive: true }),
        rm(projectRoot, { force: true, recursive: true }),
        rm(linkedProjectRoot, { force: true, recursive: true }),
      ])
    }
  })

  it("keeps image previews visible independently from artifact persistence", () => {
    const system = buildArtifactSystem("/tmp/wanta-artifacts/turn")

    expect(system).toContain("both are required for every final generated image")
    expect(system).toContain("keep that preview visible")
    expect(system).toContain("Wanta can materialize the same image")
    expect(system).toContain("replace every embedded output path")
    expect(system).not.toContain("Do not present a remote")
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

  it("writes per-session organization scopes without replacing the default identity", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "wanta-agent-"))
    try {
      const manager = new AgentManager({
        authToken: "test",
        opencodeBinPath: "/tmp/opencode",
        ooBinPath: "/tmp/oo",
        rootDir,
      })
      const scopePath = path.join(rootDir, "organization-scope.json")
      ;(manager as unknown as { organizationScopePath: string }).organizationScopePath = scopePath

      await manager.setOrganizationName("workspace-default")
      await manager.setSessionOrganizationName("session-a", "org-a")
      await manager.setSessionOrganizationName("session-b", undefined)

      await expect(readFile(scopePath, "utf8").then((content) => JSON.parse(content))).resolves.toEqual({
        organizationName: "workspace-default",
        sessionOrganizations: {
          "session-a": "org-a",
          "session-b": "",
        },
      })

      await manager.clearSessionOrganizationName("session-a")

      await expect(readFile(scopePath, "utf8").then((content) => JSON.parse(content))).resolves.toEqual({
        organizationName: "workspace-default",
        sessionOrganizations: {
          "session-b": "",
        },
      })
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
      expect(statuses).toContain("reconnecting")
    })
    expect(statuses).not.toContain("failed")

    await vi.advanceTimersByTimeAsync(500)
    await vi.waitFor(() => {
      expect(subscribe).toHaveBeenCalledTimes(2)
      expect(events).toEqual([{ type: "session.idle", properties: { sessionID: "session-1" } }])
    })

    unsubscribe()
  })

  it("reports a failed OpenCode event stream after reconnect attempts are exhausted", async () => {
    vi.useFakeTimers()
    const subscribe = vi.fn().mockRejectedValue(new Error("stream disconnected"))
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

    const statuses: Array<{ attempt?: number; status: string }> = []
    const unsubscribe = manager.subscribe(
      () => undefined,
      (status) => statuses.push({ attempt: status.attempt, status: status.status }),
    )

    await vi.waitFor(() => {
      expect(subscribe).toHaveBeenCalledTimes(1)
      expect(statuses).toContainEqual({ attempt: 1, status: "reconnecting" })
    })

    const delays = [500, 1_000, 2_000, 4_000, 5_000]
    for (const [index, delay] of delays.entries()) {
      await vi.advanceTimersByTimeAsync(delay)
      await vi.waitFor(() => {
        expect(subscribe).toHaveBeenCalledTimes(index + 2)
      })
    }

    await vi.waitFor(() => {
      expect(statuses.at(-1)).toEqual({ attempt: 5, status: "failed" })
    })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(subscribe).toHaveBeenCalledTimes(6)

    unsubscribe()
  })

  it("uses runtime question APIs for pending questions and replies", async () => {
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
      client: { question: { list, reject, reply } },
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

    expect(list).toHaveBeenCalledWith()
    expect(reply).toHaveBeenCalledWith({
      requestID: "q1",
      answers: [["A"]],
    })
    expect(reject).toHaveBeenCalledWith({ requestID: "q1" })
  })

  it("uses the selected builtin model to generate a session title", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"title":"PostHog 注册来源"}',
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
      model: { kind: "builtin", id: "gpt-5.5" },
      text: "你 PostHog 看一下近三天的数据，帮我看一下他们注册主要是来自于哪里？",
    })

    expect(title).toEqual({ generated: true, title: "PostHog 注册来源" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const request = fetchMock.mock.calls[0]?.[1]
    expect(request).toBeDefined()
    expect(JSON.parse(String(request?.body))).toMatchObject({ max_tokens: 512, model: "gpt-5.5" })
    expect(request?.headers).toMatchObject({ Authorization: "Bearer test" })
  })

  it("uses the selected custom model endpoint and credential to generate a session title", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"title":"自定义模型标题"}' } }] }), {
        status: 200,
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const manager = new AgentManager({
      authToken: "test",
      customModels: [
        {
          apiKey: "custom-secret",
          baseUrl: "https://models.example.test/v1/",
          id: "custom-1",
          modelName: "custom-model",
          providerId: "openrouter",
          providerName: "Custom provider",
        },
      ],
      opencodeBinPath: "/tmp/opencode",
      ooBinPath: "/tmp/oo",
      rootDir: "/tmp/wanta-agent",
    })

    const title = await manager.generateSessionTitle({
      model: { kind: "custom", id: "custom-1" },
      text: "帮我分析一下注册来源",
    })

    expect(title).toEqual({ generated: true, title: "自定义模型标题" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, request] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toBe("https://models.example.test/v1/chat/completions")
    expect(request?.headers).toMatchObject({ Authorization: "Bearer custom-secret" })
    expect(JSON.parse(String(request?.body))).toMatchObject({ model: "custom-model" })
  })
})
