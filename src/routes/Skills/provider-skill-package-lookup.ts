import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { PublicSkillPackage } from "../../../electron/skills/common.ts"
import type { ProviderSkillCandidate } from "./provider-skill-recommendations.ts"

import * as React from "react"
import { getConnectedProviderSkillCandidates } from "./provider-skill-recommendations.ts"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { readPublicSkillPackageByName } from "@/lib/skills-catalog-client"

const providerSkillPackageCacheMs = 30_000
const missingProviderSkillPackageCacheMs = 24 * 60 * 60_000

interface ProviderSkillPackageCacheEntry {
  expiresAt: number
  package: PublicSkillPackage | null
}

export interface ProviderSkillPackageLookup {
  error: string | null
  isLoading: boolean
  packagesByService: ReadonlyMap<string, PublicSkillPackage | null>
}

const providerSkillPackageCache = new Map<string, ProviderSkillPackageCacheEntry>()

function providerSkillPackageRequestKey(candidates: readonly ProviderSkillCandidate[]): string {
  return candidates
    .map((candidate) => `${candidate.service}:${candidate.packageName}`)
    .sort()
    .join("|")
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export function useProviderSkillPackageLookup(providers: readonly ConnectionProvider[]): ProviderSkillPackageLookup {
  const candidates = React.useMemo(() => getConnectedProviderSkillCandidates(providers), [providers])
  const requestKey = React.useMemo(() => providerSkillPackageRequestKey(candidates), [candidates])
  const [packagesByService, setPackagesByService] = React.useState<ReadonlyMap<string, PublicSkillPackage | null>>(
    () => new Map(),
  )
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false

    if (candidates.length === 0) {
      setPackagesByService(new Map())
      setIsLoading(false)
      setError(null)
      return () => {
        cancelled = true
      }
    }

    setIsLoading(true)
    setError(null)

    void (async () => {
      const next = new Map<string, PublicSkillPackage | null>()
      const now = Date.now()
      let firstFailure: unknown

      for (const candidate of candidates) {
        const cached = providerSkillPackageCache.get(candidate.packageName)
        if (cached && now < cached.expiresAt) {
          next.set(candidate.service, cached.package)
          continue
        }

        try {
          const pkg = await readPublicSkillPackageByName(candidate.packageName)
          providerSkillPackageCache.set(candidate.packageName, {
            expiresAt: Date.now() + (pkg ? providerSkillPackageCacheMs : missingProviderSkillPackageCacheMs),
            package: pkg,
          })
          next.set(candidate.service, pkg)
        } catch (cause) {
          console.warn("[wanta] failed to read provider Skill recommendation:", cause)
          reportRendererHandledError(
            "providerSkillPackageLookup.readPackage",
            "Failed to read provider Skill recommendation",
            cause,
          )
          firstFailure ??= cause
          next.set(candidate.service, null)
        }
      }

      if (!cancelled) {
        setPackagesByService(next)
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

  return { error, isLoading, packagesByService }
}
