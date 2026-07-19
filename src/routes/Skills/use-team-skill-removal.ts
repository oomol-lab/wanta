import type { UseTeamSkills } from "@/hooks/useTeamSkills"

import * as React from "react"
import { toast } from "sonner"
import { skillErrorMessage } from "./skill-errors.ts"
import { teamOperationTargetsCurrentTeam } from "./team-management-model.ts"
import { useAppI18n } from "@/i18n"

type TeamSkill = UseTeamSkills["skills"][number]

interface TeamSkillRemovalTarget {
  teamId: string
  skill: TeamSkill
}

/** 删除目标始终绑定创建确认框时的团队，团队切换会立即使旧目标和旧回调失效。 */
export function useTeamSkillRemoval({
  onRemoved,
  teamSkills,
}: {
  onRemoved?: () => void
  teamSkills: UseTeamSkills | null
}) {
  const { t } = useAppI18n()
  const teamId = teamSkills?.teamId ?? null
  const [target, setTarget] = React.useState<TeamSkillRemovalTarget | null>(null)
  const [busySkillId, setBusySkillId] = React.useState<string | null>(null)
  const operationSequenceRef = React.useRef(0)
  const teamIdRef = React.useRef(teamId)

  React.useLayoutEffect(() => {
    if (teamIdRef.current !== teamId) {
      teamIdRef.current = teamId
      operationSequenceRef.current += 1
      setTarget(null)
      setBusySkillId(null)
    }
  }, [teamId])

  const open = React.useCallback(
    (skill: TeamSkill): void => {
      if (!teamId || busySkillId) return
      setTarget({ teamId, skill })
    },
    [busySkillId, teamId],
  )

  const close = React.useCallback((): void => {
    if (!busySkillId) setTarget(null)
  }, [busySkillId])

  const confirm = React.useCallback(async (): Promise<void> => {
    if (
      !target ||
      !teamSkills?.canManage ||
      !teamOperationTargetsCurrentTeam(target.teamId, teamSkills.teamId) ||
      busySkillId
    ) {
      if (target && !teamOperationTargetsCurrentTeam(target.teamId, teamSkills?.teamId ?? null)) {
        setTarget(null)
      }
      return
    }

    const operationId = operationSequenceRef.current + 1
    operationSequenceRef.current = operationId
    setBusySkillId(target.skill.id)
    try {
      await teamSkills.removePackage(target.skill.packageName)
      if (operationSequenceRef.current !== operationId || teamIdRef.current !== target.teamId) return
      toast.success(t("teams.skillManagePackageRemoved", { name: target.skill.packageName }))
      setTarget(null)
      onRemoved?.()
    } catch (error) {
      if (operationSequenceRef.current === operationId && teamIdRef.current === target.teamId) {
        toast.error(skillErrorMessage(error, t))
      }
    } finally {
      if (operationSequenceRef.current === operationId && teamIdRef.current === target.teamId) {
        setBusySkillId(null)
      }
    }
  }, [busySkillId, onRemoved, teamSkills, t, target])

  return {
    busySkillId,
    close,
    confirm,
    open,
    target: target?.skill ?? null,
  }
}
