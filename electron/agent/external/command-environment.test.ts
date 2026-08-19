import { describe, expect, test, vi } from "vitest"
import { memoizeExternalCommandEnvironment } from "./command-environment.ts"

describe("memoizeExternalCommandEnvironment", () => {
  test("retries after failure, caches success, and returns isolated copies", async () => {
    const create = vi
      .fn<() => Promise<NodeJS.ProcessEnv>>()
      .mockRejectedValueOnce(new Error("temporary setup failure"))
      .mockResolvedValue({ PATH: "/managed/bin", WANTA_OO_BIN: "/managed/bin/oo" })
    const environment = memoizeExternalCommandEnvironment(create)

    await expect(environment()).rejects.toThrow("temporary setup failure")
    const first = await environment()
    first.PATH = "/mutated"
    const second = await environment()

    expect(create).toHaveBeenCalledTimes(2)
    expect(second).toEqual({ PATH: "/managed/bin", WANTA_OO_BIN: "/managed/bin/oo" })
    expect(second).not.toBe(first)
  })
})
