import type { LinkCommandExecutor } from "./link-capability.ts"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { afterEach, expect, test, vi } from "vitest"
import { HostCapabilityInvokeServer } from "./host-capability-invoke-server.ts"
import { HostCapabilityServer } from "./host-capability-server.ts"
import { HostCapabilityKernel } from "./host-capability.ts"
import { LinkCapability } from "./link-capability.ts"
import { createLinkHostCapability, LINK_CAPABILITY_ID, LINK_RUNTIME_BINDING } from "./link-host-capability.ts"

const disposables: Array<{ dispose(): Promise<void> }> = []

afterEach(async () => Promise.all(disposables.splice(0).map((disposable) => disposable.dispose())))

test("built-in invoke and external MCP transports execute the same Link capability and workspace", async () => {
  const execute: LinkCommandExecutor = vi.fn(async (_command, args) => ({
    stderr: "",
    stdout: JSON.stringify({ args, connectionName: "production", service: "posthog", status: "active" }),
  }))
  const kernel = new HostCapabilityKernel()
  kernel.register(
    createLinkHostCapability(
      new LinkCapability({
        execute,
        ooBinPath: "/fake/oo",
        runtime: () => null,
        storeDir: "/private/wanta/link",
      }),
    ),
  )
  const context = {
    bindings: {
      [LINK_RUNTIME_BINDING]: { linkRuntime: { kind: "oomol" as const, sessionToken: "secret" } },
    },
    sessionId: "session-1",
    teamName: "Analytics Team",
  }

  const invoke = new HostCapabilityInvokeServer(kernel, [LINK_CAPABILITY_ID])
  disposables.push(invoke)
  invoke.update(context)
  const invokeConnection = await invoke.connection()
  const builtInResponse = await fetch(`${invokeConnection.url}/v1/invoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${invokeConnection.token}`, "content-type": "application/json" },
    body: JSON.stringify({
      capability: LINK_CAPABILITY_ID,
      input: { service: "posthog" },
      sessionId: context.sessionId,
      tool: "list_apps",
    }),
  })
  const builtIn = (await builtInResponse.json()) as { result: string }

  const mcp = new HostCapabilityServer({
    capabilityIds: [LINK_CAPABILITY_ID],
    kernel,
    name: "wanta_link_parity",
    version: "1",
  })
  disposables.push(mcp)
  const descriptor = await mcp.issue(context)
  const transport = new StreamableHTTPClientTransport(new URL(descriptor.url), {
    requestInit: { headers: descriptor.headers },
  })
  const client = new Client({ name: "parity-test", version: "1" })
  await client.connect(transport)
  try {
    const external = await client.callTool({ name: "list_apps", arguments: { service: "posthog" } })
    expect(external.content).toEqual([{ type: "text", text: builtIn.result }])
    expect(builtIn.result).not.toContain("secret")
    expect(JSON.stringify(external.content)).not.toContain("secret")
    expect(JSON.parse(builtIn.result)).toMatchObject({
      args: ["connector", "apps", "posthog", "--team", "Analytics Team", "--json"],
    })
  } finally {
    await client.close()
  }
})
