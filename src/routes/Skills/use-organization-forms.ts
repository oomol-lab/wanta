import type { Organization } from "../../../electron/organizations/common.ts"
import type { BusyAction } from "./organization-management-model.ts"

import * as React from "react"
import { toast } from "sonner"
import { organizationErrorMessage } from "./organization-errors.ts"
import {
  isConflictError,
  maxOrganizationNameLength,
  organizationNameValidation,
} from "./organization-management-model.ts"
import { useAppI18n } from "@/i18n"
import { createOrganization, updateOrganization, uploadOrganizationAvatar } from "@/lib/organizations-client"

interface OrganizationFormsOptions {
  busyAction: BusyAction | null
  canManageOrganization: (organization: Organization) => boolean
  organizations: Organization[]
  refreshWorkspace: (options?: { forceRefresh?: boolean }) => Promise<unknown>
  selectOrganization: (organizationId: string) => void
  setBusyAction: React.Dispatch<React.SetStateAction<BusyAction | null>>
  upsertOrganization: (organization: Organization, options?: { avatarFile?: File | null }) => void
}

function useNameError(name: string, duplicated: boolean) {
  const { t } = useAppI18n()
  return React.useMemo(() => {
    if (!name) return null
    switch (organizationNameValidation(name.trim())) {
      case "empty":
        return t("organizations.organizationNameRequired")
      case "invalid":
        return t("organizations.organizationNameInvalid")
      case "too-long":
        return t("organizations.organizationNameTooLong", { max: maxOrganizationNameLength })
      case "valid":
        return duplicated ? t("organizations.organizationNameDuplicated") : null
    }
  }, [duplicated, name, t])
}

export function useOrganizationForms({
  busyAction,
  canManageOrganization,
  organizations,
  refreshWorkspace,
  selectOrganization,
  setBusyAction,
  upsertOrganization,
}: OrganizationFormsOptions) {
  const { t } = useAppI18n()
  const [createOpen, setCreateOpen] = React.useState(false)
  const [createName, setCreateName] = React.useState("")
  const [createAvatarFile, setCreateAvatarFile] = React.useState<File | null>(null)
  const [createDuplicated, setCreateDuplicated] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)
  const [editOrganizationId, setEditOrganizationId] = React.useState<string | null>(null)
  const [editName, setEditName] = React.useState("")
  const [editAvatar, setEditAvatar] = React.useState("")
  const [editAvatarFile, setEditAvatarFile] = React.useState<File | null>(null)
  const [editDuplicated, setEditDuplicated] = React.useState(false)
  const editAvatarUploadVersion = React.useRef(0)
  const editingOrganization = React.useMemo(
    () => (editOrganizationId ? (organizations.find((item) => item.id === editOrganizationId) ?? null) : null),
    [editOrganizationId, organizations],
  )
  const createNameError = useNameError(createName, createDuplicated)
  const editNameError = useNameError(editName, editDuplicated)

  const submitCreate = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      const orgName = createName.trim()
      const validation = organizationNameValidation(orgName)
      if (validation !== "valid") {
        toast.error(
          validation === "empty"
            ? t("organizations.organizationNameRequired")
            : validation === "invalid"
              ? t("organizations.organizationNameInvalid")
              : t("organizations.organizationNameTooLong", { max: maxOrganizationNameLength }),
        )
        return
      }

      setBusyAction("create")
      try {
        let organization = await createOrganization({ orgName })
        if (createAvatarFile) {
          const { avatar } = await uploadOrganizationAvatar(organization.id, createAvatarFile)
          organization = await updateOrganization({ avatar, orgId: organization.id, orgName: organization.name })
          upsertOrganization(organization, { avatarFile: createAvatarFile })
        } else {
          upsertOrganization(organization)
        }
        toast.success(t("organizations.createOrganizationSuccess"))
        setCreateOpen(false)
        setCreateName("")
        setCreateAvatarFile(null)
        setCreateDuplicated(false)
        selectOrganization(organization.id)
        await refreshWorkspace({ forceRefresh: true })
      } catch (error) {
        if (isConflictError(error)) {
          setCreateDuplicated(true)
          toast.error(t("organizations.organizationNameDuplicated"))
        } else {
          toast.error(organizationErrorMessage(error, t))
        }
      } finally {
        setBusyAction(null)
      }
    },
    [createAvatarFile, createName, refreshWorkspace, selectOrganization, setBusyAction, t, upsertOrganization],
  )

  const openEdit = React.useCallback((organization: Organization) => {
    setEditOrganizationId(organization.id)
    setEditName(organization.name)
    setEditAvatar(organization.avatar)
    setEditAvatarFile(null)
    setEditDuplicated(false)
    setEditOpen(true)
  }, [])

  const closeEdit = React.useCallback(() => {
    if (busyAction === "updateOrganization" || busyAction === "uploadOrganizationAvatar") return
    setEditOpen(false)
    setEditOrganizationId(null)
    setEditName("")
    setEditAvatar("")
    setEditAvatarFile(null)
    setEditDuplicated(false)
  }, [busyAction])

  const changeEditAvatarFile = React.useCallback(
    (file: File | null) => {
      editAvatarUploadVersion.current += 1
      setEditAvatarFile(file)
      if (!file) return
      if (!editingOrganization || !canManageOrganization(editingOrganization)) {
        setEditAvatarFile(null)
        return
      }

      const version = editAvatarUploadVersion.current
      setBusyAction("uploadOrganizationAvatar")
      void uploadOrganizationAvatar(editingOrganization.id, file)
        .then((uploaded) => {
          if (editAvatarUploadVersion.current === version) setEditAvatar(uploaded.avatar)
        })
        .catch((error) => {
          if (editAvatarUploadVersion.current !== version) return
          setEditAvatarFile(null)
          toast.error(organizationErrorMessage(error, t))
        })
        .finally(() => {
          if (editAvatarUploadVersion.current === version) {
            setBusyAction((current) => (current === "uploadOrganizationAvatar" ? null : current))
          }
        })
    },
    [canManageOrganization, editingOrganization, setBusyAction, t],
  )

  const submitEdit = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      if (!editingOrganization || !canManageOrganization(editingOrganization)) return
      const orgName = editName.trim()
      const validation = organizationNameValidation(orgName)
      if (validation !== "valid") {
        toast.error(
          validation === "empty"
            ? t("organizations.organizationNameRequired")
            : validation === "invalid"
              ? t("organizations.organizationNameInvalid")
              : t("organizations.organizationNameTooLong", { max: maxOrganizationNameLength }),
        )
        return
      }

      setBusyAction("updateOrganization")
      try {
        const avatar = editAvatar.trim()
        const organization = await updateOrganization({ avatar, orgId: editingOrganization.id, orgName })
        upsertOrganization(
          organization,
          editAvatarFile || avatar !== editingOrganization.avatar ? { avatarFile: editAvatarFile } : undefined,
        )
        toast.success(t("organizations.updateOrganizationSuccess"))
        setEditOpen(false)
        setEditOrganizationId(null)
        setEditName("")
        setEditAvatar("")
        setEditAvatarFile(null)
        setEditDuplicated(false)
        selectOrganization(organization.id)
        await refreshWorkspace({ forceRefresh: true })
      } catch (error) {
        if (isConflictError(error)) {
          setEditDuplicated(true)
          toast.error(t("organizations.organizationNameDuplicated"))
        } else {
          toast.error(organizationErrorMessage(error, t))
        }
      } finally {
        setBusyAction(null)
      }
    },
    [
      canManageOrganization,
      editAvatar,
      editAvatarFile,
      editName,
      editingOrganization,
      refreshWorkspace,
      selectOrganization,
      setBusyAction,
      t,
      upsertOrganization,
    ],
  )

  return {
    create: {
      avatarFile: createAvatarFile,
      close: () => {
        if (busyAction !== "create") {
          setCreateOpen(false)
          setCreateAvatarFile(null)
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
      organization: editingOrganization,
      setAvatar: setEditAvatar,
      setName: (value: string) => {
        setEditName(value)
        setEditDuplicated(false)
      },
      submit: submitEdit,
    },
  }
}
