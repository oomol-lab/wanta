import { describe, expect, it, vi } from "vitest"
import { memoizePromptPreparation } from "./prompt-preparation.ts"

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
})
