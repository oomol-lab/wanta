import type {
  LocalArtifactGroup,
  LocalArtifactPack,
  ResolveLocalArtifactsResult,
} from "../../../electron/chat/common.ts"

export interface ResolvedArtifactPayload {
  group: LocalArtifactGroup
  pack?: LocalArtifactPack
}

export interface ResolvedArtifactGroup {
  messageId: string
  group: LocalArtifactGroup
  pack?: LocalArtifactPack
  status?: "ready" | "partial" | "failed"
  failure?: "generated_preview_not_persisted"
}

function artifactPackGroup(pack: LocalArtifactPack): LocalArtifactGroup {
  const visibleSupporting = pack.supporting.filter((item) => item.role !== "metadata")
  const items = pack.items.length > 0 ? pack.items : visibleSupporting
  return {
    root: pack.root,
    items,
    totalItems: pack.totalItems || items.length,
    truncated: pack.truncated,
  }
}

export function resolveArtifactResultPayloads(result: ResolveLocalArtifactsResult): ResolvedArtifactPayload[] {
  if (result.pack) {
    return [{ group: artifactPackGroup(result.pack), pack: result.pack }]
  }
  return result.groups.map((group) => ({ group }))
}
