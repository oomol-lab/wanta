import type { PublicSkillPackage } from "../../../electron/skills/common.ts"
import type { BusyAction, OrganizationSkillLinkInput } from "./organization-management-model.ts"
import type { UseOrganizationSkills } from "@/hooks/useOrganizationSkills"
import type { ProviderSkillRecommendation } from "@/routes/Skills/provider-skill-recommendations"
import type { RuntimeSkillRemoveTarget } from "@/routes/Skills/skill-route-model"

import * as React from "react"
import { toast } from "sonner"
import { planProviderSkillRecommendationBulkLinks, runtimeSkillRemoveBusyKey } from "./organization-management-model.ts"
import { skillErrorMessage } from "./skill-errors.ts"
import { useSkillService } from "@/components/AppContext"
import { useSkillInventoryResource, useSkillVersionReportResource } from "@/components/AppDataHooks"
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
  const [runtimeSkillRemoveTarget, setRuntimeSkillRemoveTarget] = React.useState<RuntimeSkillRemoveTarget | null>(null)
  const busyActionRef = React.useRef<BusyAction | null>(busyAction)

  React.useEffect(() => {
    busyActionRef.current = busyAction
  }, [busyAction])

  const beginAction = React.useCallback(
    (action: BusyAction): boolean => {
      if (busyActionRef.current) {
        return false
      }
      busyActionRef.current = action
      setBusyAction(action)
      return true
    },
    [setBusyAction],
  )

  const endAction = React.useCallback((): void => {
    busyActionRef.current = null
    setBusyAction(null)
  }, [setBusyAction])

  const installRuntimeSkill = React.useCallback(
    async (skill: { packageName: string; skillName: string }) => {
      if (!beginAction(`installSkill:${skill.packageName}:${skill.skillName}`)) {
        return
      }
      try {
        const nextInventory = await skillService.invoke("installRegistrySkill", {
          packageName: skill.packageName,
          skillId: skill.skillName,
        })
        skillInventory.setData(nextInventory)
        skillVersionReport.invalidate()
        toast.success(t("skills.registryInstallDone", { name: skill.skillName }))
      } catch (error) {
        toast.error(t("skills.registryInstallFailed", { error: skillErrorMessage(error, t) }))
      } finally {
        endAction()
      }
    },
    [beginAction, endAction, skillInventory, skillService, skillVersionReport, t],
  )

  const removeRuntimeSkill = React.useCallback(async () => {
    const target = runtimeSkillRemoveTarget
    if (!target || !beginAction(runtimeSkillRemoveBusyKey(target))) {
      return
    }

    try {
      const nextInventory = await skillService.invoke("deleteSkill", {
        confirmed: true,
        skillId: target.groupId,
      })
      skillInventory.setData(nextInventory)
      skillVersionReport.invalidate()
      setRuntimeSkillRemoveTarget(null)
      toast.success(t("organizations.skillManageRemoveRuntimeSuccess", { name: target.displayName }))
    } catch (error) {
      toast.error(t("organizations.skillManageRemoveRuntimeFailed", { error: skillErrorMessage(error, t) }))
    } finally {
      endAction()
    }
  }, [beginAction, endAction, runtimeSkillRemoveTarget, skillInventory, skillService, skillVersionReport, t])

  const installRuntimeSkills = React.useCallback(
    async (skills: readonly { packageName: string; skillName: string }[]) => {
      const targets = skills.filter((skill) => skill.packageName.trim() && skill.skillName.trim())
      if (targets.length === 0 || !beginAction("installSkillBatch")) {
        return
      }

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
        if (installedCount > 0) {
          skillVersionReport.invalidate()
          toast.success(t("organizations.skillManageInstallMissingSuccess", { count: installedCount }))
        }
        if (failedCount > 0) {
          toast.error(
            t("organizations.skillManageInstallMissingFailed", {
              count: failedCount,
              error: skillErrorMessage(firstError, t),
            }),
          )
        }
      } finally {
        endAction()
      }
    },
    [beginAction, endAction, skillInventory, skillService, skillVersionReport, t],
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
        skillVersionReport.invalidate()
      }
    },
    [organizationSkills, skillInventory, skillService, skillVersionReport],
  )

  const addOrganizationSkillFromRecommendation = React.useCallback(
    async (recommendation: ProviderSkillRecommendation, options: { installRuntime: boolean }) => {
      if (
        !organizationSkills?.canManage ||
        !beginAction(`addSkill:${recommendation.packageName}:${recommendation.skillId}`)
      ) {
        return
      }

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
        toast.error(skillErrorMessage(error, t))
      } finally {
        endAction()
      }
    },
    [beginAction, endAction, linkOrganizationSkill, organizationSkills?.canManage, t],
  )

  const addOrganizationSkillFromPackage = React.useCallback(
    async (pkg: PublicSkillPackage, options: { installRuntime: boolean; skillName?: string }) => {
      if (!organizationSkills?.canManage) {
        return
      }

      const input = publicPackageLinkInput(pkg, options.skillName)
      if (!input) {
        toast.error(t("skills.discoverInstallNoSkill"))
        return
      }

      if (!beginAction(`addSkill:${input.packageName}:${input.skillName}`)) {
        return
      }
      try {
        await linkOrganizationSkill(input, options)
        toast.success(t("organizations.skillManageAddSuccess"))
      } catch (error) {
        toast.error(skillErrorMessage(error, t))
      } finally {
        endAction()
      }
    },
    [beginAction, endAction, linkOrganizationSkill, organizationSkills?.canManage, t],
  )

  const addOrganizationSkillBatch = React.useCallback(
    async (recommendations: readonly ProviderSkillRecommendation[], options: { installRuntime: boolean }) => {
      if (!organizationSkills?.canManage || recommendations.length === 0) {
        return
      }

      const plan = planProviderSkillRecommendationBulkLinks(recommendations, organizationSkills.skills)
      if (plan.linkable.length === 0 || !beginAction("addSkillBatch")) {
        return
      }

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
              error: skillErrorMessage(firstError, t),
            }),
          )
        }
      } finally {
        endAction()
      }
    },
    [beginAction, endAction, linkOrganizationSkill, organizationSkills, t],
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
