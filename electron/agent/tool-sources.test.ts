import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AGENT_TOOL_FILES } from "./tool-sources.ts"

describe("query_knowledge guidance", () => {
  it("keeps relationship diagrams evidence-first without exposing archive paths", () => {
    const source = AGENT_TOOL_FILES["query_knowledge.ts"] ?? ""

    expect(source).toContain("resolve aliases from entity identifiers")
    expect(source).toContain("Evidence counts are passage counts, not confidence scores")
    expect(source).toContain("Never invoke the WikiGraph CLI directly")
    expect(source).toContain("expose managed archive paths")
    expect(source).toContain("sanitizeErrorMessage(error, archivePath)")
    expect(source).toContain('replaceAll(value, "[managed knowledge archive]")')
    expect(source).toContain("sessionKnowledgeBaseIds")
    expect(source).toContain("context.sessionID")
    expect(source).toContain("knowledge base is not pinned to the current conversation")
  })
})

interface LoadedTool {
  execute: (
    args: { action: string; connectionName?: string; params?: string; service: string },
    context: { sessionID: string },
  ) => Promise<string>
}

interface LoadedListAppsTool {
  execute: (args: { service?: string }, context: { sessionID: string }) => Promise<string>
}

interface LoadedKnowledgeTool {
  execute: (args: { knowledgeBaseId: string; operation: "inspect" }, context: { sessionID: string }) => Promise<string>
}

function loadKnowledgeTool(
  execFile: (...args: unknown[]) => Promise<unknown>,
  readFile: (path: string) => Promise<string>,
): LoadedKnowledgeTool {
  const raw = AGENT_TOOL_FILES["query_knowledge.ts"] ?? ""
  const source = raw
    .replace(/^import .*$/gm, "")
    .replace("export default tool(", "const exportedTool = tool(")
    .concat("\nreturn exportedTool")
  const schema = {
    describe() {
      return this
    },
    optional() {
      return this
    },
  }
  const tool = Object.assign((value: unknown) => value, {
    schema: { enum: () => schema, number: () => schema, string: () => schema },
  })
  const factory = new Function("tool", "execFile", "readFile", "promisify", source) as (
    toolValue: typeof tool,
    execFileValue: typeof execFile,
    readFileValue: typeof readFile,
    promisifyValue: (value: typeof execFile) => typeof execFile,
  ) => LoadedKnowledgeTool
  return factory(tool, execFile, readFile, (value) => value)
}

function loadListAppsTool(
  execFile: (...args: unknown[]) => Promise<unknown>,
  readFile: () => Promise<string>,
): LoadedListAppsTool {
  const raw = AGENT_TOOL_FILES["list_apps.ts"] ?? ""
  const source = raw
    .replace(/^import .*$/gm, "")
    .replace("export default tool(", "const exportedTool = tool(")
    .concat("\nreturn exportedTool")
  const schema = {
    describe() {
      return this
    },
    optional() {
      return this
    },
  }
  const tool = Object.assign((value: unknown) => value, { schema: { string: () => schema } })
  const factory = new Function("tool", "execFile", "readFile", "promisify", source) as (
    toolValue: typeof tool,
    execFileValue: typeof execFile,
    readFileValue: typeof readFile,
    promisifyValue: (value: typeof execFile) => typeof execFile,
  ) => LoadedListAppsTool
  return factory(tool, execFile, readFile, (value) => value)
}

function loadCallActionTool(execFile: (...args: unknown[]) => Promise<unknown>): LoadedTool {
  const raw = AGENT_TOOL_FILES["call_action.ts"] ?? ""
  const source = raw
    .replace(/^import .*$/gm, "")
    .replace("export default tool(", "const exportedTool = tool(")
    .concat("\nreturn exportedTool")
  const schema = {
    describe() {
      return this
    },
    optional() {
      return this
    },
  }
  const tool = Object.assign((value: unknown) => value, { schema: { string: () => schema } })
  const factory = new Function("tool", "execFile", "readFile", "promisify", source) as (
    toolValue: typeof tool,
    execFileValue: typeof execFile,
    readFileValue: () => Promise<string>,
    promisifyValue: (value: typeof execFile) => typeof execFile,
  ) => LoadedTool
  return factory(
    tool,
    execFile,
    async () => {
      throw new Error("scope file unavailable")
    },
    (value) => value,
  )
}

afterEach(() => {
  delete process.env.WANTA_CONSOLE_URL
  delete process.env.WANTA_KNOWLEDGE_REGISTRY
  delete process.env.WANTA_ORGANIZATION_NAME
  delete process.env.WANTA_ORGANIZATION_SCOPE_PATH
  delete process.env.WANTA_WIKIGRAPH_CLI
  delete process.env.WANTA_WIKIGRAPH_EXECUTABLE
})

beforeEach(() => {
  process.env.WANTA_ORGANIZATION_NAME = "org-a"
})

describe("query_knowledge embedded runtime", () => {
  it("rejects IDs outside the current OpenCode session allowlist", async () => {
    process.env.WANTA_KNOWLEDGE_REGISTRY = "/tmp/knowledge-registry.json"
    process.env.WANTA_ORGANIZATION_SCOPE_PATH = "/tmp/agent-scope.json"
    process.env.WANTA_WIKIGRAPH_CLI = "/tmp/wiki-graph-cli.js"
    process.env.WANTA_WIKIGRAPH_EXECUTABLE = "/tmp/node"
    const execFile = vi.fn(async () => ({ stdout: '{"ok":true}' }))
    const readFile = vi.fn(async (filePath: string) => {
      if (filePath === "/tmp/agent-scope.json") {
        return JSON.stringify({ sessionKnowledgeBaseIds: { "session-1": ["allowed"] } })
      }
      return JSON.stringify({
        records: [{ filePath: "/managed/allowed.wikg", id: "allowed", title: "Allowed" }],
      })
    })
    const loaded = loadKnowledgeTool(execFile, readFile)

    const denied = JSON.parse(
      await loaded.execute({ knowledgeBaseId: "other", operation: "inspect" }, { sessionID: "session-1" }),
    ) as { message?: string; status?: string }
    expect(denied).toEqual({
      message: "knowledge base is not pinned to the current conversation",
      status: "error",
    })
    expect(execFile).not.toHaveBeenCalled()

    await expect(
      loaded.execute({ knowledgeBaseId: "allowed", operation: "inspect" }, { sessionID: "session-1" }),
    ).resolves.toBe('{"ok":true}')
    expect(execFile).toHaveBeenCalledOnce()
  })
})

describe("list_apps embedded runtime", () => {
  it("keeps organization identity in structured inventory errors", async () => {
    process.env.WANTA_ORGANIZATION_SCOPE_PATH = "/tmp/organization-scope.json"
    const commands: string[][] = []
    const runtime = loadListAppsTool(
      async (...args) => {
        commands.push(args[1] as string[])
        const error = new Error("connector apps failed") as Error & { stderr: string }
        error.stderr = "The connector apps request returned HTTP 403."
        throw error
      },
      async () =>
        JSON.stringify({
          organizationName: "workspace-default",
          sessionOrganizations: { "session-1": "org-a" },
        }),
    )

    const output = JSON.parse(await runtime.execute({ service: "posthog" }, { sessionID: "session-1" })) as {
      errorCode?: string
      workspace?: { organizationName?: string }
    }

    expect(commands).toEqual([["connector", "apps", "posthog", "--organization", "org-a", "--json"]])
    expect(output).toMatchObject({
      errorCode: "connection_inventory_unavailable",
      workspace: { organizationName: "org-a" },
    })
  })

  it("fails closed when the session workspace file is unreadable", async () => {
    process.env.WANTA_ORGANIZATION_SCOPE_PATH = "/tmp/organization-scope.json"
    process.env.WANTA_ORGANIZATION_NAME = "stale-default"
    let calls = 0
    const runtime = loadListAppsTool(
      async () => {
        calls += 1
        return { stdout: "[]" }
      },
      async () => {
        throw new Error("partial scope file")
      },
    )

    const output = JSON.parse(await runtime.execute({ service: "posthog" }, { sessionID: "session-1" })) as {
      errorCode?: string
    }

    expect(calls).toBe(0)
    expect(output.errorCode).toBe("workspace_identity_unavailable")
  })
})

describe("call_action embedded runtime", () => {
  it("runs one canary and skips matching queued calls after an authorization block", async () => {
    process.env.WANTA_CONSOLE_URL = "https://console.example.test"
    let calls = 0
    const runtime = loadCallActionTool(async () => {
      calls += 1
      const error = new Error("connector failed") as Error & { stderr: string }
      error.stderr = "Request failed (errorCode: app_not_found): app not found"
      throw error
    })

    const outputs = await Promise.all(
      Array.from({ length: 6 }, () =>
        runtime.execute({ service: "posthog", action: "run_query", params: "{}" }, { sessionID: "session-1" }),
      ),
    )
    const parsed = outputs.map((output) => JSON.parse(output) as { reason?: string; status?: string })

    expect(calls).toBe(1)
    expect(parsed.filter((output) => output.status === "authorization_required")).toHaveLength(1)
    expect(
      parsed.filter((output) => output.status === "skipped" && output.reason === "connection_blocked"),
    ).toHaveLength(5)
  })

  it("keeps short-lived connector blocks isolated between chat sessions", async () => {
    process.env.WANTA_CONSOLE_URL = "https://console.example.test"
    let calls = 0
    const runtime = loadCallActionTool(async () => {
      calls += 1
      const error = new Error("connector failed") as Error & { stderr: string }
      error.stderr = "Request failed (errorCode: app_not_found): app not found"
      throw error
    })

    const first = JSON.parse(
      await runtime.execute({ service: "posthog", action: "run_query" }, { sessionID: "session-1" }),
    ) as { status?: string }
    const second = JSON.parse(
      await runtime.execute({ service: "posthog", action: "run_query" }, { sessionID: "session-2" }),
    ) as { status?: string }

    expect(calls).toBe(2)
    expect(first.status).toBe("authorization_required")
    expect(second.status).toBe("authorization_required")
  })

  it("limits matching fan-out calls after the canary succeeds", async () => {
    let active = 0
    let maxActive = 0
    let calls = 0
    const runtime = loadCallActionTool(async () => {
      calls += 1
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return { stdout: JSON.stringify({ data: { ok: true } }) }
    })

    const outputs = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        runtime.execute(
          { service: "posthog", action: "run_query", params: JSON.stringify({ projectId: index }) },
          { sessionID: "session-1" },
        ),
      ),
    )

    expect(calls).toBe(6)
    expect(maxActive).toBe(2)
    expect(outputs.map((output) => JSON.parse(output))).toHaveLength(6)
  })

  it("rejects a guessed connection name before executing the action", async () => {
    const commands: string[][] = []
    const runtime = loadCallActionTool(async (...args) => {
      const argv = args[1] as string[]
      commands.push(argv)
      return { stdout: JSON.stringify([{ connectionName: "work", service: "gmail", status: "active" }]) }
    })

    const output = JSON.parse(
      await runtime.execute(
        { service: "gmail", action: "fetch_emails", connectionName: "Gmail" },
        { sessionID: "session-1" },
      ),
    ) as { errorCode?: string; status?: string }

    expect(output).toMatchObject({ status: "error", errorCode: "invalid_connection_name" })
    expect(commands).toHaveLength(1)
    expect(commands[0]?.slice(0, 3)).toEqual(["connector", "apps", "gmail"])
  })

  it("does not silently switch accounts when connection inventory is unavailable", async () => {
    const runtime = loadCallActionTool(async () => {
      throw new Error("HTTP 403")
    })

    const output = JSON.parse(
      await runtime.execute(
        { service: "gmail", action: "fetch_emails", connectionName: "work" },
        { sessionID: "session-1" },
      ),
    ) as { errorCode?: string; status?: string }

    expect(output).toMatchObject({ status: "error", errorCode: "connection_inventory_unavailable" })
  })
})
