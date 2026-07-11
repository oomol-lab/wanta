import type { Organization, OrganizationProviderOption } from "../../../electron/organizations/common.ts"
import type { MemberSearchState, MemberView, ProviderAccessForm } from "./organization-management-model.ts"

import { CheckIcon, LoaderCircleIcon, PlusIcon, SearchIcon, UploadIcon, XIcon } from "lucide-react"
import * as React from "react"
import {
  filterOrganizationProviderOptions,
  maxOrganizationNameLength,
  minimumMemberSearchLength,
  organizationNameValidation,
  userFallback,
} from "./organization-management-model.ts"
import { CachedAvatarImage } from "@/components/CachedAvatarImage"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { organizationAvatarStyle, organizationInitials } from "@/hooks/useOrganizationWorkspace"
import { useAppI18n } from "@/i18n"
import { cn } from "@/lib/utils"

export function CreateOrganizationDialog({
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
  const disabled = organizationNameValidation(name.trim()) !== "valid" || Boolean(nameError) || busy
  const avatarPreviewUrl = useObjectUrl(avatarFile)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("organizations.createOrganization")}
      description={t("organizations.createOrganizationDescription")}
      footer={
        <>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="create-organization-form" disabled={disabled}>
            {busy ? t("organizations.creatingOrganization") : t("organizations.create")}
          </Button>
        </>
      }
    >
      <form id="create-organization-form" className="grid gap-4" onSubmit={onSubmit}>
        <OrganizationAvatarField
          file={avatarFile}
          name={name}
          previewUrl={avatarPreviewUrl}
          seed={name}
          title={t("organizations.organizationAvatar")}
          onFileChange={onAvatarFileChange}
        />
        <div className="grid gap-2">
          <Label htmlFor="organization-name">{t("organizations.organizationName")}</Label>
          <Input
            id="organization-name"
            value={name}
            maxLength={maxOrganizationNameLength}
            aria-invalid={Boolean(nameError)}
            autoFocus
            onChange={(event) => onNameChange(event.currentTarget.value)}
          />
          {nameError ? (
            <p className="oo-text-caption-compact text-destructive">{nameError}</p>
          ) : (
            <p className="oo-text-caption-compact text-muted-foreground">
              {t("organizations.organizationNameDescription")}
            </p>
          )}
        </div>
      </form>
    </Dialog>
  )
}

export function EditOrganizationDialog({
  avatar,
  avatarFile,
  avatarUploading,
  busy,
  name,
  nameError,
  onAvatarChange,
  onAvatarFileChange,
  onClose,
  onNameChange,
  onSubmit,
  open,
  organization,
}: {
  avatar: string
  avatarFile: File | null
  avatarUploading: boolean
  busy: boolean
  name: string
  nameError: string | null
  onAvatarChange: (value: string) => void
  onAvatarFileChange: (file: File | null) => void
  onClose: () => void
  onNameChange: (value: string) => void
  onSubmit: (event: React.FormEvent) => void
  open: boolean
  organization: Organization | null
}) {
  const { t } = useAppI18n()
  const disabled = organizationNameValidation(name.trim()) !== "valid" || Boolean(nameError) || busy || avatarUploading
  const avatarPreviewUrl = useObjectUrl(avatarFile)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("organizations.editOrganization")}
      description={t("organizations.editOrganizationDescription")}
      footer={
        <>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="edit-organization-form" disabled={disabled}>
            {busy ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : null}
            {busy ? t("organizations.savingOrganization") : t("common.save")}
          </Button>
        </>
      }
    >
      <form id="edit-organization-form" className="grid gap-4" onSubmit={onSubmit}>
        <OrganizationAvatarField
          avatar={avatar}
          file={avatarFile}
          name={name || organization?.name || ""}
          previewUrl={avatarPreviewUrl}
          seed={organization?.id || organization?.name || name}
          title={t("organizations.organizationAvatar")}
          uploading={avatarUploading}
          onAvatarClear={() => {
            onAvatarChange("")
            onAvatarFileChange(null)
          }}
          onFileChange={onAvatarFileChange}
        />
        <div className="grid gap-2">
          <Label htmlFor="edit-organization-name">{t("organizations.organizationName")}</Label>
          <Input
            id="edit-organization-name"
            value={name}
            maxLength={maxOrganizationNameLength}
            aria-invalid={Boolean(nameError)}
            autoFocus
            onChange={(event) => onNameChange(event.currentTarget.value)}
          />
          {nameError ? (
            <p className="oo-text-caption-compact text-destructive">{nameError}</p>
          ) : (
            <p className="oo-text-caption-compact text-muted-foreground">
              {t("organizations.organizationNameDescription")}
            </p>
          )}
        </div>
      </form>
    </Dialog>
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

function OrganizationAvatarField({
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
  const fallbackStyle = imageVisible ? undefined : organizationAvatarStyle(seed || name || "organization")

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
          {imageVisible ? null : <span aria-hidden="true">{organizationInitials(name || "Organization")}</span>}
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
                ? t("organizations.uploadingOrganizationAvatar")
                : file || avatar
                  ? t("organizations.changeOrganizationAvatar")
                  : t("organizations.uploadOrganizationAvatar")}
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
                {t("organizations.removeOrganizationAvatar")}
              </Button>
            ) : null}
          </div>
          <p className="oo-text-caption-compact truncate text-muted-foreground">
            {file ? file.name : t("organizations.organizationAvatarUploadHint")}
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
  const currentUserId = selectedUserId ?? activeUserId
  const canSubmit = input.trim().length > 0 && !busy && !search.loading && (!hasSearchResults || Boolean(currentUserId))

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
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("organizations.addMember")}
      description={t("organizations.addMemberDescription")}
      footer={
        <>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="add-organization-member-form" disabled={!canSubmit}>
            <PlusIcon className="size-4" />
            {busy ? t("organizations.addingMember") : t("organizations.addMember")}
          </Button>
        </>
      }
    >
      <form id="add-organization-member-form" className="grid gap-4" autoComplete="off" onSubmit={onSubmit}>
        <div className="grid gap-2">
          <Label htmlFor="organization-member-search">{t("organizations.memberIdentifier")}</Label>
          <InputGroup>
            <InputGroupAddon align="inline-start">
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              id="organization-member-search"
              type="search"
              value={input}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              data-1p-ignore="true"
              data-form-type="other"
              data-lpignore="true"
              disabled={busy}
              aria-activedescendant={currentUserId ? `organization-member-option-${currentUserId}` : undefined}
              aria-controls="organization-member-search-results"
              aria-expanded={hasSearchResults}
              aria-autocomplete="list"
              role="combobox"
              placeholder={t("organizations.userSearchPlaceholder")}
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
    <div id="organization-member-search-results" className="min-h-28 overflow-hidden rounded-md border" role="listbox">
      {search.items.length > 0 ? (
        <div className="max-h-64 overflow-y-auto p-1">
          {search.items.map((user) => {
            const current = user.userId === (selectedUserId ?? activeUserId)
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
                id={`organization-member-option-${user.userId}`}
                key={user.userId}
                className={cn(
                  "relative flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent/70 hover:text-accent-foreground",
                  current && "bg-accent text-accent-foreground",
                )}
                disabled={busy}
                aria-selected={current}
                role="option"
                onClick={() => onSelect(user)}
              >
                {current ? <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" /> : null}
                <UserAvatar avatar={user.avatar} fallback={user.fallback} />
                <span className="min-w-0 flex-1">
                  <span className="oo-text-label block truncate">{user.displayName}</span>
                  <span
                    className={cn(
                      "oo-text-caption-compact block truncate font-mono",
                      current ? "text-accent-foreground/80" : "text-muted-foreground",
                    )}
                  >
                    {user.username}
                  </span>
                </span>
                {current ? <CheckIcon className="size-4 shrink-0" /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
      {search.loading ? <DialogHint>{t("organizations.loading")}</DialogHint> : null}
      {showInitial ? <DialogHint>{t("organizations.searchUsersInitial")}</DialogHint> : null}
      {showEmpty ? <DialogHint>{t("organizations.noUsersFoundCanAddId")}</DialogHint> : null}
      {search.error ? <DialogHint danger>{search.error}</DialogHint> : null}
      {error ? <DialogHint danger>{error}</DialogHint> : null}
    </div>
  )
}

export function ProviderAccessDialog({
  busy,
  form,
  memberOptions,
  onClose,
  onFormChange,
  onSubmit,
  providerOptions,
}: {
  busy: boolean
  form: ProviderAccessForm
  memberOptions: MemberView[]
  onClose: () => void
  onFormChange: React.Dispatch<React.SetStateAction<ProviderAccessForm>>
  onSubmit: (event: React.FormEvent) => void
  providerOptions: OrganizationProviderOption[]
}) {
  const { t } = useAppI18n()

  return (
    <Dialog
      open={form.open}
      onClose={onClose}
      title={form.mode === "create" ? t("organizations.grantProviderAccess") : t("organizations.editProviderAccess")}
      description={t("organizations.providerAccessDescription")}
      footer={
        <>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="provider-access-form" disabled={busy}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form id="provider-access-form" className="grid gap-4" onSubmit={onSubmit}>
        <div className="grid gap-2">
          <Label htmlFor="provider-access-member">{t("organizations.member")}</Label>
          {form.mode === "create" && !form.userId ? (
            <Select
              value={form.userId}
              onValueChange={(value) => onFormChange((current) => ({ ...current, userId: value ?? "" }))}
            >
              <SelectTrigger id="provider-access-member" className="w-full">
                <SelectValue placeholder={t("organizations.memberRequired")} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {memberOptions.map((member) => (
                    <SelectItem key={member.user_id} value={member.user_id}>
                      {member.displayName}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : (
            <MemberDisplay userId={form.userId} members={memberOptions} />
          )}
        </div>
        <div className="grid gap-2">
          <Label>{t("organizations.connectionScope")}</Label>
          <ProviderSelect
            allProviders={form.allProviders}
            allProvidersLabel={t("organizations.allProviders")}
            emptyLabel={t("organizations.emptyProviders")}
            options={providerOptions}
            selectLabel={t("organizations.selectProviders")}
            selectedProviders={form.providers}
            onAllProvidersChange={(allProviders) =>
              onFormChange((current) => ({
                ...current,
                allProviders,
                providers: allProviders ? [] : current.providers,
              }))
            }
            onToggleProvider={(service) =>
              onFormChange((current) => ({
                ...current,
                allProviders: false,
                providers: current.providers.includes(service)
                  ? current.providers.filter((item) => item !== service)
                  : [...current.providers, service].sort(),
              }))
            }
          />
        </div>
      </form>
    </Dialog>
  )
}

function ProviderSelect({
  allProviders,
  allProvidersLabel,
  emptyLabel,
  onAllProvidersChange,
  onToggleProvider,
  options,
  selectLabel,
  selectedProviders,
}: {
  allProviders: boolean
  allProvidersLabel: string
  emptyLabel: string
  onAllProvidersChange: (value: boolean) => void
  onToggleProvider: (service: string) => void
  options: OrganizationProviderOption[]
  selectLabel: string
  selectedProviders: string[]
}) {
  const { t } = useAppI18n()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const labelsByService = React.useMemo(
    () => new Map(options.map((option) => [option.service, option.label])),
    [options],
  )
  const filteredOptions = React.useMemo(() => filterOrganizationProviderOptions(options, query), [options, query])
  const label = allProviders
    ? allProvidersLabel
    : selectedProviders.map((service) => labelsByService.get(service) ?? service).join(", ")

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) {
          setQuery("")
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-between">
          <span className="min-w-0 truncate text-left">{label || selectLabel}</span>
          {allProviders ? null : <span className="shrink-0 text-muted-foreground">{selectedProviders.length}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[min(26rem,calc(100vw-2rem))] p-1">
        <button
          type="button"
          className="oo-text-body flex w-full min-w-0 items-center justify-between gap-2 rounded-md px-2 py-2 text-left hover:bg-accent hover:text-accent-foreground"
          onClick={() => {
            onAllProvidersChange(true)
            setOpen(false)
          }}
        >
          <span className="truncate">{allProvidersLabel}</span>
          {allProviders ? <CheckIcon className="size-4" /> : null}
        </button>
        <div className="my-1 h-px bg-border" />
        {options.length > 0 ? (
          <InputGroup className="mb-1">
            <InputGroupAddon>
              <SearchIcon className="size-4" />
            </InputGroupAddon>
            <InputGroupInput
              value={query}
              aria-label={t("organizations.searchProviders")}
              placeholder={t("organizations.searchProviders")}
              autoFocus
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </InputGroup>
        ) : null}
        {options.length === 0 ? (
          <div className="oo-text-body px-2 py-6 text-center text-muted-foreground">{emptyLabel}</div>
        ) : filteredOptions.length === 0 ? (
          <div className="oo-text-body px-2 py-6 text-center text-muted-foreground">
            {t("organizations.noProviderMatches")}
          </div>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            {filteredOptions.map((provider) => {
              const selected = !allProviders && selectedProviders.includes(provider.service)
              return (
                <button
                  type="button"
                  key={provider.service}
                  className="oo-list-render-boundary flex w-full min-w-0 items-center justify-between gap-2 rounded-md px-2 py-2 text-left hover:bg-accent hover:text-accent-foreground"
                  onClick={() => {
                    onToggleProvider(provider.service)
                    setOpen(false)
                  }}
                >
                  <span className="min-w-0">
                    <span className="oo-text-body block truncate">{provider.label}</span>
                    <span className="oo-text-caption-compact block truncate font-mono text-muted-foreground">
                      {provider.service}
                    </span>
                  </span>
                  {selected ? <CheckIcon className="size-4 shrink-0" /> : null}
                </button>
              )
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function UserAvatar({ avatar, fallback }: { avatar: string; fallback: string }) {
  return (
    <span className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-medium text-foreground">
      <span aria-hidden="true">{fallback}</span>
      <CachedAvatarImage src={avatar} alt="" className="absolute inset-0 size-full object-cover" />
    </span>
  )
}

function MemberDisplay({ members, userId }: { members: MemberView[]; userId: string }) {
  const member = members.find((item) => item.user_id === userId)
  const label = member?.displayName ?? userId
  const secondary = member?.secondaryLabel ?? userId
  return (
    <div className="flex min-h-9 min-w-0 items-center gap-3 rounded-md border bg-muted/40 px-3 py-2">
      <UserAvatar avatar={member?.avatar ?? ""} fallback={member?.fallback ?? userFallback(label)} />
      <span className="min-w-0">
        <span className="oo-text-label block truncate">{label}</span>
        <span className="oo-text-caption-compact block truncate font-mono text-muted-foreground">{secondary}</span>
      </span>
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
