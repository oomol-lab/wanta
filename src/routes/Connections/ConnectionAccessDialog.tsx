import type { ConnectionActionCatalogItem, ConnectionAppSummary } from "../../../electron/connections/common.ts"
import type { Team, TeamAppAccess, TeamMember, TeamUserSummary } from "../../../electron/teams/common.ts"
import type { MessageKey } from "@/i18n/i18n"
import type { ConnectionActionAccess, ConnectionAppAccess, ConnectionMemberAccess } from "@/lib/team-connection-access"

import { AlertTriangle, ChevronDown, ChevronRight, RotateCcw, Search, ShieldCheck, Users } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import {
  connectionAccessSaveDisabled,
  defaultRestrictedActionNames,
  unavailableActionNames,
  updateActionSelection,
} from "./connection-access-model.ts"
import { Loader } from "@/components/ai-elements/loader"
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
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useT } from "@/i18n/i18n"
import { getConnectionActions } from "@/lib/connections-client"
import {
  hasTeamConnectionAppAccess,
  parseTeamConnectionAccess,
  restoreTeamConnectionDefaults,
  setTeamConnectionActionAccess,
  setTeamConnectionMemberAccess,
} from "@/lib/team-connection-access"
import {
  getTeamMembersResource,
  getTeamUserSummariesResource,
  invalidateTeamDetailsResource,
} from "@/lib/team-details-resource"
import { getTeamAppAccessSnapshot, updateTeamAppAccess } from "@/lib/teams-client"
import { resolveUserFacingError, userFacingErrorDescription } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"

export interface ConnectionAccessContext {
  accountId?: string
  canManage: boolean
  currentUserId?: string
  team: Team
}

interface AccessSnapshot {
  access: TeamAppAccess
  etag?: string
}

type BusyMutation = "action" | "member" | "repair" | null
type OperationType = ConnectionActionCatalogItem["operationType"]
type EmptyAccessConfirmation =
  | { access: Extract<ConnectionMemberAccess, { mode: "selected" }>; kind: "member" }
  | { access: Extract<ConnectionActionAccess, { mode: "restricted" }>; kind: "action" }

const operationTypes: OperationType[] = ["read", "write", "destructive"]

export function ConnectionAccessDialog({
  app,
  context,
  onClose,
  open,
}: {
  app: ConnectionAppSummary
  context: ConnectionAccessContext
  onClose: () => void
  open: boolean
}) {
  const t = useT()
  const [snapshot, setSnapshot] = React.useState<AccessSnapshot | null>(null)
  const [accessError, setAccessError] = React.useState<string | null>(null)
  const [actions, setActions] = React.useState<ConnectionActionCatalogItem[]>([])
  const [actionsError, setActionsError] = React.useState<string | null>(null)
  const [members, setMembers] = React.useState<TeamMember[]>([])
  const [summaries, setSummaries] = React.useState<Record<string, TeamUserSummary>>({})
  const [membersError, setMembersError] = React.useState<string | null>(null)
  const [loadingAccess, setLoadingAccess] = React.useState(false)
  const [loadingActions, setLoadingActions] = React.useState(false)
  const [loadingMembers, setLoadingMembers] = React.useState(false)
  const [busy, setBusy] = React.useState<BusyMutation>(null)
  const [repairOpen, setRepairOpen] = React.useState(false)
  const [emptyAccessConfirmation, setEmptyAccessConfirmation] = React.useState<EmptyAccessConfirmation | null>(null)
  const requestIdRef = React.useRef(0)

  const load = React.useCallback(
    async ({ forceRefreshActions = false }: { forceRefreshActions?: boolean } = {}) => {
      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      setLoadingAccess(true)
      setLoadingActions(true)
      setLoadingMembers(context.canManage)
      setAccessError(null)
      setActionsError(null)
      setMembersError(null)

      const accessPromise = getTeamAppAccessSnapshot(context.team.id)
        .then((value) => {
          if (requestIdRef.current === requestId) setSnapshot(value)
        })
        .catch((error: unknown) => {
          if (requestIdRef.current === requestId) setAccessError(errorMessage(error, t))
        })
        .finally(() => {
          if (requestIdRef.current === requestId) setLoadingAccess(false)
        })

      const actionsPromise = getConnectionActions(app.service, { forceRefresh: forceRefreshActions })
        .then((value) => {
          if (requestIdRef.current === requestId) setActions(normalizeActions(value.data))
        })
        .catch((error: unknown) => {
          if (requestIdRef.current === requestId) setActionsError(errorMessage(error, t))
        })
        .finally(() => {
          if (requestIdRef.current === requestId) setLoadingActions(false)
        })

      const resourceAccountId = context.accountId ?? "anonymous"
      const membersPromise = context.canManage
        ? getTeamMembersResource(resourceAccountId, context.team.id)
            .then(async (value) => {
              if (requestIdRef.current !== requestId) return
              setMembers(value)
              const userIds = uniqueStrings(value.map((member) => member.user_id))
              if (userIds.length > 0) {
                const loadedSummaries = await getTeamUserSummariesResource(resourceAccountId, context.team.id, userIds)
                if (requestIdRef.current === requestId) setSummaries(loadedSummaries)
              }
            })
            .catch((error: unknown) => {
              if (requestIdRef.current === requestId) setMembersError(errorMessage(error, t))
            })
            .finally(() => {
              if (requestIdRef.current === requestId) setLoadingMembers(false)
            })
        : Promise.resolve()

      await Promise.all([accessPromise, actionsPromise, membersPromise])
    },
    [app.service, context.accountId, context.canManage, context.team.id, t],
  )

  React.useEffect(() => {
    if (!open) return
    setSnapshot(null)
    setActions([])
    setMembers([])
    setSummaries({})
    setBusy(null)
    setRepairOpen(false)
    setEmptyAccessConfirmation(null)
    void load()
    return () => {
      requestIdRef.current += 1
    }
  }, [app.id, load, open])

  const parsed = React.useMemo(
    () => (snapshot ? parseTeamConnectionAccess(snapshot.access, [{ id: app.id, service: app.service }]) : null),
    [app.id, app.service, snapshot],
  )
  const appAccess = parsed?.ok ? (parsed.apps.find((item) => item.appId === app.id) ?? null) : null
  const policyError =
    accessError ??
    (parsed && !parsed.ok ? t("connections.accessInvalidDescription") : null) ??
    (appAccess?.mode === "invalid" ? t("connections.accessInvalidDescription") : null)

  async function mutate(kind: Exclude<BusyMutation, null>, transform: (access: TeamAppAccess) => TeamAppAccess) {
    if (!context.canManage || busy) return
    setBusy(kind)
    try {
      const latest = await getTeamAppAccessSnapshot(context.team.id)
      const latestParsed = parseTeamConnectionAccess(latest.access, [{ id: app.id, service: app.service }])
      if (!latestParsed.ok) throw new ConnectionAccessError("connections.accessInvalidDescription")
      const current = latestParsed.apps.find((item) => item.appId === app.id)
      if (!current || current.mode === "invalid") {
        throw new ConnectionAccessError("connections.accessInvalidDescription")
      }
      if (!latest.etag) throw new ConnectionAccessError("connections.accessConcurrencyUnavailable")
      const updated = await updateTeamAppAccess(context.team.id, transform(latestParsed.access), {
        etag: latest.etag,
      })
      invalidateTeamDetailsResource(context.accountId, context.team.id)
      setSnapshot({ access: updated })
      toast.success(t("connections.accessSaved"))
    } catch (error) {
      toast.error(errorMessage(error, t))
    } finally {
      setBusy(null)
    }
  }

  async function repair() {
    if (!context.canManage || busy) return
    setBusy("repair")
    try {
      const latest = await getTeamAppAccessSnapshot(context.team.id)
      if (!latest.etag) throw new ConnectionAccessError("connections.accessConcurrencyUnavailable")
      const updated = await updateTeamAppAccess(context.team.id, restoreTeamConnectionDefaults(latest.access, app.id), {
        etag: latest.etag,
      })
      invalidateTeamDetailsResource(context.accountId, context.team.id)
      setSnapshot({ access: updated })
      setRepairOpen(false)
      toast.success(t("connections.accessDefaultsRestored"))
    } catch (error) {
      toast.error(errorMessage(error, t))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onClose={busy ? () => undefined : onClose}
        title={t("connections.accessTitle")}
        description={t("connections.accessDescription", { name: connectionLabel(app) })}
        className="max-w-3xl"
        contentClassName="px-4 py-4"
        footer={
          <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={onClose}>
            {t("common.close")}
          </Button>
        }
      >
        {loadingAccess && !snapshot ? (
          <AccessSkeleton />
        ) : policyError ? (
          <AccessError
            canRepair={context.canManage && Boolean(snapshot)}
            error={policyError}
            loading={busy === "repair"}
            onRepair={() => setRepairOpen(true)}
            onRetry={() => void load()}
          />
        ) : appAccess && appAccess.mode !== "invalid" ? (
          <div className="grid gap-4">
            <MemberAccessSection
              access={appAccess}
              busy={busy !== null}
              saving={busy === "member"}
              canManage={context.canManage}
              currentUserId={context.currentUserId}
              error={membersError}
              loading={loadingMembers}
              members={members}
              summaries={summaries}
              onSave={(memberAccess) => {
                if (memberAccess.mode === "selected" && memberAccess.userIds.length === 0) {
                  setEmptyAccessConfirmation({ access: memberAccess, kind: "member" })
                  return Promise.resolve()
                }
                return mutate("member", (access) =>
                  setTeamConnectionMemberAccess(access, { id: app.id, service: app.service }, memberAccess),
                )
              }}
            />
            <ActionAccessSection
              access={appAccess}
              actions={actions}
              busy={busy !== null}
              saving={busy === "action"}
              canManage={context.canManage}
              error={actionsError}
              loading={loadingActions}
              onRetry={() => void load({ forceRefreshActions: true })}
              onSave={(actionAccess) => {
                if (actionAccess.mode === "restricted" && actionAccess.actionNames.length === 0) {
                  setEmptyAccessConfirmation({ access: actionAccess, kind: "action" })
                  return Promise.resolve()
                }
                return mutate("action", (access) =>
                  setTeamConnectionActionAccess(access, { id: app.id, service: app.service }, actionAccess),
                )
              }}
            />
          </div>
        ) : null}
      </Dialog>
      <ConfirmDialog
        open={repairOpen}
        onOpenChange={(nextOpen) => {
          if (nextOpen || busy !== "repair") setRepairOpen(nextOpen)
        }}
      >
        <ConfirmDialogContent overlayClassName="oo-modal-backdrop-nested">
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>{t("connections.accessRepairTitle")}</ConfirmDialogTitle>
            <ConfirmDialogDescription>{t("connections.accessRepairDescription")}</ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel disabled={busy === "repair"}>{t("common.cancel")}</ConfirmDialogCancel>
            <ConfirmDialogAction variant="destructive" disabled={busy === "repair"} onClick={() => void repair()}>
              {busy === "repair" ? <Loader size={16} /> : null}
              {t("connections.accessRestoreDefaults")}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
      <ConfirmDialog
        open={emptyAccessConfirmation !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !busy) setEmptyAccessConfirmation(null)
        }}
      >
        <ConfirmDialogContent overlayClassName="oo-modal-backdrop-nested">
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>{t("connections.accessEmptyConfirmTitle")}</ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t(
                emptyAccessConfirmation?.kind === "member"
                  ? "connections.accessEmptyMembersConfirmDescription"
                  : "connections.accessEmptyActionsConfirmDescription",
              )}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel disabled={Boolean(busy)}>{t("common.cancel")}</ConfirmDialogCancel>
            <ConfirmDialogAction
              variant="destructive"
              disabled={Boolean(busy) || !emptyAccessConfirmation}
              onClick={() => {
                const confirmation = emptyAccessConfirmation
                setEmptyAccessConfirmation(null)
                if (!confirmation) return
                if (confirmation.kind === "member") {
                  void mutate("member", (access) =>
                    setTeamConnectionMemberAccess(access, { id: app.id, service: app.service }, confirmation.access),
                  )
                } else {
                  void mutate("action", (access) =>
                    setTeamConnectionActionAccess(access, { id: app.id, service: app.service }, confirmation.access),
                  )
                }
              }}
            >
              {t("connections.accessEmptyConfirmAction")}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </>
  )
}

function MemberAccessSection({
  access,
  busy,
  canManage,
  currentUserId,
  error,
  loading,
  members,
  onSave,
  saving,
  summaries,
}: {
  access: Exclude<ConnectionAppAccess, { mode: "invalid" }>
  busy: boolean
  canManage: boolean
  currentUserId?: string
  error: string | null
  loading: boolean
  members: TeamMember[]
  onSave: (access: ConnectionMemberAccess) => Promise<void>
  saving: boolean
  summaries: Record<string, TeamUserSummary>
}) {
  const t = useT()
  const initial = access.memberAccess
  const [mode, setMode] = React.useState<ConnectionMemberAccess["mode"]>(initial.mode)
  const [selected, setSelected] = React.useState<string[]>(initial.mode === "selected" ? initial.userIds : [])
  const [query, setQuery] = React.useState("")

  React.useEffect(() => {
    setMode(access.memberAccess.mode)
    setSelected(access.memberAccess.mode === "selected" ? access.memberAccess.userIds : [])
    setQuery("")
  }, [access])

  const selectedSet = React.useMemo(() => new Set(selected), [selected])
  const currentMemberIds = React.useMemo(() => new Set(members.map((member) => member.user_id)), [members])
  const unavailable = selected.filter((userId) => !currentMemberIds.has(userId))
  const normalizedQuery = query.trim().toLowerCase()
  const filteredMembers = members.filter((member) => {
    if (!normalizedQuery) return true
    return memberLabel(member.user_id, summaries).toLowerCase().includes(normalizedQuery)
  })
  const dirty =
    mode !== initial.mode ||
    (mode === "selected" && !sameStrings(selected, initial.mode === "selected" ? initial.userIds : []))
  const effective = hasTeamConnectionAppAccess(access, currentUserId ?? "")

  return (
    <section className="grid gap-3 rounded-md border p-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Users className="size-4" />
            <h3 className="oo-text-title">{t("connections.memberAccessTitle")}</h3>
          </div>
          <p className="oo-text-caption oo-text-muted mt-1">
            {access.memberAccess.mode === "team"
              ? t("connections.memberAccessTeamSummary")
              : t("connections.memberAccessSelectedSummary", { count: access.memberAccess.userIds.length })}
          </p>
        </div>
        {!canManage ? (
          <span className={cn("oo-text-caption shrink-0", effective ? "text-foreground" : "text-destructive")}>
            {t(effective ? "connections.accessAvailableToYou" : "connections.accessUnavailableToYou")}
          </span>
        ) : null}
      </div>

      {canManage ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <ModeButton
              active={mode === "team"}
              disabled={busy}
              description={t("connections.memberAccessTeamDescription")}
              label={t("connections.memberAccessTeam")}
              onClick={() => setMode("team")}
            />
            <ModeButton
              active={mode === "selected"}
              disabled={busy || loading}
              description={t("connections.memberAccessSelectedDescription")}
              label={t("connections.memberAccessSelected")}
              onClick={() => setMode("selected")}
            />
          </div>
          {mode === "selected" ? (
            <div className="grid gap-2">
              {members.length >= 7 ? (
                <div className="relative">
                  <Search className="oo-icon-muted pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                  <Input
                    value={query}
                    disabled={busy}
                    className="pl-8"
                    placeholder={t("connections.memberSearch")}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
              ) : null}
              {loading ? (
                <div className="oo-text-caption oo-text-muted flex items-center gap-2 py-3">
                  <Loader size={16} />
                  {t("connections.memberLoading")}
                </div>
              ) : error ? (
                <InlineError message={error} />
              ) : (
                <div className="max-h-56 overflow-y-auto rounded-md border">
                  {filteredMembers.map((member) => (
                    <CheckboxRow
                      key={member.user_id}
                      checked={selectedSet.has(member.user_id)}
                      disabled={busy}
                      label={memberLabel(member.user_id, summaries)}
                      secondary={member.disable ? t("teams.memberDisabled") : member.role}
                      onChange={(checked) => setSelected(toggleString(selected, member.user_id, checked))}
                    />
                  ))}
                  {unavailable.map((userId) => (
                    <CheckboxRow
                      key={userId}
                      checked
                      disabled={busy}
                      label={userId}
                      secondary={t("connections.memberUnavailable")}
                      onChange={(checked) => setSelected(toggleString(selected, userId, checked))}
                    />
                  ))}
                  {filteredMembers.length === 0 && unavailable.length === 0 ? (
                    <div className="oo-text-caption oo-text-muted px-3 py-6 text-center">
                      {t("connections.memberEmpty")}
                    </div>
                  ) : null}
                </div>
              )}
              <div className="oo-text-caption oo-text-muted">
                {t("connections.memberSelectedCount", { count: selected.length })}
              </div>
            </div>
          ) : null}
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={connectionAccessSaveDisabled({
                busy,
                dirty,
                error: Boolean(error),
                loading,
                requiresCatalog: mode === "selected",
              })}
              onClick={() => void onSave(mode === "team" ? { mode: "team" } : { mode: "selected", userIds: selected })}
            >
              {saving ? <Loader size={16} /> : <ShieldCheck className="size-4" />}
              {t("connections.memberAccessSave")}
            </Button>
          </div>
        </>
      ) : null}
    </section>
  )
}

function ActionAccessSection({
  access,
  actions,
  busy,
  canManage,
  error,
  loading,
  onRetry,
  onSave,
  saving,
}: {
  access: Exclude<ConnectionAppAccess, { mode: "invalid" }>
  actions: ConnectionActionCatalogItem[]
  busy: boolean
  canManage: boolean
  error: string | null
  loading: boolean
  onRetry: () => void
  onSave: (access: ConnectionActionAccess) => Promise<void>
  saving: boolean
}) {
  const t = useT()
  const initial = access.actionAccess
  const [mode, setMode] = React.useState<ConnectionActionAccess["mode"]>(initial.mode)
  const [selected, setSelected] = React.useState<string[]>(initial.mode === "restricted" ? initial.actionNames : [])
  const [restrictionInitialized, setRestrictionInitialized] = React.useState(initial.mode === "restricted")
  const [query, setQuery] = React.useState("")
  const [expanded, setExpanded] = React.useState<Set<OperationType>>(() => new Set())

  React.useEffect(() => {
    setMode(access.actionAccess.mode)
    setSelected(access.actionAccess.mode === "restricted" ? access.actionAccess.actionNames : [])
    setRestrictionInitialized(access.actionAccess.mode === "restricted")
    setQuery("")
    setExpanded(new Set())
  }, [access])

  const unavailable = unavailableActionNames(selected, actions)
  const filtered = filterActions(actions, query)
  const selectedSet = React.useMemo(() => new Set(selected), [selected])
  const initialNames = initial.mode === "restricted" ? initial.actionNames : []
  const dirty = mode !== initial.mode || (mode === "restricted" && !sameStrings(selected, initialNames))

  function selectMode(nextMode: ConnectionActionAccess["mode"]) {
    setMode(nextMode)
    if (nextMode === "restricted" && !restrictionInitialized) {
      setSelected(defaultRestrictedActionNames(actions))
      setRestrictionInitialized(true)
    }
  }

  return (
    <section className="grid gap-3 rounded-md border p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4" />
          <h3 className="oo-text-title">{t("connections.actionAccessTitle")}</h3>
        </div>
        <p className="oo-text-caption oo-text-muted mt-1">
          {access.actionAccess.mode === "unrestricted"
            ? t("connections.actionAccessUnrestrictedSummary")
            : t("connections.actionAccessRestrictedSummary", {
                allowed: access.actionAccess.actionNames.length,
                total: actions.length,
              })}
        </p>
      </div>

      {canManage ? (
        <div className="grid grid-cols-2 gap-2">
          <ModeButton
            active={mode === "unrestricted"}
            disabled={busy}
            description={t("connections.actionAccessUnrestrictedDescription")}
            label={t("connections.actionAccessUnrestricted")}
            onClick={() => selectMode("unrestricted")}
          />
          <ModeButton
            active={mode === "restricted"}
            disabled={busy || loading}
            description={t("connections.actionAccessRestrictedDescription")}
            label={t("connections.actionAccessRestricted")}
            onClick={() => selectMode("restricted")}
          />
        </div>
      ) : null}

      {(canManage ? mode === "restricted" : access.actionAccess.mode === "restricted") ? (
        <div className="grid gap-2">
          {canManage && actions.length > 8 ? (
            <div className="relative">
              <Search className="oo-icon-muted pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                value={query}
                disabled={busy}
                className="pl-8"
                placeholder={t("connections.actionSearch")}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          ) : null}
          {loading ? (
            <div className="oo-text-caption oo-text-muted flex items-center gap-2 py-3">
              <Loader size={16} />
              {t("connections.actionLoading")}
            </div>
          ) : error ? (
            <div className="flex items-center justify-between gap-3">
              <InlineError message={error} />
              <Button size="sm" variant="outline" onClick={onRetry}>
                {t("teams.retry")}
              </Button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border">
              {operationTypes.map((operationType) => {
                const groupActions = filtered.filter((action) => action.operationType === operationType)
                if (groupActions.length === 0) return null
                return (
                  <ActionGroup
                    key={operationType}
                    actions={groupActions}
                    canManage={canManage && !busy}
                    expanded={expanded.has(operationType)}
                    operationType={operationType}
                    selected={selectedSet}
                    onExpandedChange={(value) =>
                      setExpanded((current) => {
                        const next = new Set(current)
                        if (value) next.add(operationType)
                        else next.delete(operationType)
                        return next
                      })
                    }
                    onSelectionChange={setSelected}
                  />
                )
              })}
              {unavailable.length > 0 ? (
                <div className="border-t">
                  <div className="oo-text-caption bg-muted/30 px-3 py-2 font-medium">
                    {t("connections.actionUnavailableGroup")}
                  </div>
                  {unavailable.map((name) => (
                    <CheckboxRow
                      key={name}
                      checked
                      disabled={!canManage || busy}
                      label={name}
                      secondary={t("connections.actionUnavailable")}
                      onChange={(checked) => setSelected(toggleString(selected, name, checked))}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          )}
          <p className="oo-text-caption text-[var(--oo-warning-foreground)]">
            {t("connections.actionAccessProxyWarning")}
          </p>
        </div>
      ) : null}

      {canManage ? (
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={connectionAccessSaveDisabled({
              busy,
              dirty,
              error: Boolean(error),
              loading,
              requiresCatalog: mode === "restricted",
            })}
            onClick={() =>
              void onSave(
                mode === "unrestricted" ? { mode: "unrestricted" } : { mode: "restricted", actionNames: selected },
              )
            }
          >
            {saving ? <Loader size={16} /> : <ShieldCheck className="size-4" />}
            {t("connections.actionAccessSave")}
          </Button>
        </div>
      ) : null}
    </section>
  )
}

function ActionGroup({
  actions,
  canManage,
  expanded,
  onExpandedChange,
  onSelectionChange,
  operationType,
  selected,
}: {
  actions: ConnectionActionCatalogItem[]
  canManage: boolean
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  onSelectionChange: (selected: string[]) => void
  operationType: OperationType
  selected: Set<string>
}) {
  const t = useT()
  const names = actions.map((action) => action.name)
  const selectedCount = names.filter((name) => selected.has(name)).length
  const checked = selectedCount === names.length
  const indeterminate = selectedCount > 0 && !checked
  const allSelected = Array.from(selected)

  return (
    <div className="border-b last:border-b-0">
      <div className="flex min-h-10 items-center gap-2 bg-muted/20 px-2">
        <button
          type="button"
          className="oo-icon-muted flex size-7 items-center justify-center rounded-md hover:bg-accent"
          aria-label={operationTypeLabel(operationType, t)}
          onClick={() => onExpandedChange(!expanded)}
        >
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <TriStateCheckbox
          checked={checked}
          disabled={!canManage}
          indeterminate={indeterminate}
          ariaLabel={operationTypeLabel(operationType, t)}
          onChange={(value) => {
            onSelectionChange(updateActionSelection(allSelected, names, value))
          }}
        />
        <button
          type="button"
          className="oo-text-control min-w-0 flex-1 text-left font-medium"
          onClick={() => onExpandedChange(!expanded)}
        >
          {operationTypeLabel(operationType, t)}
        </button>
        <span className="oo-text-micro oo-text-muted shrink-0">
          {selectedCount} / {names.length}
        </span>
      </div>
      {expanded ? (
        <div className="divide-y border-t">
          {actions.map((action) => (
            <CheckboxRow
              key={action.id}
              checked={selected.has(action.name)}
              disabled={!canManage}
              label={action.name}
              secondary={action.description}
              onChange={(checked) => onSelectionChange(toggleString(allSelected, action.name, checked))}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ModeButton({
  active,
  description,
  disabled,
  label,
  onClick,
}: {
  active: boolean
  description: string
  disabled?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      className={cn(
        "grid min-h-20 gap-1 rounded-md border px-3 py-2 text-left",
        active ? "border-foreground bg-muted/50" : "hover:bg-muted/30",
        disabled && "cursor-not-allowed opacity-60",
      )}
      onClick={onClick}
    >
      <span className="oo-text-control font-medium">{label}</span>
      <span className="oo-text-caption oo-text-muted">{description}</span>
    </button>
  )
}

function CheckboxRow({
  checked,
  disabled,
  label,
  onChange,
  secondary,
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onChange: (checked: boolean) => void
  secondary?: string
}) {
  return (
    <label className={cn("flex min-h-11 items-center gap-3 px-3 py-2", disabled ? "opacity-60" : "hover:bg-muted/30")}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        className="size-4 shrink-0 accent-foreground"
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="min-w-0 flex-1">
        <span className="oo-text-control block truncate">{label}</span>
        {secondary ? <span className="oo-text-micro oo-text-muted block truncate">{secondary}</span> : null}
      </span>
    </label>
  )
}

function TriStateCheckbox({
  ariaLabel,
  checked,
  disabled,
  indeterminate,
  onChange,
}: {
  ariaLabel: string
  checked: boolean
  disabled: boolean
  indeterminate: boolean
  onChange: (checked: boolean) => void
}) {
  const ref = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={ariaLabel}
      checked={checked}
      disabled={disabled}
      className="size-4 shrink-0 accent-foreground"
      onChange={(event) => onChange(event.target.checked)}
    />
  )
}

function AccessError({
  canRepair,
  error,
  loading,
  onRepair,
  onRetry,
}: {
  canRepair: boolean
  error: string
  loading: boolean
  onRepair: () => void
  onRetry: () => void
}) {
  const t = useT()
  return (
    <div className="grid gap-3 rounded-md border border-[var(--oo-danger-border)] bg-[var(--oo-danger-surface)] p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0">
          <div className="oo-text-label">{t("connections.accessInvalidTitle")}</div>
          <div className="oo-text-caption oo-text-muted mt-1 break-words">{error}</div>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t("teams.retry")}
        </Button>
        {canRepair ? (
          <Button size="sm" variant="destructive" disabled={loading} onClick={onRepair}>
            {loading ? <Loader size={16} /> : <RotateCcw className="size-4" />}
            {t("connections.accessRepair")}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="oo-text-caption flex min-w-0 items-start gap-2 text-destructive">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span className="break-words">{message}</span>
    </div>
  )
}

function AccessSkeleton() {
  return (
    <div className="grid gap-4" aria-hidden="true">
      {[0, 1].map((item) => (
        <div key={item} className="grid gap-3 rounded-md border p-3">
          <div className="h-4 w-36 animate-pulse rounded-sm bg-muted" />
          <div className="h-3 w-64 max-w-full animate-pulse rounded-sm bg-muted" />
          <div className="grid grid-cols-2 gap-2">
            <div className="h-20 animate-pulse rounded-md bg-muted" />
            <div className="h-20 animate-pulse rounded-md bg-muted" />
          </div>
        </div>
      ))}
    </div>
  )
}

function normalizeActions(actions: ConnectionActionCatalogItem[]): ConnectionActionCatalogItem[] {
  return [...actions].sort((left, right) => {
    const operationDifference = operationTypes.indexOf(left.operationType) - operationTypes.indexOf(right.operationType)
    return operationDifference || left.name.localeCompare(right.name)
  })
}

function filterActions(actions: ConnectionActionCatalogItem[], query: string): ConnectionActionCatalogItem[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return actions
  return actions.filter(
    (action) =>
      action.name.toLowerCase().includes(normalized) || (action.description ?? "").toLowerCase().includes(normalized),
  )
}

function operationTypeLabel(operationType: OperationType, t: ReturnType<typeof useT>): string {
  if (operationType === "read") return t("connections.actionTypeRead")
  if (operationType === "write") return t("connections.actionTypeWrite")
  return t("connections.actionTypeDestructive")
}

function connectionLabel(app: ConnectionAppSummary): string {
  return (
    app.alias?.trim() || app.connectionName?.trim() || app.displayName?.trim() || app.accountLabel?.trim() || app.id
  )
}

function memberLabel(userId: string, summaries: Record<string, TeamUserSummary>): string {
  const summary = summaries[userId]
  return summary?.nickname?.trim() || summary?.username?.trim() || userId
}

function toggleString(values: string[], value: string, checked: boolean): string[] {
  const next = new Set(values)
  if (checked) next.add(value)
  else next.delete(value)
  return Array.from(next).sort()
}

function sameStrings(left: string[], right: string[]): boolean {
  const normalizedLeft = uniqueStrings(left).sort()
  const normalizedRight = uniqueStrings(right).sort()
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  )
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

class ConnectionAccessError extends Error {
  constructor(readonly messageKey: MessageKey) {
    super(messageKey)
    this.name = "ConnectionAccessError"
  }
}

function errorMessage(error: unknown, t: ReturnType<typeof useT>): string {
  if (error instanceof ConnectionAccessError) return t(error.messageKey)
  return userFacingErrorDescription(resolveUserFacingError(error, { area: "connections" }), t)
}
