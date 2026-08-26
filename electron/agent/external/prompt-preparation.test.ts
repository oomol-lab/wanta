import type { PromptAgentInput } from "../contract/input.ts"

import { describe, expect, it, vi } from "vitest"
import { memoizePromptPreparation, memoizePromptRoutePreparation } from "./prompt-preparation.ts"

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("memoizePromptPreparation", () => {
  it("shares one immutable preparation across hooks for the same prompt object", async () => {
    const prepare = vi.fn(async (input: { model: string }) => ({
      model: input.model,
      sequence: prepare.mock.calls.length,
    }))
    const prepared = memoizePromptPreparation(prepare)
    const prompt = { model: "first" }

    const first = prepared(prompt)
    prompt.model = "changed-after-submit"
    const second = prepared(prompt)

    expect(first).toBe(second)
    await expect(first).resolves.toEqual({ model: "first", sequence: 1 })
    expect(prepare).toHaveBeenCalledTimes(1)
  })

  it("prepares distinct prompt objects independently", async () => {
    const prepare = vi.fn(async (input: { model: string }) => input.model)
    const prepared = memoizePromptPreparation(prepare)

    await expect(Promise.all([prepared({ model: "one" }), prepared({ model: "two" })])).resolves.toEqual(["one", "two"])
    expect(prepare).toHaveBeenCalledTimes(2)
  })

  it("snapshots route fields before asynchronous model resolution", async () => {
    const gate = deferred()
    const prepare = vi.fn(async (input: { model?: unknown; reasoningLevel?: string; sessionId: string }) => {
      await gate.promise
      return input
    })
    const prepared = memoizePromptRoutePreparation(prepare)
    const prompt: PromptAgentInput = {
      type: "prompt",
      sessionId: "session-original",
      text: "hello",
      model: { kind: "builtin", id: "gpt-5.6-sol" },
      reasoningLevel: "high",
    }

    const result = prepared(prompt)
    prompt.sessionId = "session-mutated"
    prompt.model = { kind: "builtin", id: "oopilot" }
    prompt.reasoningLevel = "low"
    gate.resolve()

    await expect(result).resolves.toEqual({
      sessionId: "session-original",
      model: { kind: "builtin", id: "gpt-5.6-sol" },
      reasoningLevel: "high",
    })
    expect(prepare).toHaveBeenCalledTimes(1)
  })
})
