import type { PersistedCustomModel } from "../models/store.ts"

import { describe, expect, test } from "vitest"
import { resolveAgentRuntime } from "./agent-runtime.ts"

const customModels: PersistedCustomModel[] = [
  {
    id: "custom-a",
    providerId: "custom",
    providerName: "Custom",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: "local-key",
    modelName: "model-a",
  },
  {
    id: "custom-b",
    providerId: "custom",
    providerName: "Custom",
    baseUrl: "https://example.com/v1",
    apiKey: "remote-key",
    modelName: "model-b",
  },
]

describe("resolveAgentRuntime", () => {
  test("returns model_required state when signed out without custom models", () => {
    expect(resolveAgentRuntime(null, { kind: "builtin", id: "oopilot" }, [])).toBeNull()
  })

  test("does not start a local runtime for a custom model without an API key", () => {
    expect(
      resolveAgentRuntime(null, { kind: "custom", id: "invalid" }, [
        { ...customModels[0]!, id: "invalid", apiKey: "" },
      ]),
    ).toBeNull()
  })

  test("never treats an empty OOMOL token as a cloud runtime credential", () => {
    expect(
      resolveAgentRuntime({ id: "account", sessionToken: "  " }, { kind: "builtin", id: "oopilot" }, []),
    ).toBeNull()
  })

  test("uses the selected custom model for a signed-out local runtime", () => {
    expect(resolveAgentRuntime(null, { kind: "custom", id: "custom-b" }, customModels)).toMatchObject({
      cloudRuntime: { kind: "local" },
      defaultModel: { kind: "custom", id: "custom-b" },
      key: "local:custom-b",
      mode: "local",
    })
  })

  test("falls back to the first available custom model when the builtin selection is unavailable locally", () => {
    expect(resolveAgentRuntime(null, { kind: "builtin", id: "oopilot" }, customModels)?.defaultModel).toEqual({
      kind: "custom",
      id: "custom-a",
    })
  })

  test("keeps the selected model and token private in an OOMOL runtime resolution", () => {
    const resolution = resolveAgentRuntime(
      { id: "account", sessionToken: "session-secret" },
      { kind: "builtin", id: "oopilot" },
      customModels,
    )
    expect(resolution).toMatchObject({
      cloudRuntime: { kind: "oomol", sessionToken: "session-secret" },
      defaultModel: { kind: "builtin", id: "oopilot" },
      mode: "oomol",
    })
  })
})
