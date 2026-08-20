import type { ConnectionAppSummary, ConnectionProviderSummary } from "../../../electron/connections/common.ts"
import type { TeamAppAccess } from "../../../electron/teams/common.ts"
import type { MemberView } from "./team-management-model.ts"
import type {
  MemberConnectionAccessDelta,
  MemberConnectionAccessFilter,
  MemberConnectionAccessItem,
  MemberConnectionAccessProjection,
  MemberConnectionProvenance,
} from "./team-member-connection-access-model.ts"

import { AlertTriangle, ArrowUpRight, Pencil, RefreshCw, Search, Shield, ShieldAlert, ShieldCheck } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import {
  filterMemberConnectionAccessItems,
  MemberConnectionAccessError,
  projectMemberConnectionAccess,
} from "./team-member-connection-access-model.ts"
import { TeamUserAvatar } from "./TeamUserAvatar.tsx"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { useAppI18n } from "@/i18n"
import { cn } from "@/lib/utils"
import { ProviderIcon } from "@/routes/Connections/ProviderIcon"
import { teamErrorMessage } from "@/routes/Skills/team-errors"

export interface TeamMemberConnectionAccessData {
  access: TeamAppAccess | null
  apps: ConnectionAppSummary[]
  error: string | null
  loading: boolean
  providers: ConnectionProviderSummary[]
}

export function TeamMemberConnectionAccessPanel({
  data,
  member,
  onClose,
  onOpenConnection,
  onRetry,
  onSave,
}: {
  data: TeamMemberConnectionAccessData
  member: MemberView
  onClose: () => void
  onOpenConnection: (target: { appId: string; service: string }) => void
  onRetry: () => void
  onSave: (delta: MemberConnectionAccessDelta) => Promise<void>
}) {
  const { t } = useAppI18n()
  const [filter, setFilter] = React.useState<MemberConnectionAccessFilter>("all")
  const [query, setQuery] = React.useState("")
  const [editing, setEditing] = React.useState(false)
  const [draftAppIds, setDraftAppIds] = React.useState<Set<string>>(() => new Set())
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const providersByService = React.useMemo(
    () => new Map(data.providers.map((provider) => [provider.service, provider])),
    [data.providers],
  )
  const projection = React.useMemo(
    () => (member && data.access ? projectMemberConnectionAccess(data.access, data.apps, member.user_id) : null),
    [data.access, data.apps, member],
  )
  const visibleItems = React.useMemo(
    () => (projection?.ok ? filterMemberConnectionAccessItems(projection.items, filter, query) : []),
    [filter, projection, query],
  )
  const explicitAppIds = React.useMemo(
    () =>
      projection?.ok ? projection.items.filter((item) => item.provenance === "explicit").map((item) => item.appId) : [],
    [projection],
  )
  const explicitAppIdsKey = explicitAppIds.join("\u0000")
  const delta = React.useMemo(() => {
    const baseline = new Set(explicitAppIds)
    return {
      addAppIds: Array.from(draftAppIds)
        .filter((appId) => !baseline.has(appId))
        .sort(),
      removeAppIds: explicitAppIds.filter((appId) => !draftAppIds.has(appId)).sort(),
      userId: member.user_id,
    }
  }, [draftAppIds, explicitAppIds, member.user_id])
  const hasChanges = delta.addAppIds.length > 0 || delta.removeAppIds.length > 0
  const hasEditableConnections = Boolean(
    projection?.ok && projection.items.some((item) => item.provenance === "explicit" || item.provenance === "none"),
  )

  React.useEffect(() => {
    setFilter("all")
    setQuery("")
    setEditing(false)
    setConfirmOpen(false)
    setSaving(false)
  }, [member.user_id])

  React.useEffect(() => {
    if (!editing) setDraftAppIds(new Set(explicitAppIds))
  }, [editing, explicitAppIdsKey])

  async function save() {
    if (!member || !hasChanges || saving) return
    setSaving(true)
    try {
      await onSave(delta)
      toast.success(t("teams.memberConnectionAccessSaveSuccess"))
      setConfirmOpen(false)
      setEditing(false)
    } catch (error) {
      toast.error(memberConnectionAccessErrorMessage(error, t))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="grid gap-3">
        <div className="oo-text-caption text-muted-foreground">{t("teams.memberConnectionAccessDescription")}</div>
        <MemberHeader member={member} projection={projection} />
        {data.loading && !data.access ? (
          <AccessListSkeleton />
        ) : data.error ? (
          <AccessLoadError error={data.error} onRetry={onRetry} />
        ) : projection && !projection.ok ? (
          <AccessLoadError error={t("teams.memberConnectionAccessInvalid")} onRetry={onRetry} />
        ) : projection?.ok ? (
          <>
            {editing ? (
              <div className="oo-text-caption rounded-md border bg-muted/30 px-3 py-2 text-muted-foreground">
                {t("teams.memberConnectionAccessEditHint")}
              </div>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="relative min-w-0">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  className="pl-8"
                  placeholder={t("teams.memberConnectionAccessSearch")}
                  aria-label={t("teams.memberConnectionAccessSearch")}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <AccessFilters filter={filter} projection={projection} onChange={setFilter} />
            </div>
            {visibleItems.length > 0 ? (
              <div className="max-h-[46vh] overflow-y-auto rounded-md border">
                <div className="divide-y">
                  {visibleItems.map((item) => (
                    <ConnectionAccessRow
                      key={item.appId}
                      checked={draftAppIds.has(item.appId)}
                      editing={editing}
                      item={item}
                      provider={item.service ? providersByService.get(item.service) : undefined}
                      onCheckedChange={(checked) =>
                        setDraftAppIds((current) => {
                          const next = new Set(current)
                          if (checked) next.add(item.appId)
                          else next.delete(item.appId)
                          return next
                        })
                      }
                      onOpenConnection={onOpenConnection}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="oo-text-caption flex min-h-28 items-center justify-center rounded-md border border-dashed px-4 text-center text-muted-foreground">
                {projection.items.length === 0
                  ? t("teams.memberConnectionAccessEmpty")
                  : t("teams.memberConnectionAccessNoMatches")}
              </div>
            )}
          </>
        ) : null}
        <div className="oo-border-divider flex justify-end gap-2 border-t pt-3">
          {editing ? (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => {
                  setDraftAppIds(new Set(explicitAppIds))
                  setEditing(false)
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button type="button" disabled={!hasChanges || saving} onClick={() => setConfirmOpen(true)}>
                {t("common.save")}
              </Button>
            </>
          ) : (
            <>
              {hasEditableConnections ? (
                <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                  <Pencil className="size-3.5" />
                  {t("teams.memberConnectionAccessEdit")}
                </Button>
              ) : null}
              <Button type="button" variant="outline" onClick={onClose}>
                {t("common.close")}
              </Button>
            </>
          )}
        </div>
      </div>
      <ConfirmDialog open={confirmOpen} onOpenChange={(open) => !saving && setConfirmOpen(open)}>
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>{t("teams.memberConnectionAccessConfirmTitle")}</ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t("teams.memberConnectionAccessConfirmDescription", {
                add: delta.addAppIds.length,
                remove: delta.removeAppIds.length,
              })}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel disabled={saving}>{t("common.cancel")}</ConfirmDialogCancel>
            <ConfirmDialogAction variant="default" disabled={!hasChanges || saving} onClick={() => void save()}>
              {saving ? t("teams.memberConnectionAccessSaving") : t("common.save")}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </>
  )
}

function MemberHeader({
  member,
  projection,
}: {
  member: MemberView
  projection: MemberConnectionAccessProjection | null
}) {
  const { t } = useAppI18n()
  const summary = projection?.ok ? projection.summary : null
  return (
    <div className="flex min-w-0 items-center gap-3 border-b pb-3">
      <TeamUserAvatar avatar={member.avatar} fallback={member.fallback} />
      <div className="min-w-0 flex-1">
        <div className="oo-text-label truncate">{member.displayName}</div>
        <div className="oo-text-micro truncate text-muted-foreground">{member.secondaryLabel}</div>
      </div>
      {summary ? (
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          <Badge variant="secondary">
            {t("teams.memberConnectionAccessEffectiveCount", { count: summary.effectiveCount })}
          </Badge>
          {summary.explicitCount > 0 ? (
            <Badge variant="success">
              {t("teams.memberConnectionAccessExplicitCount", { count: summary.explicitCount })}
            </Badge>
          ) : null}
          {summary.invalidCount > 0 ? (
            <Badge variant="warning">
              {t("teams.memberConnectionAccessInvalidCount", { count: summary.invalidCount })}
            </Badge>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function AccessFilters({
  filter,
  onChange,
  projection,
}: {
  filter: MemberConnectionAccessFilter
  onChange: (filter: MemberConnectionAccessFilter) => void
  projection: Extract<MemberConnectionAccessProjection, { ok: true }>
}) {
  const { t } = useAppI18n()
  const filters: Array<{ count: number; label: string; value: MemberConnectionAccessFilter }> = [
    { count: projection.summary.totalCount, label: t("teams.memberConnectionFilterAll"), value: "all" },
    { count: projection.summary.effectiveCount, label: t("teams.memberConnectionFilterEffective"), value: "effective" },
    { count: projection.summary.explicitCount, label: t("teams.memberConnectionFilterExplicit"), value: "explicit" },
    { count: projection.summary.teamCount, label: t("teams.memberConnectionFilterTeam"), value: "team" },
    { count: projection.summary.noneCount, label: t("teams.memberConnectionFilterNone"), value: "none" },
    { count: projection.summary.invalidCount, label: t("teams.memberConnectionFilterInvalid"), value: "invalid" },
  ]
  return (
    <div role="group" className="flex min-w-0 flex-wrap gap-1" aria-label={t("teams.memberConnectionFilterLabel")}>
      {filters.map((item) => (
        <Button
          key={item.value}
          type="button"
          size="sm"
          variant={filter === item.value ? "secondary" : "ghost"}
          className="h-8 px-2"
          aria-pressed={filter === item.value}
          onClick={() => onChange(item.value)}
        >
          {item.label}
          <span className="text-muted-foreground tabular-nums">{item.count}</span>
        </Button>
      ))}
    </div>
  )
}

function ConnectionAccessRow({
  checked,
  editing,
  item,
  provider,
  onCheckedChange,
  onOpenConnection,
}: {
  checked: boolean
  editing: boolean
  item: MemberConnectionAccessItem
  provider?: ConnectionProviderSummary
  onCheckedChange: (checked: boolean) => void
  onOpenConnection: (target: { appId: string; service: string }) => void
}) {
  const { t } = useAppI18n()
  const editable = item.provenance === "explicit" || item.provenance === "none"
  const canOpen = Boolean(item.service && item.provenance !== "invalid" && item.status !== "disconnected")
  return (
    <div
      className={cn(
        "grid min-w-0 items-center gap-3 px-3 py-2.5",
        editing ? "grid-cols-[auto_auto_minmax(0,1fr)_auto]" : "grid-cols-[auto_minmax(0,1fr)_auto]",
      )}
    >
      {editing ? (
        <input
          type="checkbox"
          className="size-4 shrink-0 accent-primary disabled:cursor-not-allowed disabled:opacity-40"
          checked={editable ? checked : item.effective}
          disabled={!editable}
          aria-label={t("teams.memberConnectionAccessToggle", { name: item.label })}
          onChange={(event) => onCheckedChange(event.currentTarget.checked)}
        />
      ) : null}
      <ProviderIcon iconUrl={provider?.iconUrl} displayName={provider?.displayName ?? item.service ?? item.label} />
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="oo-text-control min-w-0 truncate font-medium">{item.label}</span>
          <ProvenanceBadge provenance={item.provenance} />
          {item.status && item.status !== "active" ? (
            <Badge variant="warning">{t("teams.memberConnectionStatusAttention")}</Badge>
          ) : null}
        </div>
        <div className="oo-text-micro mt-0.5 flex min-w-0 flex-wrap gap-x-2 text-muted-foreground">
          <span className="truncate font-mono">{item.service ?? item.appId}</span>
          <span>{actionScopeLabel(item, t)}</span>
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="shrink-0"
        disabled={!canOpen}
        title={t("teams.memberConnectionOpen")}
        onClick={() => {
          if (item.service) onOpenConnection({ appId: item.appId, service: item.service })
        }}
      >
        <ArrowUpRight className="size-3.5" />
        <span className="hidden sm:inline">{t("teams.memberConnectionOpen")}</span>
      </Button>
    </div>
  )
}

function ProvenanceBadge({ provenance }: { provenance: MemberConnectionProvenance }) {
  const { t } = useAppI18n()
  if (provenance === "invalid") {
    return <Badge variant="warning">{t("teams.memberConnectionProvenanceInvalid")}</Badge>
  }
  if (provenance === "explicit") {
    return <Badge variant="success">{t("teams.memberConnectionProvenanceExplicit")}</Badge>
  }
  if (provenance === "team") {
    return <Badge variant="secondary">{t("teams.memberConnectionProvenanceTeam")}</Badge>
  }
  return <Badge variant="outline">{t("teams.memberConnectionProvenanceNone")}</Badge>
}

function AccessLoadError({ error, onRetry }: { error: string; onRetry: () => void }) {
  const { t } = useAppI18n()
  return (
    <div className="grid min-h-32 place-items-center gap-3 rounded-md border border-dashed px-4 py-6 text-center">
      <div className="grid justify-items-center gap-1">
        <AlertTriangle className="size-5 text-[var(--oo-warning-foreground)]" />
        <div className="oo-text-label">{t("teams.memberConnectionAccessLoadFailed")}</div>
        <div className="oo-text-caption max-w-lg break-words text-muted-foreground">{error}</div>
      </div>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        <RefreshCw className="size-3.5" />
        {t("teams.retry")}
      </Button>
    </div>
  )
}

function AccessListSkeleton() {
  return (
    <div className="grid gap-2" aria-hidden="true">
      <div className="h-9 animate-pulse rounded-md bg-muted" />
      <div className="overflow-hidden rounded-md border">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0">
            <div className="size-8 animate-pulse rounded-md bg-muted" />
            <div className="grid flex-1 gap-1.5">
              <div className="h-3 w-40 max-w-full animate-pulse rounded-sm bg-muted" />
              <div className="h-2.5 w-56 max-w-full animate-pulse rounded-sm bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function actionScopeLabel(item: MemberConnectionAccessItem, t: ReturnType<typeof useAppI18n>["t"]): string {
  if (item.actionScope === "invalid") return t("teams.memberConnectionActionsInvalid")
  if (item.actionScope === "all") return t("teams.memberConnectionActionsAll")
  if (item.actionScope === "none") return t("teams.memberConnectionActionsNone")
  return t("teams.memberConnectionActionsSelected", { count: item.actionCount ?? 0 })
}

function memberConnectionAccessErrorMessage(error: unknown, t: ReturnType<typeof useAppI18n>["t"]): string {
  if (!(error instanceof MemberConnectionAccessError)) return teamErrorMessage(error, t)
  if (error.code === "invalidPolicy") return t("teams.memberConnectionAccessInvalidPolicy")
  if (error.code === "conflictingDelta") return t("teams.memberConnectionAccessConflictingDelta")
  if (error.code === "unavailable") return t("teams.memberConnectionAccessUnavailable")
  if (error.code === "teamInherited") return t("teams.memberConnectionAccessTeamInherited")
  return t("teams.memberConnectionAccessConcurrencyUnavailable")
}

export function MemberConnectionAccessButton({
  disabled,
  loading,
  projection,
  onClick,
}: {
  disabled: boolean
  loading: boolean
  projection: MemberConnectionAccessProjection | null
  onClick: () => void
}) {
  const { t } = useAppI18n()
  const summary = projection?.ok ? projection.summary : null
  const invalid = !loading && (!projection?.ok || Boolean(summary?.invalidCount))
  const explicit = Boolean(summary?.explicitCount)
  const effective = Boolean(summary?.effectiveCount)
  const label = loading
    ? t("teams.memberConnectionAccessLoading")
    : invalid
      ? t("teams.memberConnectionAccessWarning")
      : explicit
        ? t("teams.memberConnectionAccessExplicitAria", { count: summary?.explicitCount ?? 0 })
        : effective
          ? t("teams.memberConnectionAccessInheritedAria", { count: summary?.effectiveCount ?? 0 })
          : t("teams.memberConnectionAccessEmptyAria")
  const Icon = invalid ? ShieldAlert : explicit ? ShieldCheck : Shield
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={cn(
        "size-8",
        invalid && "border-[var(--oo-warning-border)] text-[var(--oo-warning-foreground)]",
        explicit && !invalid && "border-success/25 bg-success/5 text-success",
      )}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className={cn("size-3.5", loading && "animate-pulse")} />
    </Button>
  )
}
