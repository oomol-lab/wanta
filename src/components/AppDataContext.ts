import type { AuthState } from "../../electron/auth/common.ts"
import type { MyPublishedSkillCatalog, SkillInventory, SkillVersionReport } from "../../electron/skills/common.ts"
import type { SkillShareInfoStore } from "@/lib/skill-share-info-store"

import * as React from "react"
import { ResourceStore } from "@/lib/resource-store"

export interface AppDataResources {
  authState: ResourceStore<AuthState>
  homeSummary: ResourceStore<null>
  myPublishedSkills: ResourceStore<MyPublishedSkillCatalog>
  skillInventory: ResourceStore<SkillInventory>
  skillShareInfo: SkillShareInfoStore
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
