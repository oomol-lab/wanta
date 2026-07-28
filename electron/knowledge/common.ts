import type { ServiceName } from "@oomol/connection"

import { serviceName } from "../branding.ts"

export const KNOWLEDGE_LIBRARY_CONTEXT_ID = "wikg://lib"

export interface KnowledgeCoverageMetric {
  coveredWords?: number
  totalWords?: number
}

export interface KnowledgeChapterNode {
  children?: KnowledgeChapterNode[]
  title: string
}

export interface KnowledgeBaseSummary {
  id: string
  title: string
  authors: string[]
  publisher?: string
  publishedAt?: string
  language?: string
  relativePath: string
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
  coverage?: {
    knowledgeGraph?: KnowledgeCoverageMetric
    readingGraph?: KnowledgeCoverageMetric
    summary?: KnowledgeCoverageMetric
  }
  chapters?: KnowledgeChapterNode[]
  statistics: {
    totalChapters?: number
    contentChapters?: number
    sourceWords?: number
  }
}

export interface ImportKnowledgeBaseRequest {
  sourcePath?: string
  targetDirectory?: string
}

export interface MoveKnowledgeBaseRequest {
  id: string
  targetDirectory?: string
  fileName?: string
}

export interface RenameKnowledgeBaseRequest {
  authors?: string[]
  id: string
  fileName?: string
  title?: string
}

export interface KnowledgeFolderRequest {
  path: string
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
    listFolders(): Promise<string[]>
    importKnowledgeBase(request?: ImportKnowledgeBaseRequest | string): Promise<KnowledgeBaseSummary | null>
    readChapters(id: string): Promise<KnowledgeChapterNode[]>
    move(request: MoveKnowledgeBaseRequest): Promise<KnowledgeBaseSummary>
    rename(request: RenameKnowledgeBaseRequest): Promise<KnowledgeBaseSummary>
    createFolder(request: KnowledgeFolderRequest | string): Promise<string>
    removeFolder(request: KnowledgeFolderRequest | string): Promise<void>
    remove(id: string): Promise<void>
    reveal(id: string): Promise<void>
    refresh(id: string): Promise<KnowledgeBaseSummary>
  }
}>
