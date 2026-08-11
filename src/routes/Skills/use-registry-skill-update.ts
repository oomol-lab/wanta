import type { ManagedSkillGroup } from "../../../electron/skills/common.ts"
import type { useSkillService } from "@/components/AppContext"
import type { useSkillInventoryResource, useSkillVersionReportResource } from "@/components/AppDataHooks"

import * as React from "react"
import { runRegistrySkillUpdate } from "./registry-skill-update.ts"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"

interface UseRegistrySkillUpdateOptions {
  inventoryResource: ReturnType<typeof useSkillInventoryResource>
  mutationInFlightRef?: React.RefObject<boolean>
  onBusy?: () => void
  onError: (cause: unknown, skillId: string) => void
  onStart?: () => void
  skillService: ReturnType<typeof useSkillService>
  versionResource: ReturnType<typeof useSkillVersionReportResource>
}

export function useRegistrySkillUpdate({
  inventoryResource,
  mutationInFlightRef,
  onBusy,
  onError,
  onStart,
  skillService,
  versionResource,
}: UseRegistrySkillUpdateOptions) {
  const localInFlightRef = React.useRef(false)
  const inFlightRef = mutationInFlightRef ?? localInFlightRef
  const [updatingRegistrySkillId, setUpdatingRegistrySkillId] = React.useState<string | null>(null)

  const updateRegistrySkill = React.useCallback(
    async (skill: Pick<ManagedSkillGroup, "id" | "kind" | "packageName">): Promise<void> => {
      const packageName = skill.packageName?.trim()
      if (skill.kind !== "registry" || !packageName) {
        return
      }
      if (inFlightRef.current) {
        onBusy?.()
        return
      }

      inFlightRef.current = true
      setUpdatingRegistrySkillId(skill.id)
      onStart?.()
      try {
        await runRegistrySkillUpdate({
          invalidateVersions: versionResource.invalidate,
          refreshVersions: () => versionResource.refresh({ forceRefresh: true, silent: true }),
          reportVersionRefreshError: (cause) =>
            reportRendererHandledError("skills", "silent skill version refresh failed after update", cause),
          setInventory: inventoryResource.setData,
          update: () => skillService.invoke("updateRegistrySkill", { packageName, skillId: skill.id }),
        })
      } catch (cause) {
        onError(cause, skill.id)
      } finally {
        inFlightRef.current = false
        setUpdatingRegistrySkillId(null)
      }
    },
    [inFlightRef, inventoryResource, onBusy, onError, onStart, skillService, versionResource],
  )

  return { updateRegistrySkill, updatingRegistrySkillId }
}
