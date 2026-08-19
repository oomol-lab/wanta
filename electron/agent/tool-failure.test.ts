import { describe, expect, test } from "vitest"
import { classifyToolFailure } from "./tool-failure.ts"

describe("tool failure classification", () => {
  test.each([
    ["zsh: parse error near ')'", { failureKind: "input", userImpact: "none" }],
    [
      "Current environment may be running in a network-restricted sandbox.",
      { failureKind: "sandbox", userImpact: "none" },
    ],
    ["credential_expired", { failureKind: "authorization" }],
    ["request timeout", { failureKind: "network" }],
    ["provider_error HTTP 502", { failureKind: "provider" }],
    ["ACP connection closed", { failureKind: "agent_runtime" }],
  ])("classifies %s", (message, expected) => {
    expect(classifyToolFailure(message)).toEqual(expected)
  })
})
