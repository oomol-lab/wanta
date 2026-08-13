import { describe, expect, test, vi } from "vitest"
import { z } from "zod"
import { HostCapabilityLease } from "./host-capability-lease.ts"
import { HostCapabilityServer } from "./host-capability-server.ts"
import { HostCapabilityKernel } from "./host-capability.ts"

const context = {
  bindings: {},
  sessionId: "session-1",
  turnId: "turn-1",
}

describe("HostCapabilityKernel", () => {
  test("validates inputs and emits metadata-only audit records", async () => {
    const execute = vi.fn(async (_context, input: Record<string, unknown>) => ({ text: String(input["value"]) }))
    const onAudit = vi.fn()
    const kernel = new HostCapabilityKernel({ onAudit })
    kernel.register({
      id: "fixture",
      version: "1.0.0",
      tools: [{ name: "echo", description: "Echo", inputSchema: z.object({ value: z.string() }), execute }],
    })

    await expect(kernel.execute("fixture", "echo", context, { value: "ok" })).resolves.toEqual({ text: "ok" })
    await expect(kernel.execute("fixture", "echo", context, { value: 42 })).rejects.toThrow("Invalid input")
    expect(execute).toHaveBeenCalledTimes(1)
    expect(onAudit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        capability: "fixture",
        outcome: "success",
        sessionId: "session-1",
        tool: "echo",
        turnId: "turn-1",
      }),
    )
    expect(onAudit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ capability: "fixture", outcome: "validation_error", tool: "echo" }),
    )
    expect(JSON.stringify(onAudit.mock.calls)).not.toContain("ok")
  })

  test("rejects duplicate capabilities and duplicate tool names", () => {
    const tool = {
      name: "echo",
      description: "Echo",
      inputSchema: z.object({}),
      execute: async () => ({ text: "ok" }),
    }
    const kernel = new HostCapabilityKernel()
    expect(() => kernel.register({ id: "duplicate-tools", version: "1", tools: [tool, tool] })).toThrow(
      "duplicate tool",
    )
    kernel.register({ id: "fixture", version: "1", tools: [tool] })
    expect(() => kernel.register({ id: "fixture", version: "2", tools: [tool] })).toThrow("already registered")
  })
})

describe("HostCapabilityLease", () => {
  test("refreshes one session context, disables it, and cannot revive after revoke", () => {
    const lease = new HostCapabilityLease(context)
    expect(lease.context().turnId).toBe("turn-1")

    lease.update({ ...context, teamName: "Team B", turnId: "turn-2" })
    expect(lease.context()).toMatchObject({ sessionId: "session-1", teamName: "Team B", turnId: "turn-2" })
    expect(() => lease.update({ ...context, sessionId: "session-2" })).toThrow("cannot change session identity")

    lease.disable()
    expect(lease.snapshot()).toMatchObject({ sessionId: "session-1", status: "disabled" })
    expect(() => lease.context()).toThrow("context is unavailable")

    lease.update({ ...context, turnId: "turn-3" })
    expect(lease.snapshot().status).toBe("active")
    lease.revoke()
    expect(lease.snapshot().status).toBe("revoked")
    expect(() => lease.update(context)).toThrow("has been revoked")
  })
})

test("HostCapabilityServer revokes an issuance that is still starting", async () => {
  const kernel = new HostCapabilityKernel()
  kernel.register({ id: "empty", version: "1", tools: [] })
  const server = new HostCapabilityServer({ capabilityIds: ["empty"], kernel, name: "empty", version: "1" })
  try {
    const issuance = server.issue(context)
    await server.revokeSession(context.sessionId)
    await expect(issuance).resolves.toBeTruthy()
    await expect(server.issue(context)).rejects.toThrow("has been revoked")
  } finally {
    await server.dispose()
  }
})
