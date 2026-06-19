import type { AuthState } from "../../electron/auth/common.ts"
import type { SkillInventory, SkillVersionReport } from "../../electron/skills/common.ts"

import * as React from "react"
import { ResourceStore } from "@/lib/resource-store"

export interface AppDataResources {
  authState: ResourceStore<AuthState>
  homeSummary: ResourceStore<null>
  skillInventory: ResourceStore<SkillInventory>
  skillVersions: ResourceStore<SkillVersionReport>
}

export const AppDataContext = React.createContext<AppDataResources | null>(null)

export function useAppDataResources(): AppDataResources {
  const resources = React.useContext(AppDataContext)

  if (!resources) {
    throw new Error("useAppDataResources must be used within AppDataProvider")
  }

  return resources
}
