import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { PublicSkillPackage } from "../../../electron/skills/common.ts"
import type { ProviderSkillCandidate } from "./provider-skill-recommendations.ts"

import * as React from "react"
import {
  getConventionalProviderSkillPackageName,
  getConnectedProviderSkillCandidates,
  getProviderSkillSearchQueries,
  scoreProviderSkillPackage,
  selectProviderSkillPackage,
} from "./provider-skill-recommendations.ts"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { readPublicSkillPackageByName, searchPublicSkillPackages } from "@/lib/skills-catalog-client"

const providerSkillPackageCacheMs = 10 * 60_000
const missingProviderSkillPackageCacheMs = 24 * 60 * 60_000

interface ProviderSkillPackageCacheEntry {
  expiresAt: number
  package: PublicSkillPackage | null
}

export interface ProviderSkillPackageLookup {
  error: string | null
  isLoading: boolean
  isStale: boolean
  packagesByService: ReadonlyMap<string, PublicSkillPackage | null>
}

const providerSkillPackageCache = new Map<string, ProviderSkillPackageCacheEntry>()
const providerSkillPackagePendingRequests = new Map<string, Promise<PublicSkillPackage | null>>()
const emptyProviderSkillPackages = new Map<string, PublicSkillPackage | null>()
const providerSkillPackageLookupConcurrency = 4

function providerSkillPackageCacheKey(candidate: ProviderSkillCandidate): string {
  return `${candidate.service}:${candidate.providerDisplayName.trim().toLowerCase()}`
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

function cachedProviderSkillPackage(
  candidate: ProviderSkillCandidate,
  now = Date.now(),
): PublicSkillPackage | null | undefined {
  const cached = providerSkillPackageCache.get(providerSkillPackageCacheKey(candidate))
  return cached && now < cached.expiresAt ? cached.package : undefined
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

    if (candidates.length === 0) {
      setPackagesByService(new Map())
      setResolvedRequestKey(requestKey)
      setIsLoading(false)
      setError(null)
      return () => {
        cancelled = true
      }
    }

    const now = Date.now()
    const initialPackagesByService = new Map<string, PublicSkillPackage | null>()
    const pendingCandidates: ProviderSkillCandidate[] = []
    for (const candidate of candidates) {
      const cached = cachedProviderSkillPackage(candidate, now)
      if (cached === undefined) {
        pendingCandidates.push(candidate)
      } else {
        initialPackagesByService.set(candidate.service, cached)
      }
    }

    setPackagesByService(initialPackagesByService)
    setResolvedRequestKey(requestKey)
    setIsLoading(pendingCandidates.length > 0)
    setError(null)
    if (pendingCandidates.length === 0) {
      return () => {
        cancelled = true
      }
    }

    void (async () => {
      let firstFailure: unknown

      await mapProviderSkillCandidatesWithConcurrency(pendingCandidates, async (candidate) => {
        try {
          const pkg = await readProviderSkillPackage(candidate)
          if (!cancelled) {
            setPackagesByService((current) => {
              const next = new Map(current)
              next.set(candidate.service, pkg)
              return next
            })
          }
        } catch (cause) {
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
    }
  }, [candidates, requestKey])

  const isStale = resolvedRequestKey !== requestKey
  return {
    error,
    isLoading: isLoading || isStale,
    isStale,
    packagesByService: isStale ? emptyProviderSkillPackages : packagesByService,
  }
}

export function clearProviderSkillPackageLookupCacheForTest(): void {
  providerSkillPackageCache.clear()
  providerSkillPackagePendingRequests.clear()
}

export async function readProviderSkillPackage(candidate: ProviderSkillCandidate): Promise<PublicSkillPackage | null> {
  const cacheKey = providerSkillPackageCacheKey(candidate)
  const cached = providerSkillPackageCache.get(cacheKey)
  if (cached && Date.now() < cached.expiresAt) {
    return cached.package
  }
  const pending = providerSkillPackagePendingRequests.get(cacheKey)
  if (pending) {
    return pending
  }

  const request = searchProviderSkillPackage(candidate)
    .then((pkg) => {
      providerSkillPackageCache.set(cacheKey, {
        expiresAt: Date.now() + (pkg ? providerSkillPackageCacheMs : missingProviderSkillPackageCacheMs),
        package: pkg,
      })
      return pkg
    })
    .finally(() => {
      if (providerSkillPackagePendingRequests.get(cacheKey) === request) {
        providerSkillPackagePendingRequests.delete(cacheKey)
      }
    })
  providerSkillPackagePendingRequests.set(cacheKey, request)
  return request
}

async function searchProviderSkillPackage(candidate: ProviderSkillCandidate): Promise<PublicSkillPackage | null> {
  const conventionalPackageName = getConventionalProviderSkillPackageName(candidate)
  if (conventionalPackageName) {
    try {
      const conventionalPackage = await readPublicSkillPackageByName(conventionalPackageName)
      if (conventionalPackage && scoreProviderSkillPackage(candidate, conventionalPackage) > 0) {
        return conventionalPackage
      }
    } catch (error) {
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
    const catalog = await searchPublicSkillPackages({ query, size: 12 })
    for (const pkg of catalog.items) {
      const key = pkg.name.trim().toLowerCase()
      if (!key || seen.has(key)) {
        continue
      }
      seen.add(key)
      packages.push(pkg)
    }
  }

  return selectProviderSkillPackage(candidate, packages)
}
