import type { PublicSkillPackage } from "../../../electron/skills/common.ts"
import type { BusyAction, OrganizationSkillLinkInput } from "./organization-management-model.ts"
import type { UseOrganizationSkills } from "@/hooks/useOrganizationSkills"
import type { ProviderSkillRecommendation } from "@/routes/Skills/provider-skill-recommendations"
import type { RuntimeSkillRemoveTarget } from "@/routes/Skills/skill-route-model"

import * as React from "react"
import { toast } from "sonner"
import {
  errorMessage,
  planProviderSkillRecommendationBulkLinks,
  runtimeSkillRemoveBusyKey,
} from "./organization-management-model.ts"
import { useSkillService } from "@/components/AppContext"
import {
  useHomeSummaryResource,
  useSkillInventoryResource,
  useSkillVersionReportResource,
} from "@/components/AppDataHooks"
import { useAppI18n } from "@/i18n"
import { getPublicPackagePrimarySkill } from "@/routes/Skills/skill-route-model"

function publicPackageLinkInput(pkg: PublicSkillPackage, skillName?: string): OrganizationSkillLinkInput | null {
  const skill = skillName
    ? (pkg.skills.find((item) => item.name === skillName) ?? getPublicPackagePrimarySkill(pkg))
    : getPublicPackagePrimarySkill(pkg)
  if (!skill) {
    return null
  }
  return {
    packageName: pkg.name,
    skillName: skill.name,
    version: pkg.version,
  }
}

export function useOrganizationSkillActions({
  busyAction,
  organizationSkills,
  setBusyAction,
}: {
  busyAction: BusyAction | null
  organizationSkills: UseOrganizationSkills | null
  setBusyAction: React.Dispatch<React.SetStateAction<BusyAction | null>>
}) {
  const { t } = useAppI18n()
  const skillService = useSkillService()
  const skillInventory = useSkillInventoryResource()
  const skillVersionReport = useSkillVersionReportResource()
  const homeSummaryResource = useHomeSummaryResource()
  const [runtimeSkillRemoveTarget, setRuntimeSkillRemoveTarget] = React.useState<RuntimeSkillRemoveTarget | null>(null)

  const installRuntimeSkill = React.useCallback(
    async (skill: { packageName: string; skillName: string }) => {
      setBusyAction(`installSkill:${skill.packageName}:${skill.skillName}`)
      try {
        const nextInventory = await skillService.invoke("installRegistrySkill", {
          packageName: skill.packageName,
          skillId: skill.skillName,
        })
        skillInventory.setData(nextInventory)
        homeSummaryResource.invalidate()
        toast.success(t("skills.registryInstallDone", { name: skill.skillName }))
      } catch (error) {
        toast.error(t("skills.registryInstallFailed", { error: errorMessage(error) }))
      } finally {
        setBusyAction(null)
      }
    },
    [homeSummaryResource, setBusyAction, skillInventory, skillService, t],
  )

  const removeRuntimeSkill = React.useCallback(async () => {
    const target = runtimeSkillRemoveTarget
    if (!target || busyAction) {
      return
    }

    setBusyAction(runtimeSkillRemoveBusyKey(target))
    try {
      const nextInventory = await skillService.invoke("deleteSkill", {
        confirmed: true,
        skillId: target.groupId,
      })
      skillInventory.setData(nextInventory)
      skillVersionReport.invalidate()
      homeSummaryResource.invalidate()
      setRuntimeSkillRemoveTarget(null)
      toast.success(t("organizations.skillManageRemoveRuntimeSuccess", { name: target.displayName }))
    } catch (error) {
      toast.error(t("organizations.skillManageRemoveRuntimeFailed", { error: errorMessage(error) }))
    } finally {
      setBusyAction(null)
    }
  }, [
    busyAction,
    homeSummaryResource,
    runtimeSkillRemoveTarget,
    setBusyAction,
    skillInventory,
    skillService,
    skillVersionReport,
    t,
  ])

  const installRuntimeSkills = React.useCallback(
    async (skills: readonly { packageName: string; skillName: string }[]) => {
      const targets = skills.filter((skill) => skill.packageName.trim() && skill.skillName.trim())
      if (targets.length === 0 || busyAction) {
        return
      }

      setBusyAction("installSkillBatch")
      let installedCount = 0
      let failedCount = 0
      let firstError: unknown
      try {
        for (const skill of targets) {
          try {
            const nextInventory = await skillService.invoke("installRegistrySkill", {
              packageName: skill.packageName,
              skillId: skill.skillName,
            })
            skillInventory.setData(nextInventory)
            installedCount += 1
          } catch (error) {
            failedCount += 1
            firstError ??= error
          }
        }
        homeSummaryResource.invalidate()
        if (installedCount > 0) {
          toast.success(t("organizations.skillManageInstallMissingSuccess", { count: installedCount }))
        }
        if (failedCount > 0) {
          toast.error(
            t("organizations.skillManageInstallMissingFailed", {
              count: failedCount,
              error: errorMessage(firstError),
            }),
          )
        }
      } finally {
        setBusyAction(null)
      }
    },
    [busyAction, homeSummaryResource, setBusyAction, skillInventory, skillService, t],
  )

  const linkOrganizationSkill = React.useCallback(
    async (input: OrganizationSkillLinkInput, options: { installRuntime: boolean }) => {
      if (!organizationSkills?.canManage) {
        return
      }

      await organizationSkills.addSkill({
        packageName: input.packageName,
        skillName: input.skillName,
        version: input.version,
        versionPolicy: "pinned",
      })
      if (options.installRuntime) {
        const nextInventory = await skillService.invoke("installRegistrySkill", {
          packageName: input.packageName,
          skillId: input.skillName,
        })
        skillInventory.setData(nextInventory)
        homeSummaryResource.invalidate()
      }
    },
    [homeSummaryResource, organizationSkills, skillInventory, skillService],
  )

  const addOrganizationSkillFromRecommendation = React.useCallback(
    async (recommendation: ProviderSkillRecommendation, options: { installRuntime: boolean }) => {
      if (!organizationSkills?.canManage || busyAction) {
        return
      }

      setBusyAction(`addSkill:${recommendation.packageName}:${recommendation.skillId}`)
      try {
        await linkOrganizationSkill(
          {
            packageName: recommendation.packageName,
            skillName: recommendation.skillId,
            version: recommendation.package.version,
          },
          options,
        )
        toast.success(t("organizations.skillManageAddSuccess"))
      } catch (error) {
        toast.error(errorMessage(error))
      } finally {
        setBusyAction(null)
      }
    },
    [busyAction, linkOrganizationSkill, organizationSkills?.canManage, setBusyAction, t],
  )

  const addOrganizationSkillFromPackage = React.useCallback(
    async (pkg: PublicSkillPackage, options: { installRuntime: boolean; skillName?: string }) => {
      if (!organizationSkills?.canManage || busyAction) {
        return
      }

      const input = publicPackageLinkInput(pkg, options.skillName)
      if (!input) {
        toast.error(t("skills.discoverInstallNoSkill"))
        return
      }

      setBusyAction(`addSkill:${input.packageName}:${input.skillName}`)
      try {
        await linkOrganizationSkill(input, options)
        toast.success(t("organizations.skillManageAddSuccess"))
      } catch (error) {
        toast.error(errorMessage(error))
      } finally {
        setBusyAction(null)
      }
    },
    [busyAction, linkOrganizationSkill, organizationSkills?.canManage, setBusyAction, t],
  )

  const addOrganizationSkillBatch = React.useCallback(
    async (recommendations: readonly ProviderSkillRecommendation[], options: { installRuntime: boolean }) => {
      if (!organizationSkills?.canManage || recommendations.length === 0 || busyAction) {
        return
      }

      const plan = planProviderSkillRecommendationBulkLinks(recommendations, organizationSkills.skills)
      if (plan.linkable.length === 0) {
        return
      }

      setBusyAction("addSkillBatch")
      let linkedCount = 0
      let failedCount = 0
      let firstError: unknown
      try {
        for (const recommendation of plan.linkable) {
          try {
            await linkOrganizationSkill(
              {
                packageName: recommendation.packageName,
                skillName: recommendation.skillId,
                version: recommendation.package.version,
              },
              options,
            )
            linkedCount += 1
          } catch (error) {
            failedCount += 1
            firstError ??= error
          }
        }
        if (linkedCount > 0) {
          toast.success(
            options.installRuntime
              ? t("organizations.skillManageBulkAddInstallSuccess", { count: linkedCount })
              : t("organizations.skillManageBulkAddSuccess", { count: linkedCount }),
          )
        }
        if (failedCount > 0) {
          toast.error(
            t("organizations.skillManageBulkAddFailed", {
              count: failedCount,
              error: errorMessage(firstError),
            }),
          )
        }
      } finally {
        setBusyAction(null)
      }
    },
    [busyAction, linkOrganizationSkill, organizationSkills, setBusyAction, t],
  )

  return {
    addOrganizationSkillBatch,
    addOrganizationSkillFromPackage,
    addOrganizationSkillFromRecommendation,
    installRuntimeSkill,
    installRuntimeSkills,
    removeRuntimeSkill,
    runtimeSkillRemoveTarget,
    setRuntimeSkillRemoveTarget,
  }
}
