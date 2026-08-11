import type { AgentKind } from "../../../electron/agent/contract/profile.ts"

import { describe, expect, it } from "vitest"
import {
  readStoredAgentComposerPrefs,
  readStoredLastAgentKind,
  writeStoredAgentComposerPrefs,
  writeStoredLastAgentKind,
} from "./composer-agent-prefs.ts"

// Adversarial edge tests for the sticky composer preference storage. All of
// these must degrade to defaults WITHOUT throwing: the prefs layer sits on the
// render path of the composer, so any exception here breaks new-chat drafts.

const KEY = "wanta.composerAgentPrefs"

function memoryStorage(initial?: Record<string, string>) {
  const map = new Map(Object.entries(initial ?? {}))
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  }
}

describe("composer-agent-prefs: storage failures", () => {
  it("setItem throwing (quota exceeded) loses stickiness but never throws", () => {
    const storage = memoryStorage()
    writeStoredAgentComposerPrefs(storage, "codex", { modelId: "gpt-5.2" })
    const quotaStorage = {
      getItem: storage.getItem,
      setItem: (): void => {
        throw new DOMException("QuotaExceededError")
      },
    }
    expect(() => writeStoredAgentComposerPrefs(quotaStorage, "codex", { modelId: "gpt-5.3" })).not.toThrow()
    expect(() => writeStoredLastAgentKind(quotaStorage, "grok")).not.toThrow()
    // The previously persisted value is still readable; the failed write is lost.
    expect(readStoredAgentComposerPrefs(storage, "codex")).toEqual({ modelId: "gpt-5.2" })
  })

  it("getItem throwing degrades reads to defaults and writes to a fresh store", () => {
    const written: string[] = []
    const storage = {
      getItem: (): string => {
        throw new Error("SecurityError: storage disabled")
      },
      setItem: (_key: string, value: string): void => void written.push(value),
    }
    expect(readStoredLastAgentKind(storage)).toBeUndefined()
    expect(readStoredAgentComposerPrefs(storage, "codex")).toEqual({})
    expect(() => writeStoredAgentComposerPrefs(storage, "codex", { modelId: "gpt-5.2" })).not.toThrow()
    // The write starts from an empty store instead of propagating the error.
    expect(JSON.parse(written.at(-1) ?? "{}")).toEqual({ byAgent: { codex: { modelId: "gpt-5.2" } } })
  })

  it("null and undefined storage degrade to defaults", () => {
    expect(readStoredLastAgentKind(null)).toBeUndefined()
    expect(readStoredAgentComposerPrefs(undefined, "codex")).toEqual({})
    expect(() => writeStoredAgentComposerPrefs(null, "codex", { modelId: "x" })).not.toThrow()
    expect(() => writeStoredLastAgentKind(undefined, "codex")).not.toThrow()
  })
})

describe("composer-agent-prefs: malformed persisted shapes", () => {
  it("byAgent stored as an array degrades to defaults and stays writable", () => {
    const storage = memoryStorage({ [KEY]: JSON.stringify({ byAgent: ["oops", { modelId: "x" }] }) })
    expect(readStoredAgentComposerPrefs(storage, "codex")).toEqual({})
    expect(() => writeStoredAgentComposerPrefs(storage, "codex", { modelId: "gpt-5.2" })).not.toThrow()
    expect(readStoredAgentComposerPrefs(storage, "codex")).toEqual({ modelId: "gpt-5.2" })
  })

  it("byAgent stored as a string degrades to defaults and stays writable", () => {
    const storage = memoryStorage({ [KEY]: JSON.stringify({ byAgent: "corrupted" }) })
    expect(readStoredAgentComposerPrefs(storage, "grok")).toEqual({})
    expect(() => writeStoredAgentComposerPrefs(storage, "grok", { modelId: "grok-4" })).not.toThrow()
    expect(readStoredAgentComposerPrefs(storage, "grok")).toEqual({ modelId: "grok-4" })
  })

  it("per-agent entries of the wrong primitive type degrade to defaults", () => {
    const storage = memoryStorage({
      [KEY]: JSON.stringify({ byAgent: { codex: "gpt-5.2", grok: 42, "claude-code": null } }),
    })
    expect(readStoredAgentComposerPrefs(storage, "codex")).toEqual({})
    expect(readStoredAgentComposerPrefs(storage, "grok")).toEqual({})
    expect(readStoredAgentComposerPrefs(storage, "claude-code")).toEqual({})
  })

  it("field values of the wrong type are dropped individually", () => {
    const storage = memoryStorage({
      [KEY]: JSON.stringify({
        byAgent: { codex: { modelId: 7, effortId: "", permissionMode: ["read_only"] } },
      }),
    })
    expect(readStoredAgentComposerPrefs(storage, "codex")).toEqual({})
  })

  it("a top-level array, number, or null payload degrades to defaults", () => {
    for (const payload of ["[1,2,3]", "42", "null", '"str"']) {
      const storage = memoryStorage({ [KEY]: payload })
      expect(readStoredLastAgentKind(storage)).toBeUndefined()
      expect(readStoredAgentComposerPrefs(storage, "codex")).toEqual({})
    }
  })

  it("a non-string lastAgentKind degrades to undefined", () => {
    const storage = memoryStorage({ [KEY]: JSON.stringify({ lastAgentKind: 3 }) })
    expect(readStoredLastAgentKind(storage)).toBeUndefined()
  })
})

describe("composer-agent-prefs: unknown agent kinds (removed-agent leftovers)", () => {
  // "gemini-cli" is a real leftover scenario: the registry replaced gemini with
  // grok, but persisted sessions / stored prefs can still carry the old kind.
  const removedKind = "gemini-cli" as AgentKind

  it("reading prefs for a kind not in AGENT_PROFILES returns defaults without throwing", () => {
    const storage = memoryStorage({
      [KEY]: JSON.stringify({ byAgent: { "gemini-cli": { modelId: "gemini-2.5-pro" } } }),
    })
    // modelId-only entries never touch AGENT_PROFILES; this part already works.
    expect(() => readStoredAgentComposerPrefs(storage, removedKind)).not.toThrow()
  })

  it("reading prefs with a stored permissionMode for an unknown kind must not throw", () => {
    const storage = memoryStorage({
      [KEY]: JSON.stringify({ byAgent: { "gemini-cli": { modelId: "gemini-2.5-pro", permissionMode: "plan" } } }),
    })
    // A removed agent kind has no profile to validate against; the whole
    // entry degrades to defaults instead of dereferencing undefined.
    expect(() => readStoredAgentComposerPrefs(storage, removedKind)).not.toThrow()
    expect(readStoredAgentComposerPrefs(storage, removedKind)).toEqual({})
  })

  it("writing prefs for an unknown kind does not throw and does not corrupt other agents", () => {
    const storage = memoryStorage()
    writeStoredAgentComposerPrefs(storage, "codex", { modelId: "gpt-5.2" })
    expect(() => writeStoredAgentComposerPrefs(storage, removedKind, { modelId: "leftover" })).not.toThrow()
    expect(readStoredAgentComposerPrefs(storage, "codex")).toEqual({ modelId: "gpt-5.2" })
  })
})

describe("composer-agent-prefs: auto permission mode", () => {
  it("auto is sticky for claude-code, unlike full_access", () => {
    const storage = memoryStorage()
    writeStoredAgentComposerPrefs(storage, "claude-code", { permissionMode: "auto" })
    expect(readStoredAgentComposerPrefs(storage, "claude-code")).toEqual({ permissionMode: "auto" })
    // full_access never persists; the previous sticky mode stays.
    writeStoredAgentComposerPrefs(storage, "claude-code", { permissionMode: "full_access" })
    expect(readStoredAgentComposerPrefs(storage, "claude-code")).toEqual({ permissionMode: "auto" })
  })

  it("a stored auto mode degrades to defaults for agents that do not declare it", () => {
    const storage = memoryStorage({
      [KEY]: JSON.stringify({ byAgent: { codex: { permissionMode: "auto" } } }),
    })
    expect(readStoredAgentComposerPrefs(storage, "codex")).toEqual({})
  })
})
