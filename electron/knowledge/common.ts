import type { ServiceName } from "@oomol/connection"

import { serviceName } from "../branding.ts"

export interface KnowledgeBaseSummary {
  id: string
  title: string
  authors: string[]
  publisher?: string
  publishedAt?: string
  language?: string
  sourceFileName: string
  size: number
  importedAt: number
  coverDataUrl?: string
  capabilities: {
    fullTextSearch: boolean
    knowledgeGraph: boolean
    readingGraph: boolean
    summary: boolean
  }
  statistics: {
    totalChapters?: number
    contentChapters?: number
    sourceWords?: number
  }
}

export interface KnowledgeBasesChangedEvent {
  reason: string
}

export type KnowledgeService = typeof KnowledgeService
export const KnowledgeService = serviceName("knowledge-service") as ServiceName<{
  ServerEvents: {
    knowledgeBasesChanged: KnowledgeBasesChangedEvent
  }
  ClientInvokes: {
    list(): Promise<KnowledgeBaseSummary[]>
    importKnowledgeBase(sourcePath?: string): Promise<KnowledgeBaseSummary | null>
    remove(id: string): Promise<void>
    reveal(id: string): Promise<void>
    refresh(id: string): Promise<KnowledgeBaseSummary>
  }
}>
