import type { ManagedSkillGroup } from "../../../electron/skills/common.ts"
import type { useSkillService } from "@/components/AppContext"
import type { useSkillInventoryResource, useSkillVersionReportResource } from "@/components/AppDataHooks"

import * as React from "react"

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
        const nextInventory = await skillService.invoke("updateRegistrySkill", { packageName, skillId: skill.id })
        inventoryResource.setData(nextInventory)
        await versionResource.refresh({ forceRefresh: true, silent: true })
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
