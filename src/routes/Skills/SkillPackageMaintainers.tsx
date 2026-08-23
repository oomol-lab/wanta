import type { AuthAccountSummary } from "../../../electron/auth/common.ts"
import type { TeamUserSearchResult } from "../../../electron/teams/common.ts"

import * as React from "react"
import { toast } from "sonner"
import { SkillErrorNotice } from "./SkillErrorNotice.tsx"
import { AppIcons } from "@/components/AppIcons"
import { CachedAvatarImage } from "@/components/CachedAvatarImage"
import { InspectorInsetCard } from "@/components/InspectorPanel"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Skeleton } from "@/components/ui/skeleton"
import { useAppI18n } from "@/i18n"
import { writeClipboardText } from "@/lib/clipboard"
import {
  getSkillMaintainerInvitationUrl,
  getSkillPackageMaintainerDetail,
  inviteSkillPackageMaintainer,
} from "@/lib/skill-maintainers-client"
import { searchUsers } from "@/lib/teams-client"

const minimumUserSearchLength = 2

interface SkillPackageMaintainersProps {
  account: AuthAccountSummary
  packageName: string
  version: string
}

interface UserSearchState {
  error: string | null
  items: TeamUserSearchResult[]
  loading: boolean
  query: string
}

export function SkillPackageMaintainers({ account, packageName, version }: SkillPackageMaintainersProps) {
  const { t } = useAppI18n()
  const [detail, setDetail] = React.useState<Awaited<ReturnType<typeof getSkillPackageMaintainerDetail>> | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = React.useState(false)
  const requestIdRef = React.useRef(0)

  const loadMaintainers = React.useCallback(() => {
    const controller = new AbortController()
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    setError(null)
    void getSkillPackageMaintainerDetail({ packageName, signal: controller.signal, version })
      .then((nextDetail) => {
        if (requestId === requestIdRef.current) {
          setDetail(nextDetail)
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && requestId === requestIdRef.current) {
          setDetail(null)
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })
      .finally(() => {
        if (requestId === requestIdRef.current) {
          setLoading(false)
        }
      })
    return () => controller.abort()
  }, [packageName, version])

  React.useEffect(() => loadMaintainers(), [loadMaintainers])

  const maintainers = detail?.maintainers ?? []
  const canInvite = maintainers.some((maintainer) => maintainer.id === account.id) && Boolean(account.username)

  return (
    <InspectorInsetCard className="gap-2 px-3 py-2">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="oo-text-caption-compact font-medium">{t("skills.maintainers")}</div>
        {canInvite ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setInviteOpen(true)}>
            <AppIcons.object.account />
            {t("skills.inviteMaintainer")}
          </Button>
        ) : null}
      </div>
      {loading ? (
        <div className="grid gap-2">
          <Skeleton className="h-7 w-full rounded-md" />
          <Skeleton className="h-7 w-4/5 rounded-md" />
        </div>
      ) : error ? (
        <div className="flex min-w-0 items-start gap-2">
          <SkillErrorNotice className="min-w-0 flex-1" error={error} />
          <Button type="button" variant="outline" size="sm" onClick={loadMaintainers}>
            {t("skills.retry")}
          </Button>
        </div>
      ) : maintainers.length ? (
        <div className="grid divide-y rounded-md border">
          {maintainers.map((maintainer) => (
            <MaintainerRow key={maintainer.id} maintainer={maintainer} />
          ))}
        </div>
      ) : (
        <div className="oo-text-caption-compact text-muted-foreground">{t("skills.maintainersUnavailable")}</div>
      )}
      {canInvite ? (
        <InviteSkillMaintainerDialog
          account={account}
          existingMaintainerIds={new Set(maintainers.map((maintainer) => maintainer.id))}
          open={inviteOpen}
          packageName={packageName}
          onClose={() => setInviteOpen(false)}
        />
      ) : null}
    </InspectorInsetCard>
  )
}

function MaintainerRow({ maintainer }: { maintainer: { id: string; name: string; url?: string } }) {
  return (
    <div className="flex min-w-0 items-center gap-2 px-2.5 py-2">
      <MaintainerAvatar name={maintainer.name} url={maintainer.url} />
      <span className="oo-text-caption-compact min-w-0 truncate text-foreground">{maintainer.name}</span>
    </div>
  )
}

function MaintainerAvatar({ name, url }: { name: string; url?: string }) {
  const fallback = name.trim().slice(0, 1).toUpperCase() || "?"
  return (
    <div className="relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-medium text-foreground">
      <span aria-hidden="true">{fallback}</span>
      <CachedAvatarImage src={url} alt="" className="absolute inset-0 size-full object-cover" />
    </div>
  )
}

function InviteSkillMaintainerDialog({
  account,
  existingMaintainerIds,
  open,
  packageName,
  onClose,
}: {
  account: AuthAccountSummary
  existingMaintainerIds: Set<string>
  open: boolean
  packageName: string
  onClose: () => void
}) {
  const { t } = useAppI18n()
  const [query, setQuery] = React.useState("")
  const [selectedUser, setSelectedUser] = React.useState<TeamUserSearchResult | null>(null)
  const [search, setSearch] = React.useState<UserSearchState>({ error: null, items: [], loading: false, query: "" })
  const [submitting, setSubmitting] = React.useState(false)
  const [invitationUrl, setInvitationUrl] = React.useState("")
  const requestIdRef = React.useRef(0)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (open) {
      return
    }
    requestIdRef.current += 1
    setQuery("")
    setSelectedUser(null)
    setSearch({ error: null, items: [], loading: false, query: "" })
    setSubmitting(false)
    setInvitationUrl("")
  }, [open])

  React.useEffect(() => {
    const normalizedQuery = query.trim()
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setSelectedUser(null)
    if (!open || normalizedQuery.length < minimumUserSearchLength) {
      setSearch({ error: null, items: [], loading: false, query: normalizedQuery })
      return
    }

    const controller = new AbortController()
    setSearch({ error: null, items: [], loading: true, query: normalizedQuery })
    const timer = window.setTimeout(() => {
      void searchUsers(normalizedQuery, { signal: controller.signal })
        .then((items) => {
          if (!controller.signal.aborted && requestId === requestIdRef.current) {
            setSearch({ error: null, items, loading: false, query: normalizedQuery })
          }
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted && requestId === requestIdRef.current) {
            setSearch({
              error: cause instanceof Error ? cause.message : String(cause),
              items: [],
              loading: false,
              query: normalizedQuery,
            })
          }
        })
    }, 300)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open, query])

  const users = React.useMemo(
    () => search.items.filter((user) => !existingMaintainerIds.has(user.user_id)),
    [existingMaintainerIds, search.items],
  )
  const showInitial = search.query.length < minimumUserSearchLength
  const showEmpty =
    search.query.length >= minimumUserSearchLength && !search.loading && !search.error && users.length === 0

  const close = React.useCallback(() => {
    if (!submitting) {
      onClose()
    }
  }, [onClose, submitting])

  const copyInvitationUrl = React.useCallback(async () => {
    if (await writeClipboardText(invitationUrl)) {
      toast.success(t("skills.inviteLinkCopied"))
      return
    }
    toast.error(t("skills.inviteLinkCopyFailed"))
  }, [invitationUrl, t])

  const invite = React.useCallback(async () => {
    if (!selectedUser || !account.username || submitting) {
      return
    }
    setSubmitting(true)
    try {
      await inviteSkillPackageMaintainer({ packageName, username: selectedUser.username })
      const nextInvitationUrl = getSkillMaintainerInvitationUrl({ fromUsername: account.username, packageName })
      setInvitationUrl(nextInvitationUrl)
      if (await writeClipboardText(nextInvitationUrl)) {
        toast.success(t("skills.inviteLinkCopied"))
      }
    } catch (cause) {
      toast.error(t("skills.inviteMaintainerFailed", { error: cause instanceof Error ? cause.message : String(cause) }))
    } finally {
      setSubmitting(false)
    }
  }, [account.username, packageName, selectedUser, submitting, t])

  return (
    <Dialog
      open={open}
      title={t("skills.inviteMaintainer")}
      description={t("skills.inviteMaintainerDescription")}
      initialFocus={() => inputRef.current}
      onClose={close}
      footer={
        invitationUrl ? (
          <>
            <Button type="button" variant="outline" onClick={close}>
              {t("common.close")}
            </Button>
            <Button type="button" onClick={() => void copyInvitationUrl()}>
              <AppIcons.action.copy />
              {t("skills.copyInvitationLink")}
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="outline" disabled={submitting} onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button type="button" disabled={!selectedUser || submitting} onClick={() => void invite()}>
              {submitting ? <AppIcons.status.loading className="animate-spin" /> : <AppIcons.object.account />}
              {submitting ? t("skills.sendingInvitation") : t("skills.sendInvitation")}
            </Button>
          </>
        )
      }
    >
      {invitationUrl ? (
        <div className="grid gap-2">
          <div className="oo-text-label">{t("skills.invitationLink")}</div>
          <div className="oo-text-caption rounded-md border bg-muted/30 px-3 py-2.5 font-mono break-all text-foreground">
            {invitationUrl}
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          <label className="grid gap-1.5" htmlFor="skill-maintainer-search">
            <span className="oo-text-label">{t("skills.maintainerSearchLabel")}</span>
            <InputGroup>
              <InputGroupAddon>
                <AppIcons.utility.search />
              </InputGroupAddon>
              <InputGroupInput
                ref={inputRef}
                id="skill-maintainer-search"
                type="search"
                value={query}
                placeholder={t("skills.maintainerSearchPlaceholder")}
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </InputGroup>
          </label>
          <div className="overflow-hidden rounded-md border">
            {search.loading ? <SearchNotice>{t("teams.loading")}</SearchNotice> : null}
            {search.error ? <SearchNotice>{search.error}</SearchNotice> : null}
            {showInitial ? <SearchNotice>{t("skills.maintainerSearchInitial")}</SearchNotice> : null}
            {showEmpty ? <SearchNotice>{t("skills.maintainerSearchEmpty")}</SearchNotice> : null}
            {users.map((user) => {
              const selected = selectedUser?.user_id === user.user_id
              const displayName = user.nickname || user.username
              return (
                <button
                  key={user.user_id}
                  type="button"
                  className="flex w-full min-w-0 items-center gap-2 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted/40"
                  aria-pressed={selected}
                  onClick={() => setSelectedUser(user)}
                >
                  <MaintainerAvatar name={displayName} url={user.avatar} />
                  <span className="min-w-0 flex-1">
                    <span className="oo-text-caption-compact block truncate text-foreground">{displayName}</span>
                    <span className="oo-text-caption block truncate text-muted-foreground">{user.username}</span>
                  </span>
                  {selected ? <AppIcons.action.check className="shrink-0" aria-hidden="true" /> : null}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </Dialog>
  )
}

function SearchNotice({ children }: { children: React.ReactNode }) {
  return <div className="oo-text-caption px-3 py-6 text-center text-muted-foreground">{children}</div>
}
