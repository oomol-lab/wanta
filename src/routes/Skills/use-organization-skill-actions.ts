import type { PublicSkillPackage } from "../../../electron/skills/common.ts"
import type { BusyAction, OrganizationSkillLinkInput } from "./organization-management-model.ts"
import type { UseOrganizationSkills } from "@/hooks/useOrganizationSkills"
import type { ProviderSkillRecommendation } from "@/routes/Skills/provider-skill-recommendations"
import type { RuntimeSkillRemoveTarget } from "@/routes/Skills/skill-route-model"

import * as React from "react"
import { toast } from "sonner"
import { planProviderSkillRecommendationBulkLinks, runtimeSkillRemoveBusyKey } from "./organization-management-model.ts"
import { skillErrorMessage } from "./skill-errors.ts"
import { useScopedBusyAction } from "./use-scoped-busy-action.ts"
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
  const action = useScopedBusyAction({
    busyAction,
    contextKey: organizationSkills?.organizationId ?? "no-organization",
    setBusyAction,
  })

  const installRuntimeSkill = React.useCallback(
    async (skill: { packageName: string; skillName: string }) => {
      const operation = action.begin(`installSkill:${skill.packageName}:${skill.skillName}`)
      if (!operation) return
      try {
        const nextInventory = await skillService.invoke("installRegistrySkill", {
          packageName: skill.packageName,
          skillId: skill.skillName,
        })
        skillInventory.setData(nextInventory)
        skillVersionReport.invalidate()
        if (action.isCurrent(operation)) toast.success(t("skills.registryInstallDone", { name: skill.skillName }))
      } catch (error) {
        if (action.isCurrent(operation)) {
          toast.error(t("skills.registryInstallFailed", { error: skillErrorMessage(error, t) }))
        }
      } finally {
        action.finish(operation)
      }
    },
    [action, skillInventory, skillService, skillVersionReport, t],
  )

  const removeRuntimeSkill = React.useCallback(async () => {
    const target = runtimeSkillRemoveTarget
    if (!target) return
    const operation = action.begin(runtimeSkillRemoveBusyKey(target))
    if (!operation) return

    try {
      const nextInventory = await skillService.invoke("deleteSkill", {
        confirmed: true,
        skillId: target.groupId,
      })
      skillInventory.setData(nextInventory)
      skillVersionReport.invalidate()
      if (action.isCurrent(operation)) {
        setRuntimeSkillRemoveTarget(null)
        toast.success(t("organizations.skillManageRemoveRuntimeSuccess", { name: target.displayName }))
      }
    } catch (error) {
      if (action.isCurrent(operation)) {
        toast.error(t("organizations.skillManageRemoveRuntimeFailed", { error: skillErrorMessage(error, t) }))
      }
    } finally {
      action.finish(operation)
    }
  }, [action, runtimeSkillRemoveTarget, skillInventory, skillService, skillVersionReport, t])

  const installRuntimeSkills = React.useCallback(
    async (skills: readonly { packageName: string; skillName: string }[]) => {
      const targets = skills.filter((skill) => skill.packageName.trim() && skill.skillName.trim())
      if (targets.length === 0) return
      const operation = action.begin("installSkillBatch")
      if (!operation) return

      try {
        const result = await skillService.invoke(
          "installRegistrySkills",
          targets.map((skill) => ({ packageName: skill.packageName, skillId: skill.skillName })),
        )
        skillInventory.setData(result.inventory)
        if (result.installed.length > 0) {
          skillVersionReport.invalidate()
          if (action.isCurrent(operation)) {
            toast.success(t("organizations.skillManageInstallMissingSuccess", { count: result.installed.length }))
          }
        }
        if (result.failures.length > 0 && action.isCurrent(operation)) {
          toast.error(
            t("organizations.skillManageInstallMissingFailed", {
              count: result.failures.length,
              error: skillErrorMessage(result.failures[0]?.error, t),
            }),
          )
        }
      } catch (error) {
        if (action.isCurrent(operation)) {
          toast.error(
            t("organizations.skillManageInstallMissingFailed", {
              count: targets.length,
              error: skillErrorMessage(error, t),
            }),
          )
        }
      } finally {
        action.finish(operation)
      }
    },
    [action, skillInventory, skillService, skillVersionReport, t],
  )

  const linkOrganizationSkill = React.useCallback(
    async (input: OrganizationSkillLinkInput, options: { installRuntime: boolean; refreshOrganization?: boolean }) => {
      if (!organizationSkills?.canManage) {
        return { runtimeError: undefined }
      }

      await organizationSkills.addSkill(
        {
          packageName: input.packageName,
          skillName: input.skillName,
          version: input.version,
          versionPolicy: "pinned",
        },
        { refresh: options.refreshOrganization },
      )
      if (options.installRuntime) {
        try {
          const nextInventory = await skillService.invoke("installRegistrySkill", {
            packageName: input.packageName,
            skillId: input.skillName,
          })
          skillInventory.setData(nextInventory)
          skillVersionReport.invalidate()
        } catch (runtimeError) {
          return { runtimeError }
        }
      }
      return { runtimeError: undefined }
    },
    [organizationSkills, skillInventory, skillService, skillVersionReport],
  )

  const addOrganizationSkillFromRecommendation = React.useCallback(
    async (recommendation: ProviderSkillRecommendation, options: { installRuntime: boolean }) => {
      if (!organizationSkills?.canManage) return
      const operation = action.begin(`addSkill:${recommendation.packageName}:${recommendation.skillId}`)
      if (!operation) return

      try {
        const result = await linkOrganizationSkill(
          {
            packageName: recommendation.packageName,
            skillName: recommendation.skillId,
            version: recommendation.package.version,
          },
          options,
        )
        if (action.isCurrent(operation)) {
          toast.success(t("organizations.skillManageAddSuccess"))
          if (result.runtimeError) {
            toast.error(
              t("organizations.skillManageRuntimeInstallPartialFailure", {
                error: skillErrorMessage(result.runtimeError, t),
              }),
            )
          }
        }
      } catch (error) {
        if (action.isCurrent(operation)) toast.error(skillErrorMessage(error, t))
      } finally {
        action.finish(operation)
      }
    },
    [action, linkOrganizationSkill, organizationSkills?.canManage, t],
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

      const operation = action.begin(`addSkill:${input.packageName}:${input.skillName}`)
      if (!operation) return
      try {
        const result = await linkOrganizationSkill(input, options)
        if (action.isCurrent(operation)) {
          toast.success(t("organizations.skillManageAddSuccess"))
          if (result.runtimeError) {
            toast.error(
              t("organizations.skillManageRuntimeInstallPartialFailure", {
                error: skillErrorMessage(result.runtimeError, t),
              }),
            )
          }
        }
      } catch (error) {
        if (action.isCurrent(operation)) toast.error(skillErrorMessage(error, t))
      } finally {
        action.finish(operation)
      }
    },
    [action, linkOrganizationSkill, organizationSkills?.canManage, t],
  )

  const addOrganizationSkillBatch = React.useCallback(
    async (recommendations: readonly ProviderSkillRecommendation[], options: { installRuntime: boolean }) => {
      if (!organizationSkills?.canManage || recommendations.length === 0) {
        return
      }

      const plan = planProviderSkillRecommendationBulkLinks(recommendations, organizationSkills.skills)
      if (plan.linkable.length === 0) return
      const operation = action.begin("addSkillBatch")
      if (!operation) return

      let linkedCount = 0
      let failedCount = 0
      let firstError: unknown
      const runtimeTargets: Array<{ packageName: string; skillId: string }> = []
      try {
        for (const recommendation of plan.linkable) {
          try {
            await linkOrganizationSkill(
              {
                packageName: recommendation.packageName,
                skillName: recommendation.skillId,
                version: recommendation.package.version,
              },
              { installRuntime: false, refreshOrganization: false },
            )
            linkedCount += 1
            runtimeTargets.push({ packageName: recommendation.packageName, skillId: recommendation.skillId })
          } catch (error) {
            failedCount += 1
            firstError ??= error
          }
        }
        if (linkedCount > 0 && action.isCurrent(operation)) {
          await organizationSkills.refresh({ forceRefresh: true })
        }
        let installedCount = 0
        if (options.installRuntime && runtimeTargets.length > 0) {
          try {
            const result = await skillService.invoke("installRegistrySkills", runtimeTargets)
            skillInventory.setData(result.inventory)
            installedCount = result.installed.length
            if (installedCount > 0) {
              skillVersionReport.invalidate()
            }
            if (result.failures.length > 0 && action.isCurrent(operation)) {
              toast.error(
                t("organizations.skillManageInstallMissingFailed", {
                  count: result.failures.length,
                  error: skillErrorMessage(result.failures[0]?.error, t),
                }),
              )
            }
          } catch (error) {
            if (action.isCurrent(operation)) toast.error(skillErrorMessage(error, t))
          }
        }
        if (linkedCount > 0 && action.isCurrent(operation)) {
          toast.success(
            options.installRuntime && installedCount > 0
              ? t("organizations.skillManageBulkAddInstallSuccess", { count: installedCount })
              : t("organizations.skillManageBulkAddSuccess", { count: linkedCount }),
          )
        }
        if (failedCount > 0 && action.isCurrent(operation)) {
          toast.error(
            t("organizations.skillManageBulkAddFailed", {
              count: failedCount,
              error: skillErrorMessage(firstError, t),
            }),
          )
        }
      } finally {
        action.finish(operation)
      }
    },
    [action, linkOrganizationSkill, organizationSkills, skillInventory, skillService, skillVersionReport, t],
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
