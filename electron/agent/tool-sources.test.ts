import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { AGENT_TOOL_FILES, agentToolFiles } from "./tool-sources.ts"

describe("runtime tool assembly", () => {
  it("adds Connector tools only when a Link runtime is available", () => {
    expect(Object.keys(agentToolFiles(true))).toEqual(Object.keys(AGENT_TOOL_FILES))
    expect(Object.keys(agentToolFiles(false))).toEqual([])
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
  delete process.env.WANTA_CONNECTOR_URL
  delete process.env.WANTA_LINK_RUNTIME
  delete process.env.WANTA_TEAM_NAME
  delete process.env.WANTA_TEAM_SCOPE_PATH
  delete process.env.WANTA_ORGANIZATION_NAME
  delete process.env.WANTA_ORGANIZATION_SCOPE_PATH
  delete process.env.WIKIGRAPH_STATE_DIR
  delete process.env.OO_API_KEY
  delete process.env.OO_CONNECTOR_TOKEN
})

beforeEach(() => {
  process.env.WANTA_TEAM_NAME = "team-a"
})

describe("list_apps embedded runtime", () => {
  it("uses endpoint identity without organization arguments for OpenConnector", async () => {
    process.env.WANTA_LINK_RUNTIME = "openconnector"
    process.env.WANTA_CONNECTOR_URL = "http://127.0.0.1:3000"
    delete process.env.WANTA_TEAM_NAME
    const commands: string[][] = []
    const runtime = loadListAppsTool(
      async (...args) => {
        commands.push(args[1] as string[])
        return { stdout: "[]" }
      },
      async () => {
        throw new Error("OpenConnector must not read team scope")
      },
    )

    await expect(runtime.execute({}, { sessionID: "session-1" })).resolves.toBe("[]")
    expect(commands).toEqual([["connector", "apps", "--json"]])
  })

  it("reads legacy organization environment variables during migration", async () => {
    delete process.env.WANTA_TEAM_NAME
    process.env.WANTA_ORGANIZATION_NAME = "legacy-team"
    process.env.WANTA_ORGANIZATION_SCOPE_PATH = "/tmp/legacy-scope.json"
    const runtime = loadListAppsTool(
      async (_command, args) => ({ stdout: JSON.stringify([{ args }]) }),
      async () => JSON.stringify({ sessionTeams: { "session-1": "legacy-session-team" } }),
    )

    const output = JSON.parse(await runtime.execute({}, { sessionID: "session-1" })) as Array<{ args: string[] }>

    expect(output[0]?.args).toContain("legacy-session-team")
  })

  it("keeps team identity in structured inventory errors", async () => {
    process.env.WANTA_TEAM_SCOPE_PATH = "/tmp/team-scope.json"
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
          teamName: "workspace-default",
          sessionTeams: { "session-1": "team-a" },
        }),
    )

    const output = JSON.parse(await runtime.execute({ service: "posthog" }, { sessionID: "session-1" })) as {
      errorCode?: string
      workspace?: { teamName?: string }
    }

    expect(commands).toEqual([["connector", "apps", "posthog", "--organization", "team-a", "--json"]])
    expect(output).toMatchObject({
      errorCode: "connection_inventory_unavailable",
      workspace: { teamName: "team-a" },
    })
  })

  it("fails closed when the session workspace file is unreadable", async () => {
    process.env.WANTA_TEAM_SCOPE_PATH = "/tmp/team-scope.json"
    process.env.WANTA_TEAM_NAME = "stale-default"
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
  it("builds OpenConnector authorization URLs from the configured Console origin", async () => {
    process.env.WANTA_LINK_RUNTIME = "openconnector"
    process.env.WANTA_CONNECTOR_URL = "http://127.0.0.1:3000"
    process.env.WANTA_CONSOLE_URL = "http://127.0.0.1:5173"
    const runtime = loadCallActionTool(async () => {
      const error = new Error("connector failed") as Error & { stderr: string }
      error.stderr = "Request failed (errorCode: connection_not_found): connection not found"
      throw error
    })

    const output = JSON.parse(
      await runtime.execute({ service: "google mail", action: "fetch_emails" }, { sessionID: "session-1" }),
    ) as { authUrl?: string; status?: string }

    expect(output).toMatchObject({
      authUrl: "http://127.0.0.1:5173/providers/google%20mail",
      status: "authorization_required",
    })
  })

  it("accepts OpenConnector aliases as connection names without organization arguments", async () => {
    process.env.WANTA_LINK_RUNTIME = "openconnector"
    process.env.WANTA_CONNECTOR_URL = "http://127.0.0.1:3000"
    const commands: string[][] = []
    const runtime = loadCallActionTool(async (...args) => {
      const argv = args[1] as string[]
      commands.push(argv)
      return commands.length === 1
        ? { stdout: JSON.stringify([{ alias: "work", service: "gmail", status: "active" }]) }
        : { stdout: JSON.stringify({ data: { ok: true } }) }
    })

    await runtime.execute(
      { service: "gmail", action: "fetch_emails", connectionName: "work" },
      { sessionID: "session-1" },
    )

    expect(commands).toHaveLength(2)
    expect(commands[0]).toEqual(["connector", "apps", "gmail", "--json"])
    expect(commands[1]).toContain("--connection-name")
    expect(commands[1]).not.toContain("--organization")
  })

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
