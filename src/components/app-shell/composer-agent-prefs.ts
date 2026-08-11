import type { AgentKind } from "../../../electron/agent/contract/profile.ts"
import type { AgentPermissionMode } from "../../../electron/chat/common.ts"

import { AGENT_PROFILES } from "../../../electron/agent/contract/profile.ts"

// Sticky composer defaults: the last agent the user picked, and the last
// model/effort/permission-mode chosen per agent. A new chat draft starts from
// these instead of forgetting every selection.
//
// full_access is deliberately never persisted: entering it has an explicit
// confirmation step, and a new chat must not inherit that decision silently.

type LocalStorageLike = Pick<Storage, "getItem" | "setItem">

export interface AgentComposerPrefs {
  modelId?: string
  effortId?: string
  permissionMode?: AgentPermissionMode
}

interface StoredComposerAgentPrefs {
  lastAgentKind?: string
  byAgent?: Record<string, { modelId?: unknown; effortId?: unknown; permissionMode?: unknown }>
}

const storageKey = "wanta.composerAgentPrefs"

function isAgentKind(value: unknown): value is AgentKind {
  return typeof value === "string" && Object.hasOwn(AGENT_PROFILES, value)
}

function readStore(storage: LocalStorageLike | null | undefined): StoredComposerAgentPrefs {
  try {
    const raw = storage?.getItem(storageKey)
    if (!raw) {
      return {}
    }
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? (parsed as StoredComposerAgentPrefs) : {}
  } catch {
    return {}
  }
}

function writeStore(storage: LocalStorageLike | null | undefined, store: StoredComposerAgentPrefs): void {
  if (!storage) {
    return
  }
  try {
    storage.setItem(storageKey, JSON.stringify(store))
  } catch {
    // Local storage being unavailable only loses stickiness, never state.
  }
}

export function readStoredLastAgentKind(storage: LocalStorageLike | null | undefined): AgentKind | undefined {
  const stored = readStore(storage).lastAgentKind
  return isAgentKind(stored) ? stored : undefined
}

export function writeStoredLastAgentKind(storage: LocalStorageLike | null | undefined, kind: AgentKind): void {
  writeStore(storage, { ...readStore(storage), lastAgentKind: kind })
}

export function readStoredAgentComposerPrefs(
  storage: LocalStorageLike | null | undefined,
  kind: AgentKind,
): AgentComposerPrefs {
  // Old session records can still carry retired agent kinds (e.g. a removed
  // registry entry); those must degrade to defaults, not crash below.
  if (!isAgentKind(kind)) {
    return {}
  }
  const stored = readStore(storage).byAgent?.[kind]
  if (!stored || typeof stored !== "object") {
    return {}
  }
  const prefs: AgentComposerPrefs = {}
  if (typeof stored.modelId === "string" && stored.modelId) {
    prefs.modelId = stored.modelId
  }
  if (typeof stored.effortId === "string" && stored.effortId) {
    prefs.effortId = stored.effortId
  }
  const mode = stored.permissionMode
  if (
    typeof mode === "string" &&
    mode !== "full_access" &&
    AGENT_PROFILES[kind].permissionModes.includes(mode as AgentPermissionMode)
  ) {
    prefs.permissionMode = mode as AgentPermissionMode
  }
  return prefs
}

/**
 * Merge a preference change for one agent. A key present in the patch with an
 * undefined value clears the stored preference (the user chose the default);
 * an absent key leaves it untouched.
 */
export function writeStoredAgentComposerPrefs(
  storage: LocalStorageLike | null | undefined,
  kind: AgentKind,
  patch: Partial<AgentComposerPrefs>,
): void {
  const store = readStore(storage)
  const current = { ...store.byAgent?.[kind] }
  for (const field of ["modelId", "effortId", "permissionMode"] as const) {
    if (!(field in patch)) {
      continue
    }
    const value = patch[field]
    if (field === "permissionMode" && value === "full_access") {
      // Never sticky; the previous persisted mode stays the next-chat default.
      continue
    }
    if (value === undefined) {
      delete current[field]
    } else {
      current[field] = value
    }
  }
  writeStore(storage, { ...store, byAgent: { ...store.byAgent, [kind]: current } })
}
