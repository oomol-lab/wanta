import type { KnowledgeFile, KnowledgeFilePage, KnowledgeResults } from "../../electron/knowledge/common.ts"

import { knowledgeBaseUrl } from "@/lib/domain"
import { OomolAuthRequiredError, OomolHttpError, oomolFetch, oomolFetchJson } from "@/lib/oomol-http"

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

/** The knowledge service exposes the stored content separately from its file metadata. */
export async function readKnowledgeFileContent(
  teamId: string,
  id: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const response = await oomolFetch(new URL(`/v1/files/${encodeURIComponent(id)}/content`, knowledgeBaseUrl), {
    headers: { ...headers(teamId), Accept: "*/*" },
    signal,
    timeoutMs: 60_000,
  })
  if (response.status === 401) throw new OomolAuthRequiredError()
  if (!response.ok)
    throw new OomolHttpError(`Knowledge file content request failed (${response.status})`, response.status)
  const advertisedSize = Number(response.headers.get("content-length"))
  if (Number.isFinite(advertisedSize) && advertisedSize > maxBytes) {
    await response.body?.cancel()
    throw new KnowledgeContentTooLargeError()
  }
  if (!response.body) return { bytes: new Uint8Array(), contentType: response.headers.get("content-type") ?? "" }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw new KnowledgeContentTooLargeError()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { bytes, contentType: response.headers.get("content-type") ?? "" }
}

export class KnowledgeContentTooLargeError extends Error {
  constructor() {
    super("Knowledge file exceeds the preview limit")
    this.name = "KnowledgeContentTooLargeError"
  }
}
