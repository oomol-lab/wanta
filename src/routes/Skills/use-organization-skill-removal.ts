import type { UseOrganizationSkills } from "@/hooks/useOrganizationSkills"

import * as React from "react"
import { toast } from "sonner"
import { organizationOperationTargetsCurrentOrganization } from "./organization-management-model.ts"
import { skillErrorMessage } from "./skill-errors.ts"
import { useAppI18n } from "@/i18n"

type OrganizationSkill = UseOrganizationSkills["skills"][number]

interface OrganizationSkillRemovalTarget {
  organizationId: string
  skill: OrganizationSkill
}

/** 删除目标始终绑定创建确认框时的组织，组织切换会立即使旧目标和旧回调失效。 */
export function useOrganizationSkillRemoval({
  onRemoved,
  organizationSkills,
}: {
  onRemoved?: () => void
  organizationSkills: UseOrganizationSkills | null
}) {
  const { t } = useAppI18n()
  const organizationId = organizationSkills?.organizationId ?? null
  const [target, setTarget] = React.useState<OrganizationSkillRemovalTarget | null>(null)
  const [busySkillId, setBusySkillId] = React.useState<string | null>(null)
  const operationSequenceRef = React.useRef(0)
  const organizationIdRef = React.useRef(organizationId)

  React.useLayoutEffect(() => {
    if (organizationIdRef.current !== organizationId) {
      organizationIdRef.current = organizationId
      operationSequenceRef.current += 1
      setTarget(null)
      setBusySkillId(null)
    }
  }, [organizationId])

  const open = React.useCallback(
    (skill: OrganizationSkill): void => {
      if (!organizationId || busySkillId) return
      setTarget({ organizationId, skill })
    },
    [busySkillId, organizationId],
  )

  const close = React.useCallback((): void => {
    if (!busySkillId) setTarget(null)
  }, [busySkillId])

  const confirm = React.useCallback(async (): Promise<void> => {
    if (
      !target ||
      !organizationSkills?.canManage ||
      !organizationOperationTargetsCurrentOrganization(target.organizationId, organizationSkills.organizationId) ||
      busySkillId
    ) {
      if (
        target &&
        !organizationOperationTargetsCurrentOrganization(
          target.organizationId,
          organizationSkills?.organizationId ?? null,
        )
      ) {
        setTarget(null)
      }
      return
    }

    const operationId = operationSequenceRef.current + 1
    operationSequenceRef.current = operationId
    setBusySkillId(target.skill.id)
    try {
      await organizationSkills.removePackage(target.skill.packageName)
      if (operationSequenceRef.current !== operationId || organizationIdRef.current !== target.organizationId) return
      toast.success(t("organizations.skillManagePackageRemoved", { name: target.skill.packageName }))
      setTarget(null)
      onRemoved?.()
    } catch (error) {
      if (operationSequenceRef.current === operationId && organizationIdRef.current === target.organizationId) {
        toast.error(skillErrorMessage(error, t))
      }
    } finally {
      if (operationSequenceRef.current === operationId && organizationIdRef.current === target.organizationId) {
        setBusySkillId(null)
      }
    }
  }, [busySkillId, onRemoved, organizationSkills, t, target])

  return {
    busySkillId,
    close,
    confirm,
    open,
    target: target?.skill ?? null,
  }
}
