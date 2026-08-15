import { expect, test, vi } from "vitest"
import { HostCapabilityKernel } from "./host-capability.ts"
import { createKnowledgeHostCapability } from "./knowledge-host-capability.ts"

test("knowledge capability builds bounded read-only WikiGraph queries", async () => {
  const calls: string[][] = []
  const kernel = new HostCapabilityKernel()
  kernel.register(
    createKnowledgeHostCapability({
      run: (argv) => {
        calls.push([...argv])
        return Promise.resolve("evidence")
      },
    }),
  )
  const context = { bindings: {}, sessionId: "session-1" }

  const result = await kernel.execute("knowledge", "knowledge_query", context, {
    uri: "wikg://lib/arc/book/entity",
    operation: "related",
    query: "曹操",
    evidence: 2,
    limit: 10,
    json: true,
  })

  expect(result.text).toBe("evidence")
  expect(calls).toEqual([
    ["wikg://lib/arc/book/entity", "related", "--query", "曹操", "--evidence", "2", "--limit", "10", "--json"],
  ])
})

test("knowledge capability rejects paths outside Wanta's managed library", async () => {
  const kernel = new HostCapabilityKernel()
  kernel.register(createKnowledgeHostCapability({ run: () => Promise.resolve("") }))

  await expect(
    kernel.execute(
      "knowledge",
      "knowledge_query",
      { bindings: {}, sessionId: "session-1" },
      {
        uri: "wikg:///Users/example/private.wikg",
      },
    ),
  ).rejects.toThrow(/stay within wikg:\/\/lib/)
})

test("knowledge capability rejects a cursor that could become a CLI option", async () => {
  const run = vi.fn(() => Promise.resolve(""))
  const kernel = new HostCapabilityKernel()
  kernel.register(createKnowledgeHostCapability({ run }))

  await expect(
    kernel.execute(
      "knowledge",
      "knowledge_next",
      { bindings: {}, sessionId: "session-1" },
      { cursor: "--output=/tmp/leak" },
    ),
  ).rejects.toThrow()
  expect(run).not.toHaveBeenCalled()
})
