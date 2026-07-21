import { describe, expect, it } from "vitest"
import { resolveRuntimeCapabilities } from "./common.ts"

describe("resolveRuntimeCapabilities", () => {
  it("enables Link connectors independently from OOMOL account capabilities", () => {
    expect(
      resolveRuntimeCapabilities({ mode: "local", localAgentAvailable: true, linkRuntimeAvailable: true }),
    ).toEqual({
      mode: "local",
      localAgent: true,
      localTools: true,
      customModels: true,
      oomolCloudModels: false,
      connectors: true,
      teams: false,
      billing: false,
      cloudSkills: false,
      voice: false,
    })
  })

  it("does not claim local tools before the local Agent runtime is available", () => {
    expect(
      resolveRuntimeCapabilities({ mode: "local", localAgentAvailable: false, linkRuntimeAvailable: true }),
    ).toMatchObject({
      mode: "local",
      localAgent: false,
      localTools: false,
      customModels: true,
      connectors: false,
    })
  })

  it("disables connectors when the Link runtime is unavailable", () => {
    expect(
      resolveRuntimeCapabilities({ mode: "local", localAgentAvailable: true, linkRuntimeAvailable: false }),
    ).toMatchObject({
      localAgent: true,
      localTools: true,
      connectors: false,
    })
  })

  it("enables OOMOL-hosted capabilities without carrying credentials", () => {
    const capabilities = resolveRuntimeCapabilities({
      mode: "oomol",
      localAgentAvailable: true,
      linkRuntimeAvailable: true,
    })
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
