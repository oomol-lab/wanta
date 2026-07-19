import type { Team } from "../../../electron/teams/common.ts"
import type { BusyAction } from "./team-management-model.ts"

import * as React from "react"
import { toast } from "sonner"
import { teamErrorMessage } from "./team-errors.ts"
import {
  isConflictError,
  maxTeamNameLength,
  teamNameValidation,
  refreshAfterCommittedTeamMutation,
} from "./team-management-model.ts"
import { useScopedBusyAction } from "./use-scoped-busy-action.ts"
import { useAppI18n } from "@/i18n"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { createTeam, updateTeam, uploadTeamAvatar } from "@/lib/teams-client"

interface TeamFormsOptions {
  busyAction: BusyAction | null
  canManageTeam: (team: Team) => boolean
  teams: Team[]
  refreshWorkspace: (options?: { forceRefresh?: boolean }) => Promise<unknown>
  selectedTeamId: string | null
  selectTeam: (teamId: string) => void
  setBusyAction: React.Dispatch<React.SetStateAction<BusyAction | null>>
  upsertTeam: (team: Team, options?: { avatarFile?: File | null }) => void
}

function useNameError(name: string, duplicated: boolean) {
  const { t } = useAppI18n()
  return React.useMemo(() => {
    if (!name) return null
    switch (teamNameValidation(name.trim())) {
      case "empty":
        return t("teams.teamNameRequired")
      case "invalid":
        return t("teams.teamNameInvalid")
      case "too-long":
        return t("teams.teamNameTooLong", { max: maxTeamNameLength })
      case "valid":
        return duplicated ? t("teams.teamNameDuplicated") : null
    }
  }, [duplicated, name, t])
}

export function useTeamForms({
  busyAction,
  canManageTeam,
  teams,
  refreshWorkspace,
  selectedTeamId,
  selectTeam,
  setBusyAction,
  upsertTeam,
}: TeamFormsOptions) {
  const { t } = useAppI18n()
  const [createOpen, setCreateOpen] = React.useState(false)
  const [createName, setCreateName] = React.useState("")
  const [createAvatarFile, setCreateAvatarFile] = React.useState<File | null>(null)
  const [createDuplicated, setCreateDuplicated] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)
  const [editTeamId, setEditTeamId] = React.useState<string | null>(null)
  const [editName, setEditName] = React.useState("")
  const [editAvatar, setEditAvatar] = React.useState("")
  const [editAvatarFile, setEditAvatarFile] = React.useState<File | null>(null)
  const [editDuplicated, setEditDuplicated] = React.useState(false)
  const editingTeam = React.useMemo(
    () => (editTeamId ? (teams.find((item) => item.id === editTeamId) ?? null) : null),
    [editTeamId, teams],
  )
  const createNameError = useNameError(createName, createDuplicated)
  const editNameError = useNameError(editName, editDuplicated)
  const action = useScopedBusyAction({
    busyAction,
    contextKey: selectedTeamId ?? "no-team",
    setBusyAction,
  })

  const refreshAfterMutation = React.useCallback(async (): Promise<void> => {
    await refreshAfterCommittedTeamMutation(
      () => refreshWorkspace({ forceRefresh: true }),
      (error) => {
        reportRendererHandledError("teams", "workspace refresh after team mutation failed", error)
        toast.error(t("teams.refreshFailedTitle"))
      },
    )
  }, [refreshWorkspace, t])

  const submitCreate = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      const teamName = createName.trim()
      const validation = teamNameValidation(teamName)
      if (validation !== "valid") {
        toast.error(
          validation === "empty"
            ? t("teams.teamNameRequired")
            : validation === "invalid"
              ? t("teams.teamNameInvalid")
              : t("teams.teamNameTooLong", { max: maxTeamNameLength }),
        )
        return
      }

      const operation = action.begin("create")
      if (!operation) return
      try {
        let team = await createTeam({ teamName })
        upsertTeam(team)
        const shouldPresentResult = action.isCurrent(operation)
        if (shouldPresentResult) {
          selectTeam(team.id)
          setCreateOpen(false)
          setCreateName("")
          setCreateAvatarFile(null)
          setCreateDuplicated(false)
        }
        if (createAvatarFile) {
          try {
            const { avatar } = await uploadTeamAvatar(team.id, createAvatarFile)
            team = await updateTeam({ avatar, teamId: team.id, teamName: team.name })
            upsertTeam(team, { avatarFile: createAvatarFile })
          } catch {
            if (shouldPresentResult) toast.error(t("teams.avatarUpdatePartialFailure"))
          }
        }
        if (shouldPresentResult) toast.success(t("teams.createTeamSuccess"))
        await refreshAfterMutation()
      } catch (error) {
        if (!action.isCurrent(operation)) return
        if (isConflictError(error)) {
          setCreateDuplicated(true)
          toast.error(t("teams.teamNameDuplicated"))
        } else {
          toast.error(teamErrorMessage(error, t))
        }
      } finally {
        action.finish(operation)
      }
    },
    [action, createAvatarFile, createName, refreshAfterMutation, selectTeam, t, upsertTeam],
  )

  const openEdit = React.useCallback((team: Team) => {
    setEditTeamId(team.id)
    setEditName(team.name)
    setEditAvatar(team.avatar)
    setEditAvatarFile(null)
    setEditDuplicated(false)
    setEditOpen(true)
  }, [])

  const closeEdit = React.useCallback(() => {
    if (busyAction === "updateTeam") return
    setEditOpen(false)
    setEditTeamId(null)
    setEditName("")
    setEditAvatar("")
    setEditAvatarFile(null)
    setEditDuplicated(false)
  }, [busyAction])

  const changeEditAvatarFile = React.useCallback(
    (file: File | null) => {
      setEditAvatarFile(file)
      if (!editingTeam || !canManageTeam(editingTeam)) {
        setEditAvatarFile(null)
      }
    },
    [canManageTeam, editingTeam],
  )

  const submitEdit = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      if (!editingTeam || !canManageTeam(editingTeam)) return
      const teamName = editName.trim()
      const validation = teamNameValidation(teamName)
      if (validation !== "valid") {
        toast.error(
          validation === "empty"
            ? t("teams.teamNameRequired")
            : validation === "invalid"
              ? t("teams.teamNameInvalid")
              : t("teams.teamNameTooLong", { max: maxTeamNameLength }),
        )
        return
      }

      const operation = action.begin("updateTeam")
      if (!operation) return
      try {
        let avatar = editAvatar.trim()
        if (editAvatarFile) {
          const uploaded = await uploadTeamAvatar(editingTeam.id, editAvatarFile)
          avatar = uploaded.avatar
        }
        const team = await updateTeam({ avatar, teamId: editingTeam.id, teamName })
        upsertTeam(team, editAvatarFile || avatar !== editingTeam.avatar ? { avatarFile: editAvatarFile } : undefined)
        if (!action.isCurrent(operation)) return
        toast.success(t("teams.updateTeamSuccess"))
        setEditOpen(false)
        setEditTeamId(null)
        setEditName("")
        setEditAvatar("")
        setEditAvatarFile(null)
        setEditDuplicated(false)
        selectTeam(team.id)
        await refreshAfterMutation()
      } catch (error) {
        if (!action.isCurrent(operation)) return
        if (isConflictError(error)) {
          setEditDuplicated(true)
          toast.error(t("teams.teamNameDuplicated"))
        } else {
          toast.error(teamErrorMessage(error, t))
        }
      } finally {
        action.finish(operation)
      }
    },
    [
      canManageTeam,
      editAvatar,
      editAvatarFile,
      editName,
      editingTeam,
      action,
      refreshAfterMutation,
      selectTeam,
      t,
      upsertTeam,
    ],
  )

  return {
    create: {
      avatarFile: createAvatarFile,
      close: () => {
        if (busyAction !== "create") {
          setCreateOpen(false)
          setCreateName("")
          setCreateAvatarFile(null)
          setCreateDuplicated(false)
        }
      },
      name: createName,
      nameError: createNameError,
      open: createOpen,
      openDialog: () => setCreateOpen(true),
      setAvatarFile: setCreateAvatarFile,
      setName: (value: string) => {
        setCreateName(value)
        setCreateDuplicated(false)
      },
      submit: submitCreate,
    },
    edit: {
      avatar: editAvatar,
      avatarFile: editAvatarFile,
      changeAvatarFile: changeEditAvatarFile,
      close: closeEdit,
      name: editName,
      nameError: editNameError,
      open: editOpen,
      openDialog: openEdit,
      team: editingTeam,
      setAvatar: setEditAvatar,
      setName: (value: string) => {
        setEditName(value)
        setEditDuplicated(false)
      },
      submit: submitEdit,
    },
  }
}
