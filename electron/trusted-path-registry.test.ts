import { describe, expect, it } from "vitest"
import { ExpiringTrustedPathRegistry } from "./trusted-path-registry.ts"

describe("ExpiringTrustedPathRegistry", () => {
  it("expires abandoned draft paths and supports explicit release", () => {
    let now = 1_000
    const registry = new ExpiringTrustedPathRegistry(500, () => now)
    registry.add(" /tmp/first ")
    registry.add("/tmp/second")

    expect([...registry]).toEqual(["/tmp/first", "/tmp/second"])
    expect(registry.delete("/tmp/first")).toBe(true)
    expect([...registry]).toEqual(["/tmp/second"])

    now = 1_501
    expect([...registry]).toEqual([])
  })
})
