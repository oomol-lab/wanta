import type { KnowledgeHit } from "../../../electron/knowledge/common.ts"

import * as React from "react"

export interface KnowledgeSourceSelection {
  hit: KnowledgeHit
  teamId: string
}

export const KnowledgeNavigationContext = React.createContext<((hit: KnowledgeHit) => void) | null>(null)
