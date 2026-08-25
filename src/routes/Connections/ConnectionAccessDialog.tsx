import type {
  ConnectionActionCatalogItem,
  ConnectionAppSummary,
  ConnectionLingxingErpUser,
} from "../../../electron/connections/common.ts"
import type { Team, TeamAppAccess, TeamMember, TeamUserSummary } from "../../../electron/teams/common.ts"
import type {
  ConnectionActionAccess,
  ConnectionAppAccess,
  ConnectionLingxingUserAccess,
  ConnectionPermissionGrant,
  ConnectionPermissionRule,
} from "@/lib/team-connection-access"

import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import {
  canRestoreConnectionAccess,
  createConnectionPermissionRuleGrant,
  defaultRestrictedActionNames,
  isConnectionAccessConflict,
  unavailableActionNames,
  updateActionSelection,
} from "./connection-access-model.ts"
import { localizeConnectionActions } from "./connection-action-localization.ts"
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
import { useI18n, useT } from "@/i18n/i18n"
import { ConnectorRequestError, getConnectionActions, getConnectionLingxingErpUsers } from "@/lib/connections-client"
import {
  createConnectionPermissionRuleId,
  getConnectionPermissionGrant,
  getConnectionPermissionRule,
  getConnectionRuleMemberIds,
  getConnectionLingxingUserAccess,
  parseTeamConnectionAccess,
  removeConnectionPermissionRule,
  restoreTeamConnectionDefaults,
  setConnectionPermissionRules,
  setConnectionLingxingUserAccess,
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

interface RuleEditorState {
  grant: ConnectionPermissionGrant
  kind: "default" | "new" | "rule"
  name: string
  ruleId: string
  userIds: string[]
}

type OperationType = ConnectionActionCatalogItem["operationType"]
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
  const { locale, t } = useI18n()
  const [snapshot, setSnapshot] = React.useState<AccessSnapshot | null>(null)
  const [actions, setActions] = React.useState<ConnectionActionCatalogItem[]>([])
  const [members, setMembers] = React.useState<TeamMember[]>([])
  const [lingxingUsers, setLingxingUsers] = React.useState<ConnectionLingxingErpUser[]>([])
  const [lingxingError, setLingxingError] = React.useState<string | null>(null)
  const [lingxingLoading, setLingxingLoading] = React.useState(false)
  const [lingxingLoaded, setLingxingLoaded] = React.useState(false)
  const [summaries, setSummaries] = React.useState<Record<string, TeamUserSummary>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [editor, setEditor] = React.useState<RuleEditorState | null>(null)
  const [deleteRule, setDeleteRule] = React.useState<ConnectionPermissionRule | null>(null)
  const [restoreOpen, setRestoreOpen] = React.useState(false)
  const requestIdRef = React.useRef(0)
  const lingxingRequestIdRef = React.useRef(0)

  const load = React.useCallback(async () => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    setError(null)
    setLingxingError(null)
    try {
      const accountId = context.accountId ?? "anonymous"
      const [nextSnapshot, nextActions, nextMembers] = await Promise.all([
        getTeamAppAccessSnapshot(context.team.id),
        getConnectionActions(app.service, { forceRefresh: true }),
        context.canManage ? getTeamMembersResource(accountId, context.team.id) : Promise.resolve([]),
      ])
      if (requestIdRef.current !== requestId) return
      setSnapshot(nextSnapshot)
      setActions(normalizeActions(localizeConnectionActions(app.service, nextActions.data, locale)))
      setMembers(nextMembers)
      const userIds = uniqueStrings(nextMembers.map((member) => member.user_id))
      if (userIds.length > 0) {
        const nextSummaries = await getTeamUserSummariesResource(accountId, context.team.id, userIds)
        if (requestIdRef.current === requestId) setSummaries(nextSummaries)
      }
    } catch (cause) {
      if (requestIdRef.current === requestId) setError(errorMessage(cause, t))
    } finally {
      if (requestIdRef.current === requestId) setLoading(false)
    }
  }, [app.id, app.service, context.accountId, context.canManage, context.team.id, context.team.name, locale, t])

  const loadLingxingUsers = React.useCallback(
    async (force = false) => {
      if (!context.canManage || app.service !== "lingxing" || lingxingLoading || (!force && lingxingLoaded)) return
      const requestId = lingxingRequestIdRef.current + 1
      lingxingRequestIdRef.current = requestId
      setLingxingError(null)
      setLingxingLoading(true)
      try {
        const result = await getConnectionLingxingErpUsers(
          app.id,
          { manageable: true, teamName: context.team.name },
          { forceRefresh: true },
        )
        if (lingxingRequestIdRef.current !== requestId) return
        setLingxingUsers(result.data)
        setLingxingLoaded(true)
      } catch (cause) {
        if (lingxingRequestIdRef.current === requestId) setLingxingError(lingxingErrorMessage(cause, t))
      } finally {
        if (lingxingRequestIdRef.current === requestId) setLingxingLoading(false)
      }
    },
    [app.id, app.service, context.canManage, context.team.name, lingxingLoaded, lingxingLoading, t],
  )

  React.useEffect(() => {
    if (!open) {
      lingxingRequestIdRef.current += 1
      return
    }
    lingxingRequestIdRef.current += 1
    setSnapshot(null)
    setActions([])
    setMembers([])
    setLingxingUsers([])
    setLingxingError(null)
    setLingxingLoading(false)
    setLingxingLoaded(false)
    setSummaries({})
    setEditor(null)
    setDeleteRule(null)
    setRestoreOpen(false)
    void load()
    return () => {
      requestIdRef.current += 1
    }
  }, [app.id, load, open])

  const memberIds = React.useMemo(() => members.map((member) => member.user_id), [members])
  const parsed = React.useMemo(
    () =>
      snapshot
        ? parseTeamConnectionAccess(
            snapshot.access,
            [{ id: app.id, service: app.service }],
            context.canManage ? memberIds : undefined,
            t("connections.accessNewRuleDefaultName", { count: 1 }),
          )
        : null,
    [app.id, app.service, context.canManage, memberIds, snapshot, t],
  )
  const appAccess = parsed?.ok ? (parsed.apps.find((item) => item.appId === app.id) ?? null) : null
  const policyError =
    error ??
    (parsed && !parsed.ok ? t("connections.accessInvalidDescription") : null) ??
    (appAccess?.mode === "invalid" ? t("connections.accessInvalidDescription") : null)

  async function mutate(
    transform: (access: TeamAppAccess, current: Exclude<ConnectionAppAccess, { mode: "invalid" }>) => TeamAppAccess,
  ) {
    if (!context.canManage || busy) return
    setBusy(true)
    try {
      const latest = await getTeamAppAccessSnapshot(context.team.id)
      const latestParsed = parseTeamConnectionAccess(
        latest.access,
        [{ id: app.id, service: app.service }],
        memberIds,
        t("connections.accessNewRuleDefaultName", { count: 1 }),
      )
      const current = latestParsed.ok ? latestParsed.apps.find((item) => item.appId === app.id) : null
      if (!latestParsed.ok || !current || current.mode === "invalid")
        throw new Error(t("connections.accessInvalidDescription"))
      if (!latest.etag) throw new Error(t("connections.accessConcurrencyUnavailable"))
      const updated = await updateTeamAppAccess(context.team.id, transform(latestParsed.access, current), {
        etag: latest.etag,
      })
      invalidateTeamDetailsResource(context.accountId, context.team.id)
      setSnapshot({ access: updated })
      setEditor(null)
      setDeleteRule(null)
      setRestoreOpen(false)
      toast.success(t("connections.accessSaved"))
    } catch (cause) {
      handleMutationError(cause)
    } finally {
      setBusy(false)
    }
  }

  async function restoreDefaults() {
    if (!context.canManage || busy) return
    setBusy(true)
    try {
      const latest = await getTeamAppAccessSnapshot(context.team.id)
      if (!latest.etag) throw new Error(t("connections.accessConcurrencyUnavailable"))
      const updated = await updateTeamAppAccess(context.team.id, restoreTeamConnectionDefaults(latest.access, app.id), {
        etag: latest.etag,
      })
      invalidateTeamDetailsResource(context.accountId, context.team.id)
      setSnapshot({ access: updated })
      setEditor(null)
      setDeleteRule(null)
      setRestoreOpen(false)
      toast.success(t("connections.accessSaved"))
    } catch (cause) {
      handleMutationError(cause)
    } finally {
      setBusy(false)
    }
  }

  function handleMutationError(cause: unknown) {
    if (isConnectionAccessConflict(cause)) {
      setEditor(null)
      setDeleteRule(null)
      setRestoreOpen(false)
      void load()
      toast.error(t("connections.accessConcurrencyConflict"))
      return
    }
    toast.error(errorMessage(cause, t))
  }

  function saveEditor(next: RuleEditorState) {
    void mutate((access, current) => {
      const rules = current.permissionRules
      if (next.kind === "default") {
        return setConnectionPermissionRules(access, app, { ...rules, teamDefault: next.grant })
      }
      const rule: ConnectionPermissionRule = {
        ...next.grant,
        id: next.ruleId,
        name: next.name.trim(),
      }
      const nextRules =
        next.kind === "new" ? [...rules.rules, rule] : rules.rules.map((item) => (item.id === rule.id ? rule : item))
      const selected = new Set(next.userIds)
      const assignments = Object.fromEntries(
        Object.entries(rules.assignments).filter(
          ([userId, assignedRuleId]) => assignedRuleId !== rule.id && !selected.has(userId),
        ),
      )
      for (const userId of next.userIds) assignments[userId] = rule.id
      return setConnectionPermissionRules(access, app, { ...rules, assignments, rules: nextRules })
    })
  }

  return (
    <>
      <Dialog
        open={open}
        onClose={busy ? () => undefined : onClose}
        title={t("connections.accessTitle")}
        description={t("connections.accessRulesDescription", { name: connectionLabel(app) })}
        className="max-w-4xl"
        contentClassName="px-4 py-4"
        footer={
          <div className="flex w-full justify-between gap-2">
            {canRestoreConnectionAccess(context.canManage, appAccess) ? (
              <Button type="button" variant="outline" disabled={busy} onClick={() => setRestoreOpen(true)}>
                <RotateCcw className="size-4" />
                {t("connections.accessRestoreDefaults")}
              </Button>
            ) : (
              <span />
            )}
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t("common.close")}
            </Button>
          </div>
        }
      >
        {loading && !snapshot ? (
          <AccessSkeleton />
        ) : policyError ? (
          <AccessError error={policyError} onRetry={() => void load()} />
        ) : appAccess && appAccess.mode !== "invalid" ? (
          context.canManage ? (
            <RuleManagement
              access={appAccess}
              actions={actions}
              members={members}
              summaries={summaries}
              onCreate={() =>
                setEditor({
                  grant: createConnectionPermissionRuleGrant(),
                  kind: "new",
                  name: t("connections.accessNewRuleDefaultName", {
                    count: appAccess.permissionRules.rules.length + 1,
                  }),
                  ruleId: createConnectionPermissionRuleId(),
                  userIds: [],
                })
              }
              onEditDefault={() =>
                setEditor({
                  grant: structuredClone(appAccess.permissionRules.teamDefault),
                  kind: "default",
                  name: t("connections.accessTeamDefault"),
                  ruleId: "",
                  userIds: [],
                })
              }
              onEditRule={(rule) =>
                setEditor({
                  grant: structuredClone(rule),
                  kind: "rule",
                  name: rule.name,
                  ruleId: rule.id,
                  userIds: getConnectionRuleMemberIds(appAccess.permissionRules, rule.id),
                })
              }
              onDeleteRule={setDeleteRule}
            />
          ) : (
            <CurrentUserAccess access={appAccess} actions={actions} userId={context.currentUserId} />
          )
        ) : null}
      </Dialog>

      {editor ? (
        <PermissionRuleEditor
          actions={actions}
          busy={busy}
          editor={editor}
          lingxingError={lingxingError}
          lingxingLoaded={lingxingLoaded}
          lingxingLoading={lingxingLoading}
          lingxingUsers={lingxingUsers}
          showLingxing={app.service === "lingxing"}
          members={members}
          summaries={summaries}
          onClose={() => setEditor(null)}
          onLoadLingxing={() => loadLingxingUsers()}
          onRetryLingxing={() => void loadLingxingUsers(true)}
          onSave={saveEditor}
        />
      ) : null}

      <ConfirmDialog open={deleteRule !== null} onOpenChange={(next) => !next && !busy && setDeleteRule(null)}>
        <ConfirmDialogContent overlayClassName="oo-modal-backdrop-nested">
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>{t("connections.accessDeleteRuleTitle")}</ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t("connections.accessDeleteRuleDescription", { name: deleteRule?.name ?? "" })}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel disabled={busy}>{t("common.cancel")}</ConfirmDialogCancel>
            <ConfirmDialogAction
              variant="destructive"
              disabled={busy || !deleteRule}
              onClick={() => {
                const target = deleteRule
                if (!target) return
                void mutate((access, current) =>
                  removeConnectionPermissionRule(access, app, current.permissionRules, target.id),
                )
              }}
            >
              {busy ? <Loader size={16} /> : <Trash2 className="size-4" />}
              {t("common.delete")}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>

      <ConfirmDialog open={restoreOpen} onOpenChange={(next) => !next && !busy && setRestoreOpen(false)}>
        <ConfirmDialogContent overlayClassName="oo-modal-backdrop-nested">
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>{t("connections.accessRepairTitle")}</ConfirmDialogTitle>
            <ConfirmDialogDescription>{t("connections.accessRulesRestoreDescription")}</ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel disabled={busy}>{t("common.cancel")}</ConfirmDialogCancel>
            <ConfirmDialogAction variant="destructive" disabled={busy} onClick={() => void restoreDefaults()}>
              {busy ? <Loader size={16} /> : <RotateCcw className="size-4" />}
              {t("connections.accessRestoreDefaults")}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </>
  )
}

function RuleManagement({
  access,
  actions,
  members,
  onCreate,
  onDeleteRule,
  onEditDefault,
  onEditRule,
  summaries,
}: {
  access: Exclude<ConnectionAppAccess, { mode: "invalid" }>
  actions: ConnectionActionCatalogItem[]
  members: TeamMember[]
  onCreate: () => void
  onDeleteRule: (rule: ConnectionPermissionRule) => void
  onEditDefault: () => void
  onEditRule: (rule: ConnectionPermissionRule) => void
  summaries: Record<string, TeamUserSummary>
}) {
  const t = useT()
  const assigned = new Set(Object.keys(access.permissionRules.assignments))
  const defaultMemberIds = members.map((member) => member.user_id).filter((userId) => !assigned.has(userId))
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="oo-text-title">{t("connections.accessRulesTitle")}</h3>
          <p className="oo-text-caption oo-text-muted mt-1">{t("connections.accessRulesHint")}</p>
        </div>
        <Button size="sm" onClick={onCreate}>
          <Plus className="size-4" />
          {t("connections.accessAddRule")}
        </Button>
      </div>
      <RuleCard
        badge={t("connections.accessRemainingMembers", { count: defaultMemberIds.length })}
        grant={access.permissionRules.teamDefault}
        memberNames={defaultMemberIds.slice(0, 4).map((id) => memberLabel(id, summaries))}
        name={t("connections.accessTeamDefault")}
        actions={actions}
        onEdit={onEditDefault}
      />
      {access.permissionRules.rules.map((rule) => {
        const userIds = getConnectionRuleMemberIds(access.permissionRules, rule.id)
        return (
          <RuleCard
            key={rule.id}
            badge={t("connections.accessAssignedMembers", { count: userIds.length })}
            grant={rule}
            memberNames={userIds.slice(0, 4).map((id) => memberLabel(id, summaries))}
            name={rule.name}
            actions={actions}
            onDelete={() => onDeleteRule(rule)}
            onEdit={() => onEditRule(rule)}
          />
        )
      })}
    </div>
  )
}

function RuleCard({
  actions,
  badge,
  grant,
  memberNames,
  name,
  onDelete,
  onEdit,
}: {
  actions: ConnectionActionCatalogItem[]
  badge: string
  grant: ConnectionPermissionGrant
  memberNames: string[]
  name: string
  onDelete?: () => void
  onEdit: () => void
}) {
  const t = useT()
  return (
    <section className="grid gap-3 rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="oo-text-label truncate">{name}</h4>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{badge}</span>
          </div>
          <p className="oo-text-caption oo-text-muted mt-1">{grantSummary(grant, actions, t)}</p>
          {memberNames.length > 0 ? (
            <p className="oo-text-micro oo-text-muted mt-1 truncate">{memberNames.join(" · ")}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="icon" variant="ghost" title={t("common.edit")} onClick={onEdit}>
            <Pencil className="size-4" />
          </Button>
          {onDelete ? (
            <Button size="icon" variant="ghost" title={t("common.delete")} onClick={onDelete}>
              <Trash2 className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function PermissionRuleEditor({
  actions,
  busy,
  editor,
  lingxingError,
  lingxingLoaded,
  lingxingLoading,
  lingxingUsers,
  showLingxing,
  members,
  onClose,
  onLoadLingxing,
  onRetryLingxing,
  onSave,
  summaries,
}: {
  actions: ConnectionActionCatalogItem[]
  busy: boolean
  editor: RuleEditorState
  lingxingError: string | null
  lingxingLoaded: boolean
  lingxingLoading: boolean
  lingxingUsers: ConnectionLingxingErpUser[]
  showLingxing: boolean
  members: TeamMember[]
  onClose: () => void
  onLoadLingxing: () => Promise<void>
  onRetryLingxing: () => void
  onSave: (editor: RuleEditorState) => void
  summaries: Record<string, TeamUserSummary>
}) {
  const t = useT()
  const [draft, setDraft] = React.useState(() => structuredClone(editor))
  const [query, setQuery] = React.useState("")
  const filteredMembers = members.filter(
    (member) =>
      memberLabel(member.user_id, summaries).toLowerCase().includes(query.trim().toLowerCase()) ||
      member.user_id.toLowerCase().includes(query.trim().toLowerCase()),
  )
  const valid = draft.kind === "default" || draft.name.trim().length > 0
  const lingxingAccess = getConnectionLingxingUserAccess(draft.grant)
  React.useEffect(() => {
    if (
      !showLingxing ||
      lingxingAccess.mode !== "selected" ||
      lingxingUsers.length > 0 ||
      lingxingError ||
      lingxingLoaded ||
      lingxingLoading
    )
      return
    void onLoadLingxing()
  }, [
    lingxingAccess.mode,
    lingxingError,
    lingxingLoaded,
    lingxingLoading,
    lingxingUsers.length,
    onLoadLingxing,
    showLingxing,
  ])
  return (
    <Dialog
      open
      onClose={busy ? () => undefined : onClose}
      title={draft.kind === "new" ? t("connections.accessCreateRule") : t("connections.accessEditRule")}
      description={
        draft.kind === "default"
          ? t("connections.accessDefaultRuleDescription")
          : t("connections.accessCustomRuleDescription")
      }
      className="max-w-3xl"
      contentClassName="px-4 py-4"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={busy || !valid} onClick={() => onSave(draft)}>
            {busy ? <Loader size={16} /> : <ShieldCheck className="size-4" />}
            {t("common.save")}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        {draft.kind !== "default" ? (
          <label className="grid gap-1.5">
            <span className="oo-text-label">{t("connections.accessRuleName")}</span>
            <Input
              value={draft.name}
              disabled={busy}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            />
          </label>
        ) : null}
        {draft.kind !== "default" ? (
          <section className="grid gap-2 rounded-md border p-3">
            <div>
              <h3 className="oo-text-label flex items-center gap-2">
                <Users className="size-4" />
                {t("connections.accessRuleMembers")}
              </h3>
              <p className="oo-text-caption oo-text-muted mt-1">{t("connections.accessRuleMembersDescription")}</p>
            </div>
            {members.length > 8 ? (
              <div className="relative">
                <Search className="oo-icon-muted pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                <Input
                  className="pl-8"
                  value={query}
                  placeholder={t("connections.memberSearch")}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            ) : null}
            <div className="max-h-56 overflow-auto rounded-md border">
              {filteredMembers.map((member) => (
                <CheckboxRow
                  key={member.user_id}
                  checked={draft.userIds.includes(member.user_id)}
                  disabled={busy}
                  label={memberLabel(member.user_id, summaries)}
                  secondary={member.user_id}
                  onChange={(checked) =>
                    setDraft((current) => ({
                      ...current,
                      userIds: toggleString(current.userIds, member.user_id, checked),
                    }))
                  }
                />
              ))}
            </div>
          </section>
        ) : null}
        <ActionEditor
          actions={actions}
          busy={busy}
          value={draft.grant.actionAccess}
          onChange={(actionAccess) =>
            setDraft((current) => ({ ...current, grant: { ...current.grant, actionAccess } }))
          }
        />
        {showLingxing ? (
          <LingxingAccessEditor
            busy={busy}
            error={lingxingError}
            loading={lingxingLoading}
            onRetry={onRetryLingxing}
            users={lingxingUsers}
            value={lingxingAccess}
            onChange={(value) =>
              setDraft((current) => ({
                ...current,
                grant: setConnectionLingxingUserAccess(current.grant, value),
              }))
            }
          />
        ) : draft.grant.appAccessConfig ? (
          <div className="rounded-md border border-[var(--oo-warning-border)] bg-[var(--oo-warning-surface)] p-3 text-sm">
            {t("connections.accessProviderConfigPreserved")}
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}

function LingxingAccessEditor({
  busy,
  error,
  loading,
  onChange,
  onRetry,
  users,
  value,
}: {
  busy: boolean
  error: string | null
  loading: boolean
  onChange: (value: ConnectionLingxingUserAccess) => void
  onRetry: () => void
  users: ConnectionLingxingErpUser[]
  value: ConnectionLingxingUserAccess
}) {
  const t = useT()
  const selected = value.mode === "selected" ? new Set(value.users.map((user) => user.uid)) : new Set<string>()
  return (
    <section className="grid gap-3 rounded-md border p-3">
      <div>
        <h3 className="oo-text-label">{t("connections.accessLingxingTitle")}</h3>
        <p className="oo-text-caption oo-text-muted mt-1">{t("connections.accessLingxingDescription")}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <ModeButton
          active={value.mode === "all"}
          disabled={busy}
          label={t("connections.accessLingxingAll")}
          onClick={() => onChange({ mode: "all" })}
        />
        <ModeButton
          active={value.mode === "selected"}
          disabled={busy}
          label={t("connections.accessLingxingSelected")}
          onClick={() => onChange({ mode: "selected", users: value.mode === "selected" ? value.users : [] })}
        />
      </div>
      {error ? (
        <div className="grid gap-2 rounded-md border border-[var(--oo-warning-border)] bg-[var(--oo-warning-surface)] p-3">
          <div className="oo-text-caption flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" disabled={busy} onClick={onRetry}>
              {t("teams.retry")}
            </Button>
          </div>
        </div>
      ) : null}
      {value.mode === "selected" ? (
        <div className="max-h-56 overflow-auto rounded-md border">
          {loading ? (
            <div className="oo-text-caption oo-text-muted flex items-center gap-2 p-3">
              <Loader size={16} />
              {t("connections.actionLoading")}
            </div>
          ) : users.length === 0 && value.users.length === 0 ? (
            <div className="oo-text-caption oo-text-muted p-3">{t("connections.accessLingxingEmpty")}</div>
          ) : (
            <>
              {users.map((user) => (
                <CheckboxRow
                  key={user.id}
                  checked={selected.has(user.id)}
                  disabled={busy}
                  label={user.displayName?.trim() || user.username?.trim() || user.id}
                  secondary={
                    user.username && user.username !== user.displayName ? `${user.username} · ${user.id}` : user.id
                  }
                  onChange={(checked) => {
                    const current = value.users.filter((item) => item.uid !== user.id)
                    onChange({
                      mode: "selected",
                      users: checked
                        ? [
                            ...current,
                            {
                              uid: user.id,
                              ...(user.displayName?.trim() ? { realname: user.displayName.trim() } : {}),
                              ...(user.username?.trim() ? { username: user.username.trim() } : {}),
                            },
                          ]
                        : current,
                    })
                  }}
                />
              ))}
              {value.users
                .filter((stored) => !users.some((user) => user.id === stored.uid))
                .map((stored) => (
                  <CheckboxRow
                    key={stored.uid}
                    checked
                    disabled={busy}
                    label={stored.realname || stored.username || stored.uid}
                    secondary={t("connections.accessLingxingUnavailable")}
                    onChange={(checked) => {
                      if (!checked) {
                        onChange({
                          mode: "selected",
                          users: value.users.filter((item) => item.uid !== stored.uid),
                        })
                      }
                    }}
                  />
                ))}
            </>
          )}
        </div>
      ) : null}
    </section>
  )
}

function ActionEditor({
  actions,
  busy,
  onChange,
  value,
}: {
  actions: ConnectionActionCatalogItem[]
  busy: boolean
  onChange: (value: ConnectionActionAccess) => void
  value: ConnectionActionAccess
}) {
  const t = useT()
  const [query, setQuery] = React.useState("")
  const [expanded, setExpanded] = React.useState<Set<OperationType>>(() => new Set())
  const selected = value.mode === "restricted" ? value.actionNames : []
  const selectedSet = React.useMemo(() => new Set(selected), [selected])
  const filtered = filterActions(actions, query)
  const unavailable = unavailableActionNames(selected, actions)
  return (
    <section className="grid gap-3 rounded-md border p-3">
      <div>
        <h3 className="oo-text-label flex items-center gap-2">
          <ShieldCheck className="size-4" />
          {t("connections.actionAccessTitle")}
        </h3>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <ModeButton
          active={value.mode === "unrestricted"}
          disabled={busy}
          label={t("connections.actionAccessUnrestricted")}
          onClick={() => onChange({ mode: "unrestricted" })}
        />
        <ModeButton
          active={value.mode === "restricted"}
          disabled={busy}
          label={t("connections.actionAccessRestricted")}
          onClick={() =>
            onChange({
              actionNames: value.mode === "restricted" ? value.actionNames : defaultRestrictedActionNames(actions),
              mode: "restricted",
            })
          }
        />
      </div>
      {value.mode === "restricted" ? (
        <>
          <div className="relative">
            <Search className="oo-icon-muted pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              className="pl-8"
              value={query}
              placeholder={t("connections.actionSearch")}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="overflow-hidden rounded-md border">
            {operationTypes.map((operationType) => {
              const group = filtered.filter((action) => action.operationType === operationType)
              if (group.length === 0) return null
              const names = group.map((action) => action.name)
              const selectedCount = names.filter((name) => selectedSet.has(name)).length
              const open = expanded.has(operationType)
              return (
                <div key={operationType} className="border-b last:border-b-0">
                  <button
                    type="button"
                    className="flex min-h-10 w-full items-center gap-2 bg-muted/20 px-3 text-left"
                    onClick={() =>
                      setExpanded((current) => {
                        const next = new Set(current)
                        if (open) next.delete(operationType)
                        else next.add(operationType)
                        return next
                      })
                    }
                  >
                    {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    <span className="flex-1 font-medium">{operationTypeLabel(operationType, t)}</span>
                    <span className="text-xs text-muted-foreground">
                      {selectedCount} / {names.length}
                    </span>
                  </button>
                  {open ? (
                    <div className="divide-y border-t">
                      {group.map((action) => (
                        <CheckboxRow
                          key={action.id}
                          checked={selectedSet.has(action.name)}
                          disabled={busy}
                          label={action.name}
                          secondary={action.description}
                          onChange={(checked) =>
                            onChange({
                              actionNames: updateActionSelection(selected, [action.name], checked),
                              mode: "restricted",
                            })
                          }
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })}
            {unavailable.map((name) => (
              <CheckboxRow
                key={name}
                checked
                disabled={busy}
                label={name}
                secondary={t("connections.actionUnavailable")}
                onChange={(checked) =>
                  onChange({ actionNames: updateActionSelection(selected, [name], checked), mode: "restricted" })
                }
              />
            ))}
          </div>
          <p className="oo-text-caption text-[var(--oo-warning-foreground)]">
            {t("connections.actionAccessProxyWarning")}
          </p>
        </>
      ) : null}
    </section>
  )
}

function CurrentUserAccess({
  access,
  actions,
  userId,
}: {
  access: Exclude<ConnectionAppAccess, { mode: "invalid" }>
  actions: ConnectionActionCatalogItem[]
  userId?: string
}) {
  const t = useT()
  const rule = userId ? getConnectionPermissionRule(access, userId) : null
  const grant = userId ? getConnectionPermissionGrant(access, userId) : access.permissionRules.teamDefault
  if (!grant) return <AccessError error={t("connections.accessInvalidDescription")} onRetry={() => undefined} />
  return (
    <section className="grid gap-2 rounded-md border p-4">
      <h3 className="oo-text-title">{rule?.name ?? t("connections.accessTeamDefault")}</h3>
      <p className="oo-text-body">{grantSummary(grant, actions, t)}</p>
      <p className="oo-text-caption oo-text-muted">{t("connections.accessReadOnlyRuleDescription")}</p>
    </section>
  )
}

function ModeButton({
  active,
  disabled,
  label,
  onClick,
}: {
  active: boolean
  disabled: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      className={cn(
        "min-h-12 rounded-md border px-3 py-2 text-left",
        active ? "border-foreground bg-muted/50" : "hover:bg-muted/30",
        disabled && "opacity-60",
      )}
      onClick={onClick}
    >
      <span className="oo-text-control font-medium">{label}</span>
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

function AccessError({ error, onRetry }: { error: string; onRetry: () => void }) {
  const t = useT()
  return (
    <div className="grid gap-3 rounded-md border border-[var(--oo-danger-border)] bg-[var(--oo-danger-surface)] p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div>
          <div className="oo-text-label">{t("connections.accessInvalidTitle")}</div>
          <div className="oo-text-caption oo-text-muted mt-1 break-words">{error}</div>
        </div>
      </div>
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t("teams.retry")}
        </Button>
      </div>
    </div>
  )
}

function AccessSkeleton() {
  return (
    <div className="grid gap-3" aria-hidden="true">
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-24 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  )
}

function grantSummary(
  grant: ConnectionPermissionGrant,
  actions: ConnectionActionCatalogItem[],
  t: ReturnType<typeof useT>,
): string {
  const actionSummary =
    grant.actionAccess.mode === "unrestricted"
      ? t("connections.actionAccessUnrestrictedSummary")
      : grant.actionAccess.actionNames.length === 0
        ? t("connections.actionAccessDeniedSummary")
        : t("connections.actionAccessRestrictedSummary", {
            allowed: grant.actionAccess.actionNames.length,
            total: actions.length,
          })
  const lingxingAccess = getConnectionLingxingUserAccess(grant)
  if (lingxingAccess.mode !== "selected") return actionSummary
  const names = lingxingAccess.users
    .map((user) => user.realname || user.username || user.uid)
    .join(t("connections.accessLingxingNameSeparator"))
  return `${actionSummary} · ${
    names
      ? t("connections.accessLingxingResponsibleNames", { names })
      : t("connections.accessLingxingNoResponsibleUsers")
  }`
}

function normalizeActions(actions: ConnectionActionCatalogItem[]): ConnectionActionCatalogItem[] {
  return [...actions].sort(
    (left, right) =>
      operationTypes.indexOf(left.operationType) - operationTypes.indexOf(right.operationType) ||
      left.name.localeCompare(right.name),
  )
}
function filterActions(actions: ConnectionActionCatalogItem[], query: string): ConnectionActionCatalogItem[] {
  const normalized = query.trim().toLowerCase()
  return normalized
    ? actions.filter(
        (action) =>
          action.name.toLowerCase().includes(normalized) || action.description.toLowerCase().includes(normalized),
      )
    : actions
}
function operationTypeLabel(type: OperationType, t: ReturnType<typeof useT>): string {
  return type === "read"
    ? t("connections.actionTypeRead")
    : type === "write"
      ? t("connections.actionTypeWrite")
      : t("connections.actionTypeDestructive")
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
function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort()
}
function errorMessage(error: unknown, t: ReturnType<typeof useT>): string {
  if (error instanceof Error && error.message) return error.message
  const resolved = resolveUserFacingError(error)
  return userFacingErrorDescription(resolved, t) ?? t("common.error")
}

function lingxingErrorMessage(error: unknown, t: ReturnType<typeof useT>): string {
  if (error instanceof ConnectorRequestError) {
    const key =
      error.status === 403
        ? "connections.accessLingxingForbidden"
        : error.status === 404
          ? "connections.accessLingxingNotFound"
          : error.status === 409
            ? "connections.accessLingxingNotReady"
            : error.status === 429
              ? "connections.accessLingxingRateLimited"
              : error.status === 502
                ? "connections.accessLingxingUnavailableService"
                : null
    if (key) return t(key)
  }
  return t("connections.accessLingxingLoadFailed", { error: errorMessage(error, t) })
}
