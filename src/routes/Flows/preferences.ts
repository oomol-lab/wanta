import type { WorkbenchPreferences } from "@oomol-lab/open-flow/workbench"

import { storageKey } from "../../../electron/branding.ts"
import { openFlowBaseUrl } from "@/lib/domain"

export function flowScopeKey(accountId: string, teamId: string): string {
  return [openFlowBaseUrl, accountId, teamId].map(encodeURIComponent).join(":")
}

export function createFlowPreferences(scopeKey: string): WorkbenchPreferences {
  const prefix = `${storageKey("flows.v1")}:${scopeKey}:`
  const memory = new Map<string, string>()
  return {
    getItem(key) {
      try {
        return memory.get(key) ?? globalThis.localStorage.getItem(`${prefix}${key}`)
      } catch {
        return memory.get(key) ?? null
      }
    },
    setItem(key, value) {
      memory.set(key, value)
      try {
        globalThis.localStorage.setItem(`${prefix}${key}`, value)
      } catch {
        // Layout preferences must not prevent editing when storage is unavailable.
      }
    },
  }
}
