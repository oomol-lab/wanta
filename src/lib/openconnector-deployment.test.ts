import { describe, expect, it } from "vitest"
import {
  hasCompleteOpenConnectorEndpoints,
  inferOpenConnectorDeploymentMode,
  resolveOpenConnectorConsoleUrl,
} from "./openconnector-deployment.ts"

describe("OpenConnector deployment presentation", () => {
  it("defaults new configurations to the single-origin online mode", () => {
    expect(inferOpenConnectorDeploymentMode(undefined)).toBe("online")
  })

  it("infers online and local deployments from saved origins", () => {
    expect(
      inferOpenConnectorDeploymentMode({
        baseUrl: "https://runtime.example.test",
        consoleUrl: "https://runtime.example.test",
      }),
    ).toBe("online")
    expect(
      inferOpenConnectorDeploymentMode({
        baseUrl: "http://127.0.0.1:3000",
        consoleUrl: "http://127.0.0.1:5173",
      }),
    ).toBe("local")
  })

  it("uses the runtime origin for an online Console and the explicit Console origin locally", () => {
    expect(resolveOpenConnectorConsoleUrl("online", "https://runtime.example.test", "ignored")).toBe(
      "https://runtime.example.test",
    )
    expect(resolveOpenConnectorConsoleUrl("local", "http://127.0.0.1:3000", "http://127.0.0.1:5173")).toBe(
      "http://127.0.0.1:5173",
    )
  })

  it("requires both origins only for a local deployment", () => {
    expect(hasCompleteOpenConnectorEndpoints("online", "https://runtime.example.test", "")).toBe(true)
    expect(hasCompleteOpenConnectorEndpoints("local", "http://127.0.0.1:3000", "")).toBe(false)
    expect(hasCompleteOpenConnectorEndpoints("local", "http://127.0.0.1:3000", "http://127.0.0.1:5173")).toBe(true)
  })
})
