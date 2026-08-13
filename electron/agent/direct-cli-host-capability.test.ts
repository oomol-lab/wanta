import { expect, test, vi } from "vitest"
import { createDirectCliHostCapability } from "./direct-cli-host-capability.ts"
import { HostCapabilityKernel } from "./host-capability.ts"
import { SKILL_SNAPSHOT_BINDING } from "./skill-host-capability.ts"

const skillSnapshot = {
  createdAt: 1,
  diagnostics: [],
  entries: new Map([
    [
      "lark-calendar",
      {
        id: "lark-calendar",
        name: "Lark Calendar",
        root: "/skills/lark-calendar",
        source: { id: "direct-lark", kind: "connection" as const },
      },
    ],
  ]),
}

test("direct CLI host capability dispatches validated argv to the selected provider", async () => {
  const calls: unknown[] = []
  const kernel = new HostCapabilityKernel()
  kernel.register(
    createDirectCliHostCapability({
      connected: () => Promise.resolve(["lark"]),
      execute: (provider, args) => {
        calls.push({ args, provider })
        return Promise.resolve({ stderr: "", stdout: "ok" })
      },
    }),
  )
  const context = { bindings: { [SKILL_SNAPSHOT_BINDING]: skillSnapshot }, sessionId: "session-1" }

  expect(JSON.parse((await kernel.execute("direct_cli", "list_direct_providers", context, {})).text)).toEqual({
    providers: ["lark"],
  })
  expect(
    JSON.parse(
      (
        await kernel.execute("direct_cli", "call_direct_provider", context, {
          provider: "lark",
          skillId: "lark-calendar",
          args: ["calendar", "list", "--json"],
        })
      ).text,
    ),
  ).toEqual({ stderr: "", stdout: "ok" })
  expect(calls).toEqual([{ args: ["calendar", "list", "--json"], provider: "lark" }])
})

test("direct CLI host capability rejects administration and unsafe argv before dispatch", async () => {
  const execute = vi.fn(() => Promise.resolve({ stderr: "", stdout: "ok" }))
  const kernel = new HostCapabilityKernel()
  kernel.register(createDirectCliHostCapability({ connected: () => Promise.resolve(["lark"]), execute }))
  const context = { bindings: { [SKILL_SNAPSHOT_BINDING]: skillSnapshot }, sessionId: "session-1" }

  await expect(
    kernel.execute("direct_cli", "call_direct_provider", context, {
      provider: "lark",
      skillId: "lark-calendar",
      args: ["auth", "status"],
    }),
  ).rejects.toThrow(/administration is host-only/)
  await expect(
    kernel.execute("direct_cli", "call_direct_provider", context, {
      provider: "lark",
      skillId: "lark-calendar",
      args: ["calendar", "list\nconfig"],
    }),
  ).rejects.toThrow(/control-line characters/)
  expect(execute).not.toHaveBeenCalled()
})

test("direct CLI host capability requires a provider-matching Skill from the same turn", async () => {
  const execute = vi.fn(() => Promise.resolve({ stderr: "", stdout: "ok" }))
  const kernel = new HostCapabilityKernel()
  kernel.register(createDirectCliHostCapability({ connected: () => Promise.resolve(["lark"]), execute }))

  await expect(
    kernel.execute(
      "direct_cli",
      "call_direct_provider",
      { bindings: { [SKILL_SNAPSHOT_BINDING]: skillSnapshot }, sessionId: "session-1" },
      { provider: "wecom", skillId: "lark-calendar", args: ["todo", "get_todo_list", "{}"] },
    ),
  ).rejects.toThrow(/active wecom Skill/)
  expect(execute).not.toHaveBeenCalled()
})
