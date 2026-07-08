import type { ConnectionProvider } from "../../electron/connections/common.ts"
import type { ManagedSkillGroup } from "../../electron/skills/common.ts"
import type { ProviderSkillRecommendation } from "@/routes/Skills/provider-skill-recommendations"
import type { ManagedSkillGroupById } from "@/routes/Skills/skill-route-model"

import * as React from "react"
import { useProviderSkillPackageLookup } from "@/routes/Skills/provider-skill-package-lookup"
import {
  buildProviderSkillRecommendations,
  getInstallableProviderSkillRecommendations,
} from "@/routes/Skills/provider-skill-recommendations"

export interface ProviderSkillRecommendationsState {
  error: string | null
  installable: ProviderSkillRecommendation[]
  isLoading: boolean
  recommendations: ProviderSkillRecommendation[]
}

export function useProviderSkillRecommendations({
  groupById,
  providers,
}: {
  groupById: ManagedSkillGroupById | ReadonlyMap<string, ManagedSkillGroup> | undefined
  providers: readonly ConnectionProvider[]
}): ProviderSkillRecommendationsState {
  const packageLookup = useProviderSkillPackageLookup(providers)
  const recommendations = React.useMemo(
    () =>
      buildProviderSkillRecommendations({
        groupById,
        packagesByService: packageLookup.packagesByService,
        providers,
      }),
    [groupById, packageLookup.packagesByService, providers],
  )
  const installable = React.useMemo(
    () => getInstallableProviderSkillRecommendations(recommendations),
    [recommendations],
  )

  return {
    error: packageLookup.error,
    installable,
    isLoading: packageLookup.isLoading,
    recommendations,
  }
}
