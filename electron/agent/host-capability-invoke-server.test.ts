import { afterEach, expect, test } from "vitest"
import { z } from "zod"
import { HostCapabilityInvokeServer } from "./host-capability-invoke-server.ts"
import { HostCapabilityKernel } from "./host-capability.ts"

const servers: HostCapabilityInvokeServer[] = []
afterEach(async () => Promise.all(servers.splice(0).map((server) => server.dispose())))

test("sidecar invoke transport binds the registered Wanta session context", async () => {
  const kernel = new HostCapabilityKernel()
  kernel.register({
    id: "test",
    version: "1",
    tools: [
      {
        name: "whoami",
        description: "",
        inputSchema: z.object({}),
        execute: async (context) => ({ text: context.teamName ?? "none" }),
      },
    ],
  })
  const server = new HostCapabilityInvokeServer(kernel, ["test"])
  servers.push(server)
  server.update({ bindings: {}, sessionId: "session-1", teamName: "team-a" })
  const connection = await server.connection()

  const response = await fetch(`${connection.url}/v1/invoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${connection.token}`, "content-type": "application/json" },
    body: JSON.stringify({ capability: "test", tool: "whoami", sessionId: "session-1", input: {} }),
  })
  expect(await response.json()).toEqual({ result: "team-a" })
  server.disableSession("session-1")
  const disabled = await fetch(`${connection.url}/v1/invoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${connection.token}`, "content-type": "application/json" },
    body: JSON.stringify({ capability: "test", tool: "whoami", sessionId: "session-1", input: {} }),
  })
  expect(disabled.status).toBe(400)
})
