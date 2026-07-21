import { describe, expect, it } from "vitest"
import { resolveRuntimeCapabilities } from "./common.ts"

describe("resolveRuntimeCapabilities", () => {
  it("keeps cloud capabilities disabled for a local runtime", () => {
    expect(resolveRuntimeCapabilities({ mode: "local", localAgentAvailable: true })).toEqual({
      mode: "local",
      localAgent: true,
      localTools: true,
      customModels: true,
      oomolCloudModels: false,
      connectors: false,
      teams: false,
      billing: false,
      cloudSkills: false,
      voice: false,
    })
  })

  it("does not claim local tools before the local Agent runtime is available", () => {
    expect(resolveRuntimeCapabilities({ mode: "local", localAgentAvailable: false })).toMatchObject({
      mode: "local",
      localAgent: false,
      localTools: false,
      customModels: true,
      connectors: false,
    })
  })

  it("enables OOMOL-hosted capabilities without carrying credentials", () => {
    const capabilities = resolveRuntimeCapabilities({ mode: "oomol", localAgentAvailable: true })
    expect(capabilities).toEqual({
      mode: "oomol",
      localAgent: true,
      localTools: true,
      customModels: true,
      oomolCloudModels: true,
      connectors: true,
      teams: true,
      billing: true,
      cloudSkills: true,
      voice: true,
    })
    expect(capabilities).not.toHaveProperty("sessionToken")
    expect(capabilities).not.toHaveProperty("authToken")
    expect(capabilities).not.toHaveProperty("apiKey")
  })
})
