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
  it("pins raw connector CLI guidance to the current team", () => {
    const system = buildWorkspaceIdentitySystem('team "quoted"')
    expect(system).toContain('team "team \\"quoted\\""')
    expect(system).toContain('--organization "team \\"quoted\\""')

    expect(() => buildWorkspaceIdentitySystem(undefined)).toThrow("Team workspace identity is unavailable")
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

  it("reuses authorized provider awareness within the prompt cache window", async () => {
    const manager = new AgentManager({
      authToken: "test",
      opencodeBinPath: "/tmp/opencode",
      ooBinPath: "/tmp/oo",
      rootDir: "/tmp/wanta-agent",
    })
    const lookup = vi.fn(async () => ["gmail"])
    manager.listAuthorizedServices = lookup

    await manager.buildAuthorizedSystem("acme")
    await manager.buildAuthorizedSystem("acme")

    expect(lookup).toHaveBeenCalledOnce()
  })

  it("keeps a shared authorized provider lookup alive when its first caller is cancelled", async () => {
    const manager = new AgentManager({
      authToken: "test",
      opencodeBinPath: "/tmp/opencode",
      ooBinPath: "/tmp/oo",
      rootDir: "/tmp/wanta-agent",
    })
    let resolveLookup: (services: string[]) => void = () => undefined
    let sharedSignal: AbortSignal | undefined
    const lookup = vi.fn((_teamName?: string, signal?: AbortSignal) => {
      sharedSignal = signal
      return new Promise<string[]>((resolve) => {
        resolveLookup = resolve
      })
    })
    manager.listAuthorizedServices = lookup
    const firstCaller = new AbortController()

    const first = manager.buildAuthorizedSystem("acme", firstCaller.signal)
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledOnce())
    firstCaller.abort(new Error("Prompt was cancelled."))

    await expect(first).resolves.toBeUndefined()
    expect(sharedSignal?.aborted).toBe(false)

    const second = manager.buildAuthorizedSystem("acme")
    resolveLookup(["gmail"])
    await expect(second).resolves.toContain("Some Link providers are already authorized")
    await manager.buildAuthorizedSystem("acme")
    expect(lookup).toHaveBeenCalledOnce()
  })

  it("aborts authorized provider lookups and prevents cache refill after dispose", async () => {
    const manager = new AgentManager({
      authToken: "test",
      opencodeBinPath: "/tmp/opencode",
      ooBinPath: "/tmp/oo",
      rootDir: "/tmp/wanta-agent",
    })
    let resolveLookup: (services: string[]) => void = () => undefined
    let sharedSignal: AbortSignal | undefined
    const lookup = vi
      .fn((_teamName?: string, signal?: AbortSignal) => {
        sharedSignal = signal
        return new Promise<string[]>((resolve) => {
          resolveLookup = resolve
        })
      })
      .mockImplementationOnce((_teamName?: string, signal?: AbortSignal) => {
        sharedSignal = signal
        return new Promise<string[]>((resolve) => {
          resolveLookup = resolve
        })
      })
      .mockResolvedValueOnce(["slack"])
    manager.listAuthorizedServices = lookup

    const pending = manager.buildAuthorizedSystem("acme")
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledOnce())
    await manager.dispose()
    expect(sharedSignal?.aborted).toBe(true)

    resolveLookup(["gmail"])
    await pending
    await expect(manager.buildAuthorizedSystem("acme")).resolves.toContain("Some Link providers are already authorized")
    expect(lookup).toHaveBeenCalledTimes(2)
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

  it("tells project turns that managed deliverables are published into the visible project", () => {
    const system = buildArtifactSystem("/tmp/project/.wanta/artifacts/session/turn", "/tmp/project")

    expect(system).toContain("Wanta will publish final deliverables")
    expect(system).toContain("descriptive user-facing file and directory names")
    expect(system).toContain("Do not write a second copy directly into the project directory")
    expect(system).toContain("Do not present the managed artifact path as the final project location")
  })

  it("syncs the oo CLI default identity with the active team", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "wanta-agent-"))
    try {
      const manager = new AgentManager({
        authToken: "test",
        opencodeBinPath: "/tmp/opencode",
        ooBinPath: "/tmp/oo",
        rootDir,
      })
      const settingsPath = path.join(rootDir, "oo-store", "config", "settings.toml")

      await manager.setTeamName("acme-corp")
      await expect(readFile(settingsPath, "utf8")).resolves.toContain('organization = "acme-corp"')

      await manager.setTeamName(undefined)
      await expect(readFile(settingsPath, "utf8")).resolves.not.toContain("organization =")
    } finally {
      await rm(rootDir, { force: true, recursive: true })
    }
  })

  it("writes per-session team scopes without replacing the default identity", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "wanta-agent-"))
    try {
      const manager = new AgentManager({
        authToken: "test",
        opencodeBinPath: "/tmp/opencode",
        ooBinPath: "/tmp/oo",
        rootDir,
      })
      const scopePath = path.join(rootDir, "team-scope.json")
      ;(manager as unknown as { teamScopePath: string }).teamScopePath = scopePath

      await manager.setTeamName("workspace-default")
      await manager.setSessionTeamName("session-a", "team-a")
      await manager.setSessionTeamName("session-b", undefined)
      await manager.setSessionKnowledgeBaseIds("session-a", [" knowledge-a ", "knowledge-a", "knowledge-b"])
      await manager.inheritSessionKnowledgeBaseIds("session-a", "session-child")

      await expect(readFile(scopePath, "utf8").then((content) => JSON.parse(content))).resolves.toEqual({
        teamName: "workspace-default",
        sessionKnowledgeBaseIds: {
          "session-a": ["knowledge-a", "knowledge-b"],
          "session-child": ["knowledge-a", "knowledge-b"],
        },
        sessionTeams: {
          "session-a": "team-a",
          "session-b": "",
        },
      })

      await manager.clearSessionTeamName("session-a")
      await manager.removeKnowledgeBaseAccess("knowledge-a")

      await expect(readFile(scopePath, "utf8").then((content) => JSON.parse(content))).resolves.toEqual({
        teamName: "workspace-default",
        sessionKnowledgeBaseIds: {
          "session-a": ["knowledge-b"],
          "session-child": ["knowledge-b"],
        },
        sessionTeams: {
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
      teamName: string | undefined
      writeOoIdentity: (teamName: string | undefined) => Promise<void>
      writeTeamScope: (teamName: string | undefined) => Promise<void>
      writeTeamState: (teamName: string | undefined) => Promise<void>
    }
    internals.teamName = "old-team"
    internals.writeOoIdentity = async (teamName) => {
      writes.push(`identity:${teamName ?? ""}`)
    }
    internals.writeTeamScope = async (teamName) => {
      writes.push(`scope:${teamName ?? ""}`)
      if (teamName === "new-team") {
        throw new Error("scope failed")
      }
    }

    await expect(internals.writeTeamState("new-team")).rejects.toThrow("scope failed")

    expect(writes).toEqual(["identity:new-team", "scope:new-team", "identity:old-team"])
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
      teamName: string | undefined
      writeOoIdentity: (teamName: string | undefined) => Promise<void>
      writeTeamScope: (teamName: string | undefined) => Promise<void>
      writeTeamState: (teamName: string | undefined) => Promise<void>
    }
    internals.teamName = "old-team"
    internals.writeOoIdentity = async (teamName) => {
      if (teamName === "old-team") {
        throw rollbackFailure
      }
    }
    internals.writeTeamScope = async () => {
      throw scopeFailure
    }

    await expect(internals.writeTeamState("new-team")).rejects.toMatchObject({
      errors: [scopeFailure, rollbackFailure],
    })
  })

  it("preserves existing oo settings when updating the default team", async () => {
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

      await manager.setTeamName('team "quoted"')

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
    await manager.promptStreaming("session-1", "plan it", {
      mode: "plan",
      teamName: "acme",
      reasoningLevel: "high",
    })
    await manager.promptStreaming("session-1", "build it", {
      teamName: "acme",
      reasoningLevel: "medium",
    })
    await manager.promptStreaming("session-1", "default reasoning", {
      teamName: "acme",
      reasoningLevel: "default",
    })

    const calls = promptAsync.mock.calls as unknown as Array<[parameters: { agent?: string; variant?: string }]>
    expect(calls[0]?.[0].agent).toBe("plan")
    expect(calls[0]?.[0].variant).toBe("high")
    expect(calls[1]?.[0].agent).toBe("build")
    expect(calls[1]?.[0].variant).toBe("medium")
    expect(calls[2]?.[0]).not.toHaveProperty("variant")
  })

  it("does not send an unconverted XLSX binary to the model provider", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "wanta-attachment-manager-"))
    const workbookPath = path.join(directory, "库存表.xlsx")
    await writeFile(workbookPath, "test workbook")
    const promptAsync = vi.fn(async () => ({ data: true }))
    const manager = new AgentManager({
      authToken: "test",
      opencodeBinPath: "/tmp/opencode",
      ooBinPath: "/tmp/oo",
      rootDir: "/tmp/wanta-agent",
    })
    ;(manager as unknown as { sidecar: unknown }).sidecar = { client: { session: { promptAsync } } }
    manager.buildAuthorizedSystem = async () => undefined

    try {
      await manager.promptStreaming("session-1", "整理表格", {
        attachments: [
          {
            id: "xlsx-1",
            mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            name: "库存表.xlsx",
            path: workbookPath,
            size: 1024,
          },
        ],
        teamName: "acme",
      })

      const calls = promptAsync.mock.calls as unknown as Array<
        [{ parts: Array<{ mime?: string; text?: string; type: string }> }]
      >
      const call = calls[0]?.[0]
      expect(call).toBeDefined()
      if (!call) throw new Error("Expected promptAsync to be called")
      expect(call.parts).not.toContainEqual(
        expect.objectContaining({
          mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          type: "file",
        }),
      )
      expect(call.parts[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("not safe to pass through"),
      })
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it("normalizes structured text and applies the selected model's image capability", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "wanta-attachment-manager-"))
    const jsonPath = path.join(directory, "data.json")
    const imagePath = path.join(directory, "photo.png")
    await Promise.all([writeFile(jsonPath, "{}"), writeFile(imagePath, "test image")])
    const promptAsync = vi.fn(async () => ({ data: true }))
    const manager = new AgentManager({
      authToken: "test",
      opencodeBinPath: "/tmp/opencode",
      ooBinPath: "/tmp/oo",
      rootDir: "/tmp/wanta-agent",
    })
    ;(manager as unknown as { sidecar: unknown }).sidecar = { client: { session: { promptAsync } } }
    manager.buildAuthorizedSystem = async () => undefined
    const json = {
      id: "json-1",
      mime: "application/json",
      name: "data.json",
      path: jsonPath,
      size: 100,
    }
    const image = {
      id: "image-1",
      mime: "image/png",
      name: "photo.png",
      path: imagePath,
      size: 100,
    }

    try {
      await manager.promptStreaming("session-1", "analyze", {
        attachments: [json, image],
        model: { kind: "builtin", id: "deepseek-v4-flash" },
        teamName: "acme",
      })
      await manager.promptStreaming("session-1", "analyze", {
        attachments: [image],
        model: { kind: "builtin", id: "oopilot" },
        teamName: "acme",
      })

      const calls = promptAsync.mock.calls as unknown as Array<
        [{ parts: Array<{ mime?: string; text?: string; type: string }> }]
      >
      expect(calls[0]?.[0].parts[0]).toMatchObject({ mime: "text/plain", type: "file" })
      expect(calls[0]?.[0].parts[1]).toMatchObject({
        type: "text",
        text: expect.stringContaining("does not support image input"),
      })
      expect(calls[1]?.[0].parts[0]).toMatchObject({ mime: "image/png", type: "file" })
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
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
        {
          id: "q2",
          sessionID: "session-2",
          questions: [{ header: "Answer", question: "Pick two", options: [{ label: "B" }] }],
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
    await expect(manager.getPendingQuestionsForSessions(["session-1", "session-2"])).resolves.toHaveLength(2)

    expect(list).toHaveBeenCalledTimes(2)
    expect(reply).toHaveBeenCalledWith({
      requestID: "q1",
      answers: [["A"]],
    })
    expect(reject).toHaveBeenCalledWith({ requestID: "q1" })
  })

  it("turns OpenCode SDK error results into rejected operations", async () => {
    const failure = async () => ({ error: { message: "runtime unavailable" } })
    const manager = new AgentManager({
      authToken: "test",
      opencodeBinPath: "/tmp/opencode",
      ooBinPath: "/tmp/oo",
      rootDir: "/tmp/wanta-agent",
    })
    ;(manager as unknown as { sidecar: unknown; started: boolean }).sidecar = {
      client: {
        permission: { list: failure, reply: failure },
        question: { list: failure, reject: failure, reply: failure },
        session: {
          abort: failure,
          delete: failure,
          list: failure,
          messages: failure,
          update: failure,
        },
      },
    }
    ;(manager as unknown as { started: boolean }).started = true

    await expect(manager.listSessions()).rejects.toThrow("session.list failed")
    await expect(manager.getMessages("session-1")).rejects.toThrow("session.messages failed")
    await expect(manager.renameSession("session-1", "Title")).rejects.toThrow("session.update failed")
    await expect(manager.deleteSession("session-1")).rejects.toThrow("session.delete failed")
    await expect(manager.abort("session-1")).rejects.toThrow("session.abort failed")
    await expect(manager.getPendingQuestions("session-1")).rejects.toThrow("question.list failed")
    await expect(manager.answerQuestion("session-1", "question-1", [["answer"]])).rejects.toThrow(
      "question.reply failed",
    )
    await expect(manager.rejectQuestion("session-1", "question-1")).rejects.toThrow("question.reject failed")
    await expect(manager.getPendingPermissions("session-1")).rejects.toThrow("permission.list failed")
    await expect(manager.answerPermission("session-1", "permission-1", "once")).rejects.toThrow(
      "permission.reply failed",
    )
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
