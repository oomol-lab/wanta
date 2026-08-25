import type { Team } from "../../../electron/teams/common.ts"
import type { MemberSearchState } from "./team-management-model.ts"

import { CheckIcon, LoaderCircleIcon, PencilIcon, PlusIcon, SearchIcon, UploadIcon, XIcon } from "lucide-react"
import * as React from "react"
import { maxTeamNameLength, minimumMemberSearchLength, teamNameValidation } from "./team-management-model.ts"
import { TeamUserAvatar } from "./TeamUserAvatar.tsx"
import { CachedAvatarImage } from "@/components/CachedAvatarImage"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { teamAvatarStyle, teamInitials } from "@/hooks/useTeamWorkspace"
import { useAppI18n } from "@/i18n"
import { cn } from "@/lib/utils"

export function CreateTeamDialog({
  avatarFile,
  busy,
  name,
  nameError,
  onAvatarFileChange,
  onClose,
  onNameChange,
  onSubmit,
  open,
}: {
  avatarFile: File | null
  busy: boolean
  name: string
  nameError: string | null
  onAvatarFileChange: (file: File | null) => void
  onClose: () => void
  onNameChange: (value: string) => void
  onSubmit: (event: React.FormEvent) => void
  open: boolean
}) {
  const { t } = useAppI18n()
  const disabled = teamNameValidation(name.trim()) !== "valid" || Boolean(nameError) || busy
  const avatarPreviewUrl = useObjectUrl(avatarFile)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("teams.createTeam")}
      description={t("teams.createTeamDescription")}
      footer={
        <>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="create-team-form" disabled={disabled}>
            {busy ? t("teams.creatingTeam") : t("teams.create")}
          </Button>
        </>
      }
    >
      <form id="create-team-form" className="grid gap-4" onSubmit={onSubmit}>
        <TeamAvatarField
          file={avatarFile}
          name={name}
          previewUrl={avatarPreviewUrl}
          seed={name}
          title={t("teams.teamAvatar")}
          onFileChange={onAvatarFileChange}
        />
        <div className="grid gap-2">
          <Label htmlFor="team-name">{t("teams.teamName")}</Label>
          <Input
            id="team-name"
            value={name}
            maxLength={maxTeamNameLength}
            aria-invalid={Boolean(nameError)}
            autoFocus
            onChange={(event) => onNameChange(event.currentTarget.value)}
          />
          {nameError ? (
            <p className="oo-text-caption-compact text-destructive">{nameError}</p>
          ) : (
            <p className="oo-text-caption-compact text-muted-foreground">{t("teams.teamNameDescription")}</p>
          )}
        </div>
      </form>
    </Dialog>
  )
}

export function TeamProfileSettingsPanel({
  avatar,
  avatarFile,
  busy,
  editing,
  name,
  nameError,
  onAvatarChange,
  onAvatarFileChange,
  onClose,
  onEdit,
  onNameChange,
  onSubmit,
  team,
}: {
  avatar: string
  avatarFile: File | null
  busy: boolean
  editing: boolean
  name: string
  nameError: string | null
  onAvatarChange: (value: string) => void
  onAvatarFileChange: (file: File | null) => void
  onClose: () => void
  onEdit: () => void
  onNameChange: (value: string) => void
  onSubmit: (event: React.FormEvent) => void
  team: Team
}) {
  const { t } = useAppI18n()
  const disabled = teamNameValidation(name.trim()) !== "valid" || Boolean(nameError) || busy
  const avatarPreviewUrl = useObjectUrl(avatarFile)

  if (!editing) {
    return (
      <section className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-[var(--oo-divider)] bg-background p-3">
        <div className="flex min-w-0 items-center gap-3">
          <TeamProfileLogo team={team} />
          <div className="min-w-0">
            <h2 className="oo-text-title truncate text-foreground">{t("teams.teamProfile")}</h2>
            <p className="oo-text-caption mt-0.5 truncate text-muted-foreground">{team.name}</p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={onEdit}>
          <PencilIcon className="size-3.5" />
          {t("teams.editTeam")}
        </Button>
      </section>
    )
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">
      <div className="border-b border-[var(--oo-divider)] px-3 py-2.5">
        <h2 className="oo-text-title text-foreground">{t("teams.teamProfile")}</h2>
        <p className="oo-text-caption mt-0.5 text-muted-foreground">{t("teams.editTeamDescription")}</p>
      </div>
      <form onSubmit={onSubmit}>
        <div className="grid gap-4 p-3">
          <TeamAvatarField
            avatar={avatar}
            file={avatarFile}
            name={name || team.name}
            previewUrl={avatarPreviewUrl}
            seed={team.id || team.name || name}
            title={t("teams.teamAvatar")}
            uploading={busy}
            onAvatarClear={() => {
              onAvatarChange("")
              onAvatarFileChange(null)
            }}
            onFileChange={onAvatarFileChange}
          />
          <div className="grid gap-2">
            <Label htmlFor="edit-team-name">{t("teams.teamName")}</Label>
            <Input
              id="edit-team-name"
              value={name}
              maxLength={maxTeamNameLength}
              aria-invalid={Boolean(nameError)}
              autoFocus
              onChange={(event) => onNameChange(event.currentTarget.value)}
            />
            {nameError ? (
              <p className="oo-text-caption-compact text-destructive">{nameError}</p>
            ) : (
              <p className="oo-text-caption-compact text-muted-foreground">{t("teams.teamNameDescription")}</p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--oo-divider)] px-3 py-2.5">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={disabled}>
            {busy ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : null}
            {busy ? t("teams.savingTeam") : t("common.save")}
          </Button>
        </div>
      </form>
    </section>
  )
}

function TeamProfileLogo({ team }: { team: Team }) {
  const avatar = team.avatar.trim()
  const [loadedAvatar, setLoadedAvatar] = React.useState<string | null>(null)
  const showImage = Boolean(avatar && loadedAvatar === avatar)

  return (
    <span
      className={cn(
        "relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md text-sm font-medium",
        showImage ? "bg-transparent text-transparent" : "border border-[var(--oo-frame-border)] text-foreground",
      )}
      style={showImage ? undefined : teamAvatarStyle(team.id || team.name)}
      aria-hidden="true"
    >
      {showImage ? null : <span>{teamInitials(team.name)}</span>}
      {avatar ? (
        <CachedAvatarImage
          src={avatar}
          alt=""
          className="absolute inset-0 size-full object-contain"
          onLoad={() => setLoadedAvatar(avatar)}
          onError={() => setLoadedAvatar((current) => (current === avatar ? null : current))}
        />
      ) : null}
    </span>
  )
}

function useObjectUrl(file: File | null): string {
  const [url, setUrl] = React.useState("")

  React.useEffect(() => {
    if (!file) {
      setUrl("")
      return
    }
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])

  return url
}

function TeamAvatarField({
  avatar = "",
  file,
  name,
  onAvatarClear,
  onFileChange,
  previewUrl,
  seed,
  title,
  uploading = false,
}: {
  avatar?: string
  file: File | null
  name: string
  onAvatarClear?: () => void
  onFileChange: (file: File | null) => void
  previewUrl: string
  seed: string
  title: string
  uploading?: boolean
}) {
  const { t } = useAppI18n()
  const inputId = React.useId()
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const remoteAvatar = previewUrl ? "" : avatar.trim()
  const [loadedRemoteAvatar, setLoadedRemoteAvatar] = React.useState<string | null>(null)
  const imageVisible = Boolean(previewUrl || (remoteAvatar && loadedRemoteAvatar === remoteAvatar))
  const canClear = Boolean(file || avatar)
  const fallbackStyle = imageVisible ? undefined : teamAvatarStyle(seed || name || "team")

  return (
    <div className="grid gap-2">
      <Label htmlFor={inputId}>{title}</Label>
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            "relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md text-lg font-medium",
            imageVisible ? "bg-transparent text-transparent" : "border border-[var(--oo-frame-border)] text-foreground",
          )}
          style={fallbackStyle}
        >
          {imageVisible ? null : <span aria-hidden="true">{teamInitials(name || "Team")}</span>}
          {previewUrl ? <img src={previewUrl} alt="" className="absolute inset-0 size-full object-contain" /> : null}
          {remoteAvatar ? (
            <CachedAvatarImage
              src={remoteAvatar}
              alt=""
              className="absolute inset-0 size-full object-contain"
              onLoad={() => setLoadedRemoteAvatar(remoteAvatar)}
              onError={() => setLoadedRemoteAvatar((current) => (current === remoteAvatar ? null : current))}
            />
          ) : null}
        </span>
        <div className="grid min-w-0 flex-1 gap-2">
          <div className="flex min-w-0 flex-wrap gap-2">
            <input
              ref={fileInputRef}
              id={inputId}
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={uploading}
              onChange={(event) => {
                onFileChange(event.currentTarget.files?.[0] ?? null)
                event.currentTarget.value = ""
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => {
                if (fileInputRef.current) {
                  fileInputRef.current.value = ""
                  fileInputRef.current.click()
                }
              }}
            >
              {uploading ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : <UploadIcon className="size-3.5" />}
              {uploading
                ? t("teams.uploadingTeamAvatar")
                : file || avatar
                  ? t("teams.changeTeamAvatar")
                  : t("teams.uploadTeamAvatar")}
            </Button>
            {canClear ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={uploading}
                onClick={() => {
                  onFileChange(null)
                  onAvatarClear?.()
                  if (fileInputRef.current) {
                    fileInputRef.current.value = ""
                  }
                }}
              >
                <XIcon className="size-3.5" />
                {t("teams.removeTeamAvatar")}
              </Button>
            ) : null}
          </div>
          <p className="oo-text-caption-compact truncate text-muted-foreground">
            {file ? file.name : t("teams.teamAvatarUploadHint")}
          </p>
        </div>
      </div>
    </div>
  )
}

export function AddMemberDialog({
  activeUserId,
  addError,
  busy,
  input,
  selectedUserId,
  onClose,
  onInputChange,
  onMoveActiveUser,
  onSearchSelect,
  onSubmit,
  open,
  search,
}: {
  activeUserId: string | null
  addError: string | null
  busy: boolean
  input: string
  selectedUserId: string | null
  onClose: () => void
  onInputChange: (value: string) => void
  onMoveActiveUser: (step: -1 | 1 | "first" | "last") => void
  onSearchSelect: (user: MemberSearchState["items"][number]) => void
  onSubmit: (event: React.FormEvent) => void
  open: boolean
  search: MemberSearchState
}) {
  const { t } = useAppI18n()
  const hasSearchResults = search.items.length > 0
  const canSubmit =
    input.trim().length > 0 && !busy && !search.loading && (!hasSearchResults || Boolean(selectedUserId))

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
      case "ArrowDown":
        if (hasSearchResults) {
          event.preventDefault()
          onMoveActiveUser(1)
        }
        return
      case "ArrowUp":
        if (hasSearchResults) {
          event.preventDefault()
          onMoveActiveUser(-1)
        }
        return
      case "Escape":
        event.preventDefault()
        onClose()
        return
      case "Enter": {
        const activeUser = search.items.find((user) => user.userId === activeUserId)
        if (activeUser && selectedUserId !== activeUser.userId) {
          event.preventDefault()
          onSearchSelect(activeUser)
        }
        return
      }
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("teams.addMember")}
      description={t("teams.addMemberDescription")}
      footer={
        <>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="add-team-member-form" disabled={!canSubmit}>
            <PlusIcon className="size-4" />
            {busy ? t("teams.addingMember") : t("teams.addMember")}
          </Button>
        </>
      }
    >
      <form id="add-team-member-form" className="grid gap-4" autoComplete="off" onSubmit={onSubmit}>
        <div className="grid gap-2">
          <Label htmlFor="team-member-search">{t("teams.memberIdentifier")}</Label>
          <InputGroup>
            <InputGroupAddon align="inline-start">
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              id="team-member-search"
              type="search"
              value={input}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              data-1p-ignore="true"
              data-form-type="other"
              data-lpignore="true"
              disabled={busy}
              aria-activedescendant={activeUserId ? `team-member-option-${activeUserId}` : undefined}
              aria-controls="team-member-search-results"
              aria-expanded={hasSearchResults}
              aria-autocomplete="list"
              role="combobox"
              placeholder={t("teams.userSearchPlaceholder")}
              spellCheck={false}
              onChange={(event) => onInputChange(event.currentTarget.value)}
              onKeyDown={handleInputKeyDown}
            />
          </InputGroup>
          <MemberSearchResults
            activeUserId={activeUserId}
            busy={busy}
            error={addError}
            search={search}
            selectedUserId={selectedUserId}
            onSelect={onSearchSelect}
          />
        </div>
      </form>
    </Dialog>
  )
}

function MemberSearchResults({
  activeUserId,
  busy,
  error,
  onSelect,
  search,
  selectedUserId,
}: {
  activeUserId: string | null
  busy: boolean
  error: string | null
  onSelect: (user: MemberSearchState["items"][number]) => void
  search: MemberSearchState
  selectedUserId: string | null
}) {
  const { t } = useAppI18n()
  const itemRefs = React.useRef(new Map<string, HTMLButtonElement>())
  const showInitial = search.query.length < minimumMemberSearchLength
  const showEmpty =
    search.query.length >= minimumMemberSearchLength && !search.loading && !search.error && search.items.length === 0

  React.useEffect(() => {
    if (!activeUserId) {
      return
    }
    itemRefs.current.get(activeUserId)?.scrollIntoView({ block: "nearest" })
  }, [activeUserId])

  return (
    <div id="team-member-search-results" className="min-h-28 overflow-hidden rounded-md border" role="listbox">
      {search.items.length > 0 ? (
        <div className="max-h-64 overflow-y-auto p-1">
          {search.items.map((user) => {
            const active = user.userId === activeUserId
            const selected = user.userId === selectedUserId
            return (
              <button
                tabIndex={-1}
                ref={(element) => {
                  if (element) {
                    itemRefs.current.set(user.userId, element)
                  } else {
                    itemRefs.current.delete(user.userId)
                  }
                }}
                type="button"
                id={`team-member-option-${user.userId}`}
                key={user.userId}
                className={cn(
                  "relative flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent/70 hover:text-accent-foreground",
                  active && "bg-accent text-accent-foreground",
                )}
                disabled={busy}
                aria-selected={selected}
                role="option"
                onClick={() => onSelect(user)}
              >
                {active ? <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" /> : null}
                <TeamUserAvatar avatar={user.avatar} fallback={user.fallback} />
                <span className="min-w-0 flex-1">
                  <span className="oo-text-label block truncate">{user.displayName}</span>
                  <span
                    className={cn(
                      "oo-text-caption-compact block truncate font-mono",
                      active ? "text-accent-foreground/80" : "text-muted-foreground",
                    )}
                  >
                    {user.username}
                  </span>
                </span>
                {selected ? <CheckIcon className="size-4 shrink-0" /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
      {search.loading ? <DialogHint>{t("teams.loading")}</DialogHint> : null}
      {showInitial ? <DialogHint>{t("teams.searchUsersInitial")}</DialogHint> : null}
      {showEmpty ? <DialogHint>{t("teams.noUsersFoundCanAddId")}</DialogHint> : null}
      {search.error ? <DialogHint danger>{search.error}</DialogHint> : null}
      {error ? <DialogHint danger>{error}</DialogHint> : null}
    </div>
  )
}

function DialogHint({ children, danger = false }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <div className={cn("oo-text-body px-2 py-6 text-center text-muted-foreground", danger && "text-destructive")}>
      {children}
    </div>
  )
}
