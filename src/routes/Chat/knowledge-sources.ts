import type { ChatMessagePart } from "../../../electron/chat/common.ts"
import type { KnowledgeHit } from "../../../electron/knowledge/common.ts"

import { parseConnectorCliInvocation } from "./connector-cli.ts"

/** Accept only validated retrieval output, never model-authored citations or arbitrary tool JSON. */
export function knowledgeSources(part: ChatMessagePart): KnowledgeHit[] | null {
  if (part.status !== "completed" || part.error || !part.output) return null
  const cli = parseConnectorCliInvocation(typeof part.input?.command === "string" ? part.input.command : "")
  const retrieval =
    part.tool === "call_action" && part.input?.service === "oomol_rag" && part.input?.action === "retrieve"
  if (!retrieval && !(cli?.operation === "run" && cli.service === "oomol_rag" && cli.action === "retrieve")) return null
  try {
    return parseResults(JSON.parse(part.output), 0)
  } catch {
    return null
  }
}
function parseResults(value: unknown, depth: number): KnowledgeHit[] | null {
  if (depth > 3 || !value || typeof value !== "object") return null
  const object = value as Record<string, unknown>
  if (object.error || object.isError) return null
  if (typeof object.requestId === "string" && Array.isArray(object.items)) {
    const hits: KnowledgeHit[] = []
    for (const item of object.items) {
      if (
        !item ||
        typeof item.fileId !== "string" ||
        typeof item.filename !== "string" ||
        typeof item.text !== "string" ||
        typeof item.score !== "number" ||
        !Number.isFinite(item.score)
      )
        return null
      hits.push({ file_id: item.fileId, filename: item.filename, text: item.text, score: item.score })
    }
    return hits
  }
  // CLI/host result envelopes retain the provider's structured response.
  for (const key of ["data", "result", "structuredContent"]) {
    const result = parseResults(object[key], depth + 1)
    if (result !== null) return result
  }
  return null
}
