import { describe, expect, it } from "vitest"
import {
  DEFAULT_COMPOSER_AGENT_KIND,
  readStoredAgentComposerPrefs,
  writeStoredAgentComposerPrefs,
} from "./composer-agent-prefs.ts"

function memoryStorage(initial?: Record<string, string>) {
  const map = new Map(Object.entries(initial ?? {}))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  }
}

describe("composer agent prefs", () => {
  it("uses the built-in OpenCode agent for every fresh composer", () => {
    expect(DEFAULT_COMPOSER_AGENT_KIND).toBe("opencode")
  })

  it("keeps per-agent model/effort/permission preferences separate", () => {
    const storage = memoryStorage()
    writeStoredAgentComposerPrefs(storage, "codex", { effortId: "xhigh", modelId: "gpt-5.6-sol" })
    writeStoredAgentComposerPrefs(storage, "claude-code", { modelId: "claude-fable-5[1m]" })
    writeStoredAgentComposerPrefs(storage, "codex", { permissionMode: "read_only" })

    expect(readStoredAgentComposerPrefs(storage, "codex")).toEqual({
      effortId: "xhigh",
      modelId: "gpt-5.6-sol",
      permissionMode: "read_only",
    })
    expect(readStoredAgentComposerPrefs(storage, "claude-code")).toEqual({ modelId: "claude-fable-5[1m]" })
    expect(readStoredAgentComposerPrefs(storage, "opencode")).toEqual({})
  })

  it("clears a preference when the patch carries an explicit undefined", () => {
    const storage = memoryStorage()
    writeStoredAgentComposerPrefs(storage, "codex", { modelId: "gpt-5.6-sol", effortId: "xhigh" })
    writeStoredAgentComposerPrefs(storage, "codex", { modelId: undefined })
    expect(readStoredAgentComposerPrefs(storage, "codex")).toEqual({ effortId: "xhigh" })
  })

  it("never persists full_access and never restores it", () => {
    const storage = memoryStorage()
    writeStoredAgentComposerPrefs(storage, "claude-code", { permissionMode: "plan" })
    writeStoredAgentComposerPrefs(storage, "claude-code", { permissionMode: "full_access" })
    // The previous sticky mode survives a temporary full_access excursion.
    expect(readStoredAgentComposerPrefs(storage, "claude-code")).toEqual({ permissionMode: "plan" })

    const polluted = memoryStorage({
      "wanta.composerAgentPrefs": JSON.stringify({ byAgent: { "claude-code": { permissionMode: "full_access" } } }),
    })
    expect(readStoredAgentComposerPrefs(polluted, "claude-code")).toEqual({})
  })

  it("drops permission modes the agent profile does not declare", () => {
    const storage = memoryStorage({
      "wanta.composerAgentPrefs": JSON.stringify({ byAgent: { grok: { permissionMode: "plan" } } }),
    })
    expect(readStoredAgentComposerPrefs(storage, "grok")).toEqual({})
  })

  it("survives corrupted storage payloads", () => {
    const storage = memoryStorage({ "wanta.composerAgentPrefs": "{not json" })
    expect(readStoredAgentComposerPrefs(storage, "codex")).toEqual({})
    writeStoredAgentComposerPrefs(storage, "codex", { modelId: "gpt-5.5" })
    expect(readStoredAgentComposerPrefs(storage, "codex")).toEqual({ modelId: "gpt-5.5" })
  })
})
