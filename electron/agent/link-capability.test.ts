import type { LinkCommandExecutor } from "./link-capability.ts"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { describe, expect, test, vi } from "vitest"
import { HostCapabilityServer } from "./host-capability-server.ts"
import { HostCapabilityKernel } from "./host-capability.ts"
import { LinkCapability } from "./link-capability.ts"
import { createLinkHostCapability, LINK_CAPABILITY_ID, LINK_RUNTIME_BINDING } from "./link-host-capability.ts"

function oomolHarness(respond?: (args: string[]) => string) {
  const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = []
  const execute: LinkCommandExecutor = vi.fn(async (_command, args, options) => {
    calls.push({ args, env: options.env })
    return { stdout: respond?.(args) ?? JSON.stringify({ ok: true }), stderr: "" }
  })
  const capability = new LinkCapability({
    execute,
    ooBinPath: "/fake/oo",
    runtime: () => ({
      accountName: "owner",
      linkRuntime: { kind: "oomol", sessionToken: "secret-session-token" },
    }),
    storeDir: "/private/wanta/link",
  })
  return { calls, capability, execute }
}

describe("LinkCapability", () => {
  test("enriches action search with active-workspace authorization and no-auth readiness", async () => {
    const { capability } = oomolHarness((args) => {
      if (args[1] === "search") {
        return JSON.stringify([
          { service: "posthog", name: "run_query" },
          { service: "hackernews", name: "get_top_stories" },
          { service: "gmail", name: "list_messages" },
        ])
      }
      if (args[1] === "apps") return JSON.stringify([{ service: "posthog", status: "active" }])
      return "{}"
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              providers: [
                { service: "posthog", authTypes: ["oauth2"] },
                { service: "hackernews", authTypes: ["no_auth"] },
                { service: "gmail", authTypes: ["oauth2"] },
              ],
            }),
            { status: 200 },
          ),
        ),
      ),
    )
    try {
      const result = JSON.parse(
        await capability.searchActions({ sessionId: "session-1", teamName: "Analytics Team" }, "usage report"),
      ) as Array<Record<string, unknown>>
      expect(result).toEqual([
        expect.objectContaining({ service: "posthog", authenticated: true, authenticatedReliable: true }),
        expect.objectContaining({ service: "hackernews", authenticated: true, noAuthReady: true }),
        expect.objectContaining({ service: "gmail", authenticated: false, authUrl: expect.stringContaining("gmail") }),
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test("keeps schema identity-independent and binds calls to the exact Wanta team", async () => {
    const { calls, capability } = oomolHarness()
    const context = { sessionId: "session-1", teamName: "Analytics Team" }

    await capability.inspectActions(context, ["posthog.run_query"])
    await capability.callAction(context, {
      action: "run_query",
      params: { query: { kind: "HogQLQuery", query: "select 1" } },
      service: "posthog",
    })

    expect(calls[0].args).toEqual(["connector", "schema", "posthog.run_query", "--json"])
    expect(calls[1].args).toEqual([
      "connector",
      "run",
      "posthog",
      "--action",
      "run_query",
      "--data",
      JSON.stringify({ query: { kind: "HogQLQuery", query: "select 1" } }),
      "--team",
      "Analytics Team",
      "--json",
    ])
    expect(calls[1].env["OO_API_KEY"]).toBe("secret-session-token")
    expect(calls[1].env["WANTA_TEAM_NAME"]).toBe("Analytics Team")
  })

  test("validates an explicit connection name against the active workspace", async () => {
    const { calls, capability } = oomolHarness((args) =>
      args[1] === "apps"
        ? JSON.stringify({ apps: [{ connectionName: "prod", status: "active" }] })
        : JSON.stringify({ ok: true }),
    )
    const result = await capability.callAction(
      { sessionId: "session-1", teamName: "Analytics Team" },
      { action: "run_query", connectionName: "missing", service: "posthog" },
    )

    expect(JSON.parse(result)).toMatchObject({ status: "error", errorCode: "invalid_connection_name" })
    expect(calls).toHaveLength(1)
    expect(calls[0].args).toEqual(["connector", "apps", "posthog", "--team", "Analytics Team", "--json"])
  })

  test("returns a redacted, workspace-specific authorization result", async () => {
    const execute: LinkCommandExecutor = vi.fn(async () => {
      throw Object.assign(new Error("connector failed"), {
        stderr: "errorCode: connection_required token=secret-session-token",
      })
    })
    const capability = new LinkCapability({
      execute,
      ooBinPath: "/fake/oo",
      runtime: () => ({ linkRuntime: { kind: "oomol", sessionToken: "secret-session-token" } }),
      storeDir: "/private/wanta/link",
    })
    const result = await capability.callAction(
      { sessionId: "session-1", teamName: "Analytics Team" },
      { action: "run_query", service: "posthog" },
    )

    expect(JSON.parse(result)).toMatchObject({
      status: "authorization_required",
      errorCode: "connection_required",
      service: "posthog",
      action: "run_query",
      workspace: { runtime: "oomol", teamName: "Analytics Team" },
    })
    expect(result).not.toContain("secret-session-token")
  })

  test("coalesces concurrent authorization probes and blocks repeated calls to the same connection", async () => {
    let release: (() => void) | undefined
    const execute: LinkCommandExecutor = vi.fn(
      () =>
        new Promise<{ stderr: string; stdout: string }>((_resolve, reject) => {
          release = () => reject(Object.assign(new Error("blocked"), { stderr: "errorCode: connection_required" }))
        }),
    )
    const capability = new LinkCapability({
      execute,
      ooBinPath: "/fake/oo",
      runtime: () => ({ linkRuntime: { kind: "oomol", sessionToken: "secret-session-token" } }),
      storeDir: "/private/wanta/link",
    })
    const context = { sessionId: "session-1", teamName: "Analytics Team" }
    const input = { action: "run_query", service: "posthog" }
    const first = capability.callAction(context, input)
    const second = capability.callAction(context, input)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    release?.()

    expect(JSON.parse(await first)).toMatchObject({ status: "authorization_required" })
    expect(JSON.parse(await second)).toMatchObject({ status: "skipped", reason: "connection_blocked" })
    expect(JSON.parse(await capability.callAction(context, input))).toMatchObject({
      status: "skipped",
      reason: "connection_blocked",
    })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  test("never exceeds the action concurrency limit while handing slots to queued calls", async () => {
    let active = 0
    let maxActive = 0
    const execute: LinkCommandExecutor = vi.fn(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return { stderr: "", stdout: JSON.stringify({ data: { ok: true } }) }
    })
    const capability = new LinkCapability({
      execute,
      ooBinPath: "/fake/oo",
      runtime: () => ({ linkRuntime: { kind: "oomol", sessionToken: "secret-session-token" } }),
      storeDir: "/private/wanta/link",
    })
    const context = { sessionId: "session-1", teamName: "Analytics Team" }

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        capability.callAction(context, {
          action: "run_query",
          params: { projectId: index },
          service: "posthog",
        }),
      ),
    )

    expect(maxActive).toBe(2)
  })
})

test("HostCapabilityServer exposes Link tools through an authenticated loopback endpoint", async () => {
  const { calls, capability } = oomolHarness()
  const kernel = new HostCapabilityKernel()
  kernel.register(createLinkHostCapability(capability))
  const server = new HostCapabilityServer({
    capabilityIds: [LINK_CAPABILITY_ID],
    kernel,
    name: "wanta_link",
    version: "1.0.0",
  })
  const initialContext = {
    bindings: {
      [LINK_RUNTIME_BINDING]: { linkRuntime: { kind: "oomol", sessionToken: "secret-session-token" } },
    },
    sessionId: "session-1",
    teamName: "Analytics Team",
  }
  const [descriptor, concurrentDescriptor] = await Promise.all([
    server.issue(initialContext),
    server.issue(initialContext),
  ])
  expect(concurrentDescriptor).toEqual(descriptor)
  const transport = new StreamableHTTPClientTransport(new URL(descriptor.url), {
    requestInit: { headers: descriptor.headers },
  })
  const client = new Client({ name: "wanta-test", version: "1.0.0" })
  try {
    await expect(fetch(descriptor.url)).resolves.toMatchObject({ status: 404 })
    await client.connect(transport)
    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "list_apps",
      "search_actions",
      "inspect_action",
      "call_action",
    ])
    const result = await client.callTool({
      name: "inspect_action",
      arguments: { actions: ["posthog.run_query"] },
    })
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify({ ok: true }) }])

    server.disableSession("session-1")
    const disabled = await client.callTool({ name: "list_apps", arguments: { service: "posthog" } })
    expect(disabled.isError).toBe(true)

    const refreshed = await server.issue({
      bindings: {
        [LINK_RUNTIME_BINDING]: { linkRuntime: { kind: "oomol", sessionToken: "secret-session-token" } },
      },
      sessionId: "session-1",
      teamName: "Team B",
      turnId: "turn-2",
    })
    expect(refreshed).toEqual(descriptor)
    await client.callTool({ name: "list_apps", arguments: { service: "posthog" } })
    expect(calls.at(-1)?.args).toEqual(["connector", "apps", "posthog", "--team", "Team B", "--json"])
  } finally {
    await client.close().catch(() => undefined)
    await server.dispose()
  }
})
