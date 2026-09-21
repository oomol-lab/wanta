import type { KnowledgeFile, KnowledgeFilePage, KnowledgeResults } from "../../electron/knowledge/common.ts"

import { knowledgeBaseUrl } from "@/lib/domain"
import { oomolFetchJson } from "@/lib/oomol-http"

function headers(teamId: string): Record<string, string> {
  if (!teamId.trim()) throw new Error("A team is required.")
  return { "x-oo-team-id": teamId }
}
export function listKnowledgeFiles(teamId: string, cursor = "", signal?: AbortSignal): Promise<KnowledgeFilePage> {
  const url = new URL("/v1/files", knowledgeBaseUrl)
  url.searchParams.set("limit", "100")
  if (cursor) url.searchParams.set("cursor", cursor)
  return oomolFetchJson(url, { headers: headers(teamId), signal })
}
export function uploadKnowledgeFile(teamId: string, file: File, signal?: AbortSignal): Promise<KnowledgeFile> {
  const body = new FormData()
  body.set("file", file)
  return oomolFetchJson(new URL("/v1/files", knowledgeBaseUrl), {
    method: "POST",
    headers: headers(teamId),
    body,
    timeoutMs: null,
    signal,
  })
}
export function deleteKnowledgeFile(teamId: string, id: string, signal?: AbortSignal): Promise<KnowledgeFile> {
  return oomolFetchJson(new URL(`/v1/files/${encodeURIComponent(id)}`, knowledgeBaseUrl), {
    method: "DELETE",
    headers: headers(teamId),
    signal,
  })
}
export function retrieveKnowledge(teamId: string, query: string, signal?: AbortSignal): Promise<KnowledgeResults> {
  return oomolFetchJson(new URL("/v1/retrieve", knowledgeBaseUrl), {
    method: "POST",
    headers: { ...headers(teamId), "Content-Type": "application/json" },
    body: JSON.stringify({ query, top_k: 5, enable_reranking: true }),
    timeoutMs: 60_000,
    signal,
  })
}
