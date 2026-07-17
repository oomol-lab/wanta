import type { ManagedSkillGroup, SkillInventory } from "../../electron/skills/common.ts"
import type { TranslateFn } from "../i18n/index.ts"

import * as React from "react"
import { toast } from "sonner"
import { useAppI18n } from "../i18n/index.ts"
import { resolveUserFacingError, userFacingErrorDescription } from "../lib/user-facing-error.ts"
import { useSkillService } from "./AppContext.ts"
import { useSkillInventoryResource, useSkillVersionReportResource } from "./AppDataHooks.ts"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"

interface UseSkillObjectActionsOptions {
  onDeleted?: (inventory: SkillInventory) => void
}

export interface SkillRemoveTarget {
  skill: ManagedSkillGroup
}

function skillActionErrorMessage(cause: unknown, t: TranslateFn): string {
  return userFacingErrorDescription(resolveUserFacingError(cause, { area: "skills" }), t)
}

export function useSkillObjectActions(options: UseSkillObjectActionsOptions = {}) {
  const { onDeleted } = options
  const { t } = useAppI18n()
  const skillService = useSkillService()
  const inventoryResource = useSkillInventoryResource()
  const versionResource = useSkillVersionReportResource()
  const [removeTarget, setRemoveTarget] = React.useState<SkillRemoveTarget | null>(null)
  const [isRemovingSkill, setIsRemovingSkill] = React.useState(false)
  const isRemovingSkillRef = React.useRef(false)

  const refreshSkillResources = React.useCallback(async () => {
    await inventoryResource.refresh({ forceRefresh: true, silent: true, supersede: true }).catch((error: unknown) => {
      reportRendererHandledError("skills", "silent skill inventory refresh failed after action", error)
    })
  }, [inventoryResource])

  const openSkillFolder = React.useCallback(
    async (pathname: string) => {
      try {
        await skillService.invoke("openSkillFolder", { path: pathname })
      } catch (cause) {
        reportRendererHandledError("skills", "open skill folder failed", cause)
        toast.error(t("skills.openFolderFailed", { error: skillActionErrorMessage(cause, t) }))
      }
    },
    [skillService, t],
  )

  const copySkillPath = React.useCallback(
    async (pathname: string) => {
      try {
        await navigator.clipboard.writeText(pathname)
        toast.success(t("skills.pathCopied"))
      } catch (cause) {
        reportRendererHandledError("skills", "copy skill path failed", cause)
        toast.error(t("skills.pathCopyFailed", { error: skillActionErrorMessage(cause, t) }))
      }
    },
    [t],
  )

  const removeSkill = React.useCallback(async () => {
    const target = removeTarget

    if (!target || isRemovingSkillRef.current) {
      return
    }

    isRemovingSkillRef.current = true
    setIsRemovingSkill(true)

    try {
      const nextInventory = await skillService.invoke("deleteSkill", {
        confirmed: true,
        skillId: target.skill.id,
      })
      inventoryResource.setData(nextInventory)
      versionResource.invalidate()
      await refreshSkillResources()
      if (!nextInventory.groups.some((group) => group.id === target.skill.id)) {
        onDeleted?.(nextInventory)
      }
      setRemoveTarget(null)
      toast.success(t("skills.removeDone", { name: target.skill.name }))
    } catch (cause) {
      reportRendererHandledError("skills", "remove skill failed", cause)
      toast.error(t("skills.removeFailed", { error: skillActionErrorMessage(cause, t) }))
    } finally {
      isRemovingSkillRef.current = false
      setIsRemovingSkill(false)
    }
  }, [inventoryResource, onDeleted, refreshSkillResources, removeTarget, skillService, t, versionResource])

  return {
    copySkillPath,
    isRemovingSkill,
    openSkillFolder,
    removeSkill,
    removeTarget,
    setRemoveTarget,
  }
}
