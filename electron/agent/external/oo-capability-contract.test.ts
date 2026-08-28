import { describe, expect, it } from "vitest"
import { ACP_AGENT_KINDS } from "../acp/registry.ts"
import {
  EXTERNAL_OO_OPERATIONS,
  externalOoExecutionPolicy,
  resolveExternalOoOperation,
} from "./oo-capability-contract.ts"

describe("external OO capability contract", () => {
  it("resolves enabled and unavailable domains from one ordered table", () => {
    expect(resolveExternalOoOperation(["search", "generate an image", "--json"])).toMatchObject({
      availability: "enabled",
      id: "capability.search",
    })
    expect(resolveExternalOoOperation(["--lang=en", "connector", "run", "posthog"])).toMatchObject({
      availability: "enabled",
      id: "connector.run",
      workspace: "required",
    })
    expect(resolveExternalOoOperation(["file", "download", "https://example.com/a"])).toMatchObject({
      availability: "planned",
      id: "file.download",
    })
    expect(resolveExternalOoOperation(["logout"])).toMatchObject({ availability: "denied", id: "logout" })
    expect(resolveExternalOoOperation(["unknown"])).toBeUndefined()
  })

  it("generates Skill guidance from the same operation table", () => {
    const policy = externalOoExecutionPolicy()
    for (const operation of EXTERNAL_OO_OPERATIONS) {
      if (operation.availability === "enabled") {
        expect(policy).toContain(`oo ${operation.command.join(" ")}`)
      } else {
        expect(policy).toContain(operation.id)
      }
    }
    expect(policy).toContain("Skip the Skill recommendation wrap-up")
  })

  it("applies the same enabled operation set to every generic ACP registration", () => {
    const enabled = EXTERNAL_OO_OPERATIONS.filter((operation) => operation.availability === "enabled").map(
      (operation) => operation.id,
    )
    const byAgent = Object.fromEntries(ACP_AGENT_KINDS.map((kind) => [kind, enabled]))
    expect(byAgent["claude-code"]).toEqual(enabled)
    expect(byAgent.codex).toEqual(enabled)
    expect(byAgent.grok).toEqual(enabled)
  })
})
