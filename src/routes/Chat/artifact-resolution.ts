import type {
  LocalArtifactGroup,
  LocalArtifactPack,
  ResolveLocalArtifactsResult,
} from "../../../electron/chat/common.ts"
import type { ResolvedArtifactPayload } from "./artifact-filter.ts"
import type { GeneratedArtifactSource } from "./artifact-sources.ts"

import * as React from "react"
import { dedupeArtifactPayloadsAcrossSources, mergeArtifactGroups } from "./artifact-filter.ts"
import { useChatService } from "@/components/AppContext"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"

const artifactResolveCacheLimit = 96

export interface ResolvedArtifactGroup {
  messageId: string
  group: LocalArtifactGroup
  pack?: LocalArtifactPack
}

function artifactSourceCacheKey(source: GeneratedArtifactSource): string {
  return JSON.stringify({
    artifactRoot: source.artifactRoot ?? "",
    requestText: source.requestText,
    sourcePaths: source.sourcePaths,
    text: source.text,
  })
}

function rememberArtifactGroups(
  cache: Map<string, ResolvedArtifactPayload[]>,
  key: string,
  groups: ResolvedArtifactPayload[],
): void {
  cache.set(key, groups)
  while (cache.size > artifactResolveCacheLimit) {
    const oldest = cache.keys().next().value
    if (!oldest) {
      return
    }
    cache.delete(oldest)
  }
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

export function useResolvedArtifactGroups(sources: GeneratedArtifactSource[]): ResolvedArtifactGroup[] {
  const chatService = useChatService()
  const [groups, setGroups] = React.useState<ResolvedArtifactGroup[]>([])
  const resolvedGroupsCache = React.useRef(new Map<string, ResolvedArtifactPayload[]>())

  React.useEffect(() => {
    if (sources.length === 0) {
      setGroups([])
      return
    }
    let cancelled = false
    const sourceRequests = sources.map(async (source): Promise<ResolvedArtifactGroup[]> => {
      try {
        const cacheKey = artifactSourceCacheKey(source)
        const cached = resolvedGroupsCache.current.get(cacheKey)
        if (cached) {
          return cached.map((payload) => ({ messageId: source.messageId, ...payload }))
        }
        const trimmed = source.text.trim()
        if (!source.artifactRoot && !trimmed) {
          rememberArtifactGroups(resolvedGroupsCache.current, cacheKey, [])
          return []
        }
        const requests: Array<Promise<ResolvedArtifactPayload[]>> = []
        if (source.artifactRoot) {
          requests.push(
            chatService
              .invoke("resolveLocalArtifacts", { artifactRoot: source.artifactRoot })
              .then(resolveArtifactResultPayloads),
          )
        }
        if (!source.artifactRoot && trimmed) {
          requests.push(
            chatService.invoke("resolveLocalArtifacts", { text: trimmed }).then(resolveArtifactResultPayloads),
          )
        }
        const resultGroups = await Promise.all(requests)
        const mergedGroups = mergeArtifactGroups(resultGroups, source)
        rememberArtifactGroups(resolvedGroupsCache.current, cacheKey, mergedGroups)
        return mergedGroups.map((group) => ({
          messageId: source.messageId,
          ...group,
        }))
      } catch (error) {
        console.warn("[wanta] failed to resolve generated artifact source", { error })
        reportRendererHandledError("generatedArtifacts.resolveSource", "Failed to resolve generated artifact", error)
        return []
      }
    })
    void Promise.all(sourceRequests)
      .then((resultGroups) => {
        if (!cancelled) {
          setGroups(dedupeArtifactPayloadsAcrossSources(resultGroups.flat()))
        }
      })
      .catch((error: unknown) => {
        console.warn("[wanta] failed to resolve generated artifacts", { error })
        reportRendererHandledError("generatedArtifacts.resolve", "Failed to resolve generated artifacts", error)
        if (!cancelled) {
          setGroups([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [chatService, sources])

  return groups
}
