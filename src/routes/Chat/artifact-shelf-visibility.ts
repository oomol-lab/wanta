import type { LocalArtifactPack } from "../../../electron/chat/common.ts"
import type { ResolvedArtifactGroup } from "./artifact-resolution.ts"

import { artifactGroupDisplayItem } from "./artifact-metadata.ts"

function packDisplayItems(pack: LocalArtifactPack) {
  const supporting = pack.supporting.filter((item) => item.role !== "metadata")
  return pack.items.length > 0 ? [...pack.items, ...supporting] : supporting
}

function hasDisplayEntry({ group, pack }: ResolvedArtifactGroup): boolean {
  const items = pack ? packDisplayItems(pack) : group.items
  return items.length > 0 || Boolean(group.root)
}

export function shouldRenderGeneratedArtifactsShelf(groups: readonly ResolvedArtifactGroup[]): boolean {
  if (groups.at(-1)?.status === "failed") {
    return true
  }
  return (
    groups.some(
      (resolved) => resolved.status !== "failed" && Boolean(artifactGroupDisplayItem(resolved.group, resolved.pack)),
    ) && groups.some(hasDisplayEntry)
  )
}
