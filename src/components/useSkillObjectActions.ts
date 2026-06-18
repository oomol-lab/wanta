import type {
  ManagedSkillGroup,
  ManagedSkillHostCoverage,
  ShareSkillRequest,
  SkillEditorApp,
  SkillEditorAppId,
  SkillInventory,
  SkillShareResult,
} from "../../electron/skills/common.ts"
import type { TranslateFn } from "../i18n/index.ts"

import * as React from "react"
import { toast } from "sonner"
import { useAppI18n } from "../i18n/index.ts"
import { getPrimarySkillSourcePath } from "../lib/skill-utils.ts"
import { resolveUserFacingError, userFacingErrorDescription } from "../lib/user-facing-error.ts"
import { useSkillService } from "./AppContext.ts"
import { useSkillInventoryResource, useSkillShareInfoStore, useSkillVersionReportResource } from "./AppDataHooks.ts"

interface UseSkillObjectActionsOptions {
  onDeleted?: (inventory: SkillInventory) => void
}

export type SkillRemoveTarget =
  | { scope: "all"; skill: ManagedSkillGroup }
  | { scope: "agent"; skill: ManagedSkillGroup; host: ManagedSkillHostCoverage }

function skillActionErrorMessage(cause: unknown, t: TranslateFn): string {
  return userFacingErrorDescription(resolveUserFacingError(cause, { area: "skills" }), t)
}

export function useSkillObjectActions(options: UseSkillObjectActionsOptions = {}) {
  const { onDeleted } = options
  const { locale, t } = useAppI18n()
  const skillService = useSkillService()
  const inventoryResource = useSkillInventoryResource()
  const skillShareInfoStore = useSkillShareInfoStore()
  const versionResource = useSkillVersionReportResource()
  const [actingSkillKey, setActingSkillKey] = React.useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = React.useState<SkillRemoveTarget | null>(null)
  const [isRemovingSkill, setIsRemovingSkill] = React.useState(false)
  const [skillEditors, setSkillEditors] = React.useState<SkillEditorApp[]>([])
  const actingSkillKeyRef = React.useRef<string | null>(null)
  const isRemovingSkillRef = React.useRef(false)

  const startActing = React.useCallback((key: string): boolean => {
    if (actingSkillKeyRef.current) {
      return false
    }

    actingSkillKeyRef.current = key
    setActingSkillKey(key)
    return true
  }, [])

  const finishActing = React.useCallback((key: string): void => {
    if (actingSkillKeyRef.current !== key) {
      return
    }

    actingSkillKeyRef.current = null
    setActingSkillKey(null)
  }, [])

  React.useEffect(() => {
    let isActive = true

    void skillService
      .invoke("listSkillEditors")
      .then((editors) => {
        if (isActive) {
          setSkillEditors(editors)
        }
      })
      .catch(() => {
        if (isActive) {
          setSkillEditors([])
        }
      })

    return () => {
      isActive = false
    }
  }, [skillService])

  const refreshSkillResources = React.useCallback(async () => {
    await inventoryResource.refresh({ forceRefresh: true, silent: true, supersede: true }).catch(() => {})
  }, [inventoryResource])

  const openSkillFolder = React.useCallback(
    async (pathname: string) => {
      try {
        await skillService.invoke("openSkillFolder", { path: pathname })
      } catch (cause) {
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
        toast.error(t("skills.pathCopyFailed", { error: skillActionErrorMessage(cause, t) }))
      }
    },
    [t],
  )

  const copySharePrompt = React.useCallback(
    async (prompt: string) => {
      try {
        await navigator.clipboard.writeText(prompt)
        toast.success(t("skills.shareCopied"))
        return true
      } catch (cause) {
        toast.error(t("skills.shareCopyFailed", { error: skillActionErrorMessage(cause, t) }))
        return false
      }
    },
    [t],
  )

  const openSkillInEditor = React.useCallback(
    async (pathname: string, editorId?: SkillEditorAppId) => {
      const actingKey = `editor:${pathname}`

      if (!startActing(actingKey)) {
        return
      }

      try {
        await skillService.invoke("openSkillInEditor", { editorId, path: pathname })
      } catch (cause) {
        toast.error(t("skills.openEditorFailed", { error: skillActionErrorMessage(cause, t) }))
      } finally {
        finishActing(actingKey)
      }
    },
    [finishActing, skillService, startActing, t],
  )

  const publishSkillPath = React.useCallback(
    async (request: { key: string; path?: string; visibility: "private" | "public" }) => {
      if (!request.path) {
        toast.error(t("skills.publishUnavailable"))
        return
      }

      if (!startActing(request.key)) {
        return
      }

      try {
        const result = await skillService.invoke("publishSkill", { path: request.path, visibility: request.visibility })
        inventoryResource.setData(result.inventory)
        const publishedGroup = result.inventory.groups.find((group) => {
          return group.hosts.some((host) => host.sourcePath === request.path || host.path === request.path)
        })
        const packageName = publishedGroup?.packageName?.trim()
        if (packageName) {
          skillShareInfoStore.setInfo(packageName, {
            limitsRequired: request.visibility === "private",
            packageName,
            visibility: request.visibility,
          })
        }
        versionResource.invalidate()
        await refreshSkillResources()
        toast.success(t("skills.publishDone"))
      } catch (cause) {
        toast.error(t("skills.publishFailed", { error: skillActionErrorMessage(cause, t) }))
      } finally {
        finishActing(request.key)
      }
    },
    [
      finishActing,
      inventoryResource,
      refreshSkillResources,
      skillService,
      skillShareInfoStore,
      startActing,
      t,
      versionResource,
    ],
  )

  const publishSkill = React.useCallback(
    async (skill: ManagedSkillGroup, visibility: "private" | "public") => {
      await publishSkillPath({
        key: `publish:${skill.id}`,
        path: getPrimarySkillSourcePath(skill),
        visibility,
      })
    },
    [publishSkillPath],
  )

  const shareSkill = React.useCallback(
    async (
      skill: ManagedSkillGroup,
      options: Omit<ShareSkillRequest, "language" | "skillId"> = {},
    ): Promise<SkillShareResult | undefined> => {
      const actingKey = `share:${skill.id}`

      if (!startActing(actingKey)) {
        return undefined
      }

      try {
        const result = await skillService.invoke("shareSkill", {
          ...options,
          language: locale === "zh-CN" ? "zh" : "en",
          skillId: skill.id,
        })
        let copied = false
        try {
          await navigator.clipboard.writeText(result.prompt)
          copied = true
        } catch (cause) {
          toast.error(t("skills.shareCopyFailed", { error: skillActionErrorMessage(cause, t) }))
        }
        return { ...result, copied }
      } catch (cause) {
        toast.error(t("skills.shareFailed", { error: skillActionErrorMessage(cause, t) }))
        return undefined
      } finally {
        finishActing(actingKey)
      }
    },
    [finishActing, locale, skillService, startActing, t],
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
        agentId: target.scope === "agent" ? target.host.agentId : undefined,
        confirmed: true,
        skillId: target.skill.id,
      })
      inventoryResource.setData(nextInventory)
      versionResource.invalidate()
      await refreshSkillResources()
      if (target.scope === "all" || !nextInventory.groups.some((group) => group.id === target.skill.id)) {
        onDeleted?.(nextInventory)
      }
      setRemoveTarget(null)
      toast.success(
        target.scope === "agent"
          ? t("skills.removeAgentDone", { agent: target.host.agentName, name: target.skill.name })
          : t("skills.removeAllDone", { name: target.skill.name }),
      )
    } catch (cause) {
      toast.error(t("skills.removeFailed", { error: skillActionErrorMessage(cause, t) }))
    } finally {
      isRemovingSkillRef.current = false
      setIsRemovingSkill(false)
    }
  }, [inventoryResource, onDeleted, refreshSkillResources, removeTarget, skillService, t, versionResource])

  return {
    actingSkillKey,
    copySharePrompt,
    copySkillPath,
    isRemovingSkill,
    openSkillFolder,
    openSkillInEditor,
    publishSkill,
    publishSkillPath,
    removeSkill,
    removeTarget,
    setRemoveTarget,
    shareSkill,
    skillEditors,
  }
}
