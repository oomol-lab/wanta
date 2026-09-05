import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { PublicSkillPackage } from "../../../electron/skills/common.ts"
import type { ProviderSkillCandidate } from "./provider-skill-recommendations.ts"

import * as React from "react"
import {
  getConventionalProviderSkillPackageName,
  getConnectedProviderSkillCandidates,
  isHighConfidenceProviderSkillPackage,
  getProviderSkillSearchQueries,
  scoreProviderSkillPackage,
  selectProviderSkillPackage,
} from "./provider-skill-recommendations.ts"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import {
  readCachedSkillCatalog,
  readCachedSkillCatalogValue,
  invalidateSkillCatalogKeys,
  getSkillCatalogInvalidationRevision,
  subscribeSkillCatalogInvalidation,
} from "@/lib/skill-catalog-cache"
import { readPublicSkillPackageByName, searchPublicSkillPackages } from "@/lib/skills-catalog-client"

const providerSkillPackageCacheMs = 10 * 60_000
const missingProviderSkillPackageCacheMs = 24 * 60 * 60_000

export interface ProviderSkillPackageLookup {
  error: string | null
  isLoading: boolean
  isStale: boolean
  packagesByService: ReadonlyMap<string, PublicSkillPackage | null>
  pendingCount: number
  resolvedCount: number
  totalCount: number
}

const emptyProviderSkillPackages = new Map<string, PublicSkillPackage | null>()
const providerSkillPackageLookupConcurrency = 4

function providerSkillPackageCacheKey(candidate: ProviderSkillCandidate): string {
  return `public:provider:${candidate.service}:${candidate.providerDisplayName.trim().toLowerCase()}`
}

function providerSkillPackageRequestKey(candidates: readonly ProviderSkillCandidate[]): string {
  return candidates
    .map((candidate) => `${candidate.service}:${candidate.providerDisplayName}`)
    .sort()
    .join("|")
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

async function mapProviderSkillCandidatesWithConcurrency(
  candidates: readonly ProviderSkillCandidate[],
  mapper: (candidate: ProviderSkillCandidate) => Promise<void>,
): Promise<void> {
  let nextIndex = 0
  const workerCount = Math.min(providerSkillPackageLookupConcurrency, candidates.length)
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < candidates.length) {
        const candidate = candidates[nextIndex]
        nextIndex += 1
        if (candidate) {
          await mapper(candidate)
        }
      }
    }),
  )
}

export function useProviderSkillPackageLookup(providers: readonly ConnectionProvider[]): ProviderSkillPackageLookup {
  const revision = React.useSyncExternalStore(subscribeSkillCatalogInvalidation, getSkillCatalogInvalidationRevision)
  const candidates = React.useMemo(() => getConnectedProviderSkillCandidates(providers), [providers])
  const requestKey = React.useMemo(() => providerSkillPackageRequestKey(candidates), [candidates])
  const [packagesByService, setPackagesByService] = React.useState<ReadonlyMap<string, PublicSkillPackage | null>>(
    () => new Map(),
  )
  const [resolvedRequestKey, setResolvedRequestKey] = React.useState("")
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    if (candidates.length === 0) {
      setPackagesByService(new Map())
      setResolvedRequestKey(requestKey)
      setIsLoading(false)
      setError(null)
      return () => {
        cancelled = true
        controller.abort()
      }
    }

    const initialPackages = new Map<string, PublicSkillPackage | null>()
    const pendingCandidates = candidates.filter((candidate) => {
      const cached = readCachedSkillCatalogValue<PublicSkillPackage | null>(providerSkillPackageCacheKey(candidate))
      if (cached === undefined) return true
      initialPackages.set(candidate.service, cached)
      return false
    })
    setPackagesByService(initialPackages)
    setResolvedRequestKey(requestKey)
    setIsLoading(pendingCandidates.length > 0)
    setError(null)
    void (async () => {
      let firstFailure: unknown

      await mapProviderSkillCandidatesWithConcurrency(pendingCandidates, async (candidate) => {
        try {
          const pkg = await readProviderSkillPackage(candidate, controller.signal)
          if (!cancelled) {
            setPackagesByService((current) => {
              const next = new Map(current)
              next.set(candidate.service, pkg)
              return next
            })
          }
        } catch (cause) {
          if (controller.signal.aborted) {
            return
          }
          console.warn("[wanta] failed to read provider Skill recommendation:", cause)
          reportRendererHandledError(
            "providerSkillPackageLookup.readPackage",
            "Failed to read provider Skill recommendation",
            cause,
          )
          firstFailure ??= cause
          if (!cancelled) {
            setPackagesByService((current) => {
              const next = new Map(current)
              next.set(candidate.service, null)
              return next
            })
          }
        }
      })

      if (!cancelled) {
        setError(firstFailure ? errorMessage(firstFailure) : null)
      }
    })()
      .catch((cause) => {
        if (!cancelled) {
          setError(errorMessage(cause))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [candidates, requestKey, revision])

  const isStale = resolvedRequestKey !== requestKey
  const visiblePackagesByService = isStale ? emptyProviderSkillPackages : packagesByService
  const resolvedCount = candidates.filter((candidate) => visiblePackagesByService.has(candidate.service)).length
  return {
    error,
    isLoading: isLoading || isStale,
    isStale,
    packagesByService: visiblePackagesByService,
    pendingCount: candidates.length - resolvedCount,
    resolvedCount,
    totalCount: candidates.length,
  }
}

export function clearProviderSkillPackageCache(): void {
  invalidateSkillCatalogKeys((key) => key.startsWith("public:provider:"))
}

export async function readProviderSkillPackage(
  candidate: ProviderSkillCandidate,
  signal?: AbortSignal,
): Promise<PublicSkillPackage | null> {
  return readCachedSkillCatalog(
    providerSkillPackageCacheKey(candidate),
    (pkg: PublicSkillPackage | null) => (pkg ? providerSkillPackageCacheMs : missingProviderSkillPackageCacheMs),
    false,
    (requestSignal) => searchProviderSkillPackage(candidate, requestSignal),
    signal,
  )
}

async function searchProviderSkillPackage(
  candidate: ProviderSkillCandidate,
  signal?: AbortSignal,
): Promise<PublicSkillPackage | null> {
  const conventionalPackageName = getConventionalProviderSkillPackageName(candidate)
  if (conventionalPackageName) {
    try {
      const conventionalPackage = await readPublicSkillPackageByName(conventionalPackageName, signal)
      if (conventionalPackage && scoreProviderSkillPackage(candidate, conventionalPackage) > 0) {
        return conventionalPackage
      }
    } catch (error) {
      if (signal?.aborted) {
        throw error
      }
      reportRendererHandledError(
        "providerSkillPackageLookup.readConventionalPackage",
        "Failed to read conventional provider Skill package",
        error,
      )
    }
  }

  const packages: PublicSkillPackage[] = []
  const seen = new Set<string>()

  for (const query of getProviderSkillSearchQueries(candidate)) {
    const catalog = await searchPublicSkillPackages({ query, signal, size: 12 })
    for (const pkg of catalog.items) {
      const key = pkg.name.trim().toLowerCase()
      if (!key || seen.has(key)) {
        continue
      }
      seen.add(key)
      packages.push(pkg)
    }

    const selected = selectProviderSkillPackage(candidate, packages)
    if (selected && isHighConfidenceProviderSkillPackage(candidate, selected)) {
      return selected
    }
  }

  return selectProviderSkillPackage(candidate, packages)
}
