import type { LocalArtifactGroup, LocalArtifactItem, LocalArtifactPack } from "../../../electron/chat/common.ts"
import type { GeneratedArtifactSource } from "./artifact-sources.ts"

export interface ResolvedArtifactPayload {
  group: LocalArtifactGroup
  pack?: LocalArtifactPack
}

export const intermediateCodeExtensions = new Set([
  ".bash",
  ".c",
  ".cc",
  ".cjs",
  ".cpp",
  ".cs",
  ".css",
  ".cxx",
  ".dart",
  ".fish",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".htm",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".less",
  ".lua",
  ".mjs",
  ".php",
  ".pl",
  ".py",
  ".r",
  ".rb",
  ".rs",
  ".sass",
  ".scala",
  ".scss",
  ".sh",
  ".svelte",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
  ".zsh",
])

const codeRequestPattern =
  /\b(api|app|cli|code|component|css|html|javascript|js|node|program|python|react|script|typescript|ts|website)\b|代码|脚本|程序|网页|网站|应用|组件|前端|后端|接口|库|插件|扩展|源码|项目/i

function fileExtension(name: string): string {
  const index = name.lastIndexOf(".")
  return index === -1 ? "" : name.slice(index).toLowerCase()
}

function artifactGroupPaths(group: LocalArtifactGroup): string[] {
  return [group.root?.path, ...group.items.map((item) => item.path)].filter((item): item is string => Boolean(item))
}

function sourceRequestsCode(source: GeneratedArtifactSource): boolean {
  return codeRequestPattern.test(source.requestText)
}

function isIntermediateCodeArtifact(item: LocalArtifactItem, source: GeneratedArtifactSource): boolean {
  return !sourceRequestsCode(source) && intermediateCodeExtensions.has(fileExtension(item.name))
}

function filterArtifactPack(
  pack: LocalArtifactPack | undefined,
  allowedPaths: Set<string>,
): LocalArtifactPack | undefined {
  if (!pack) {
    return undefined
  }
  const items = pack.items.filter((item) => allowedPaths.has(item.path))
  const supporting = pack.supporting.filter((item) => allowedPaths.has(item.path))
  if (items.length === 0 && supporting.length === 0) {
    return undefined
  }
  return {
    ...pack,
    items,
    supporting,
    totalItems: items.length + supporting.length,
  }
}

function visibleArtifactPackPaths(pack: LocalArtifactPack | undefined): Set<string> {
  if (!pack) {
    return new Set()
  }
  return new Set(
    [...pack.items, ...pack.supporting.filter((item) => item.role !== "metadata")].map((item) => item.path),
  )
}

export function filterArtifactPayloads(
  payloads: ResolvedArtifactPayload[],
  source: GeneratedArtifactSource,
): ResolvedArtifactPayload[] {
  const sourcePaths = new Set(source.sourcePaths)
  return payloads.flatMap((payload) => {
    const { group, pack } = payload
    const manifestVisiblePaths = visibleArtifactPackPaths(pack)
    const rootExcluded = Boolean(group.root && sourcePaths.has(group.root.path))
    const items = group.items.filter(
      (item) =>
        !sourcePaths.has(item.path) &&
        (manifestVisiblePaths.has(item.path) || !isIntermediateCodeArtifact(item, source)),
    )
    const allowedPaths = new Set(items.map((item) => item.path))
    const filteredPack = filterArtifactPack(pack, allowedPaths)
    if (items.length === 0) {
      return []
    }
    if (rootExcluded) {
      return [
        {
          group: { items, totalItems: items.length, truncated: false },
          ...(filteredPack ? { pack: filteredPack } : {}),
        },
      ]
    }
    return [
      {
        group: { ...group, items, totalItems: group.root?.kind === "directory" ? items.length : group.totalItems },
        ...(filteredPack ? { pack: filteredPack } : {}),
      },
    ]
  })
}

export function mergeArtifactGroups(
  payloads: ResolvedArtifactPayload[][],
  source: GeneratedArtifactSource,
): ResolvedArtifactPayload[] {
  const merged: ResolvedArtifactPayload[] = []
  const seenPaths = new Set<string>()
  for (const payloadList of payloads) {
    for (const payload of filterArtifactPayloads(payloadList, source)) {
      const { group } = payload
      if (group.items.length === 0) {
        continue
      }
      const paths = artifactGroupPaths(group)
      if (paths.length > 0 && paths.every((item) => seenPaths.has(item))) {
        continue
      }
      merged.push(payload)
      for (const item of paths) {
        seenPaths.add(item)
      }
    }
  }
  return merged
}

export function dedupeArtifactPayloadsAcrossSources<T extends ResolvedArtifactPayload>(payloads: T[]): T[] {
  const deduped: T[] = []
  const seenItemPaths = new Set<string>()
  for (const payload of payloads) {
    const itemPaths = payload.group.items.map((item) => item.path)
    if (itemPaths.length > 0 && itemPaths.every((item) => seenItemPaths.has(item))) {
      continue
    }
    deduped.push(payload)
    for (const item of itemPaths) {
      seenItemPaths.add(item)
    }
  }
  return deduped
}
