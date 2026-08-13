import { describe, expect, it } from "vitest"
import {
  DEFAULT_COMPOSER_AGENT_KIND,
  readStoredAgentComposerPrefs,
  readStoredDefaultAgentKind,
  writeStoredDefaultAgentKind,
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
  it("falls back to OpenCode until the user explicitly chooses a default agent", () => {
    const storage = memoryStorage()
    expect(DEFAULT_COMPOSER_AGENT_KIND).toBe("opencode")
    expect(readStoredDefaultAgentKind(storage)).toBe("opencode")
  })

  it("uses the most recently selected agent for future new-chat drafts", () => {
    const storage = memoryStorage()
    writeStoredDefaultAgentKind(storage, "codex")
    expect(readStoredDefaultAgentKind(storage)).toBe("codex")
    writeStoredDefaultAgentKind(storage, "claude-code")
    expect(readStoredDefaultAgentKind(storage)).toBe("claude-code")
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

  it("changing the default agent preserves every agent's own sticky preferences", () => {
    const storage = memoryStorage()
    writeStoredAgentComposerPrefs(storage, "codex", { modelId: "gpt-5.6-sol", effortId: "xhigh" })
    writeStoredDefaultAgentKind(storage, "codex")
    writeStoredAgentComposerPrefs(storage, "claude-code", { modelId: "sonnet", permissionMode: "auto" })
    writeStoredDefaultAgentKind(storage, "claude-code")

    expect(readStoredDefaultAgentKind(storage)).toBe("claude-code")
    expect(readStoredAgentComposerPrefs(storage, "codex")).toEqual({ modelId: "gpt-5.6-sol", effortId: "xhigh" })
    expect(readStoredAgentComposerPrefs(storage, "claude-code")).toEqual({
      modelId: "sonnet",
      permissionMode: "auto",
    })
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
