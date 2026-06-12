import type {
  ConnectionAccount,
  ConnectionAction,
  ConnectionAuthType,
  ConnectionExecution,
  ConnectionProvider,
  ConnectionProviderDetail,
} from "../../../electron/connections/common"
import type { UseConnections } from "@/hooks/useConnections"

import { ArrowLeft, Check, ChevronDown, Copy, ExternalLink, Pencil, Plug, Plus, Unplug } from "lucide-react"
import * as React from "react"
import { ProviderIcon } from "./ProviderIcon"
import { authTypeLabel, formatTimestamp, pickAuthType } from "./shared"
import { Loader } from "@/components/ai-elements/loader"
import { Task, TaskContent, TaskTrigger } from "@/components/ai-elements/task"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

interface ProviderDetailProps {
  provider: ConnectionProvider
  connections: UseConnections
  onBack: () => void
  onStartConnect: (detail: ConnectionProviderDetail, authType: ConnectionAuthType, appId?: string) => void
}

export function ProviderDetail({ provider, connections, onBack, onStartConnect }: ProviderDetailProps) {
  const t = useT()
  const { getProviderDetail, listAccounts, listActions, listExecutions, openExternal } = connections
  const service = provider.service
  const summaryStamp = connections.summary?.updatedAt

  const [detail, setDetail] = React.useState<ConnectionProviderDetail | null>(null)
  const [accounts, setAccounts] = React.useState<ConnectionAccount[]>([])
  const [actions, setActions] = React.useState<ConnectionAction[]>([])
  const [executions, setExecutions] = React.useState<ConnectionExecution[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)

  // detail / actions 与连接状态无关，按 service 加载一次。
  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void Promise.all([getProviderDetail(service), listActions(service)])
      .then(([d, a]) => {
        if (!cancelled) {
          setDetail(d)
          setActions(a)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [service, getProviderDetail, listActions])

  // accounts / executions 随连接状态变化（summary 广播后）刷新。
  React.useEffect(() => {
    let cancelled = false
    void Promise.all([listAccounts(service), listExecutions(service).catch(() => [])])
      .then(([accs, execs]) => {
        if (!cancelled) {
          setAccounts(accs)
          setExecutions(execs)
        }
      })
      .catch(() => {
        // 账号列表失败不阻断详情主体。
      })
    return () => {
      cancelled = true
    }
  }, [service, summaryStamp, listAccounts, listExecutions])

  // 选中账号：保持已选 / 退回默认 / 首个。
  React.useEffect(() => {
    if (accounts.length === 0) {
      setSelectedId(null)
      return
    }
    setSelectedId((prev) => {
      if (prev && accounts.some((a) => a.id === prev)) {
        return prev
      }
      return (accounts.find((a) => a.isDefault) ?? accounts[0]).id
    })
  }, [accounts])

  const authType = detail ? pickAuthType(detail.authTypes) : pickAuthType(provider.authTypes)
  const selected = accounts.find((a) => a.id === selectedId) ?? null

  const startConnect = (appId?: string): void => {
    if (!detail || !authType) {
      return
    }
    onStartConnect(detail, authType, appId)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 顶部：返回 + 标识 + 官网 */}
      <div className="flex items-center gap-2 pb-3">
        <button
          type="button"
          aria-label={t("common.cancel")}
          onClick={onBack}
          className="oo-toolbar-button flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </button>
        <ProviderIcon iconUrl={detail?.iconUrl ?? provider.iconUrl} displayName={provider.displayName} />
        <div className="min-w-0 flex-1">
          <div className="oo-text-title truncate">{provider.displayName}</div>
          <div className="oo-text-micro flex items-center gap-1.5">
            <span className="truncate font-mono">{service}</span>
            {authType && <Badge variant="outline">{authTypeLabel(t, authType)}</Badge>}
          </div>
        </div>
        {detail?.homepageUrl && (
          <button
            type="button"
            onClick={() => void openExternal(detail.homepageUrl as string)}
            className="oo-text-micro oo-toolbar-button flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 hover:bg-accent hover:text-foreground"
          >
            {t("connections.homepage")}
            <ExternalLink className="size-3" />
          </button>
        )}
      </div>

      {error && <div className="oo-error oo-text-micro mb-2">{error}</div>}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-2">
        {loading && !detail ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader className="oo-icon-muted" size={16} />
          </div>
        ) : (
          <>
            {accounts.length === 0 ? (
              <EmptyAccount authType={authType} busy={connections.busy === service} onConnect={() => startConnect()} />
            ) : (
              <AccountCard
                accounts={accounts}
                selected={selected}
                authType={authType}
                connections={connections}
                onSelect={setSelectedId}
                onReconnect={(appId) => startConnect(appId)}
                onAddAccount={() => startConnect()}
              />
            )}

            <CollapsibleSection title={t("connections.executions")} count={executions.length} defaultOpen={false}>
              {executions.length === 0 ? (
                <p className="oo-text-caption py-3 text-center">{t("connections.noData")}</p>
              ) : (
                <div className="grid gap-1.5">
                  {executions.map((e) => (
                    <ExecutionRow key={e.executionId} execution={e} />
                  ))}
                </div>
              )}
            </CollapsibleSection>

            <CollapsibleSection title={t("connections.interfaces")} count={actions.length} defaultOpen={false}>
              {actions.length === 0 ? (
                <p className="oo-text-caption py-3 text-center">{t("connections.noData")}</p>
              ) : (
                <div className="grid gap-1.5">
                  {actions.map((a) => (
                    <ActionRow key={a.id} action={a} />
                  ))}
                </div>
              )}
            </CollapsibleSection>
          </>
        )}
      </div>
    </div>
  )
}

function EmptyAccount({
  authType,
  busy,
  onConnect,
}: {
  authType: ConnectionAuthType | null
  busy: boolean
  onConnect: () => void
}) {
  const t = useT()
  return (
    <div className="oo-border-divider flex flex-col items-center gap-3 rounded-lg border py-10">
      <p className="oo-text-caption">{t("connections.noAccount")}</p>
      {authType && (
        <Button className="gap-1.5" disabled={busy} onClick={onConnect}>
          {busy ? <Loader size={16} /> : <Plug className="size-4" />}
          {t("connections.connect")}
        </Button>
      )}
    </div>
  )
}

function AccountCard({
  accounts,
  selected,
  authType,
  connections,
  onSelect,
  onReconnect,
  onAddAccount,
}: {
  accounts: ConnectionAccount[]
  selected: ConnectionAccount | null
  authType: ConnectionAuthType | null
  connections: UseConnections
  onSelect: (id: string) => void
  onReconnect: (appId: string) => void
  onAddAccount: () => void
}) {
  const t = useT()
  if (!selected) {
    return null
  }
  const busy = connections.busy === selected.service

  return (
    <div className="oo-border-divider grid gap-3 rounded-lg border p-3">
      {/* 账号选择 + 添加账号 */}
      <div className="flex items-center gap-2">
        {accounts.length > 1 ? (
          <select
            value={selected.id}
            onChange={(e) => onSelect(e.target.value)}
            className="oo-input-surface oo-text-control h-8 min-w-0 flex-1 rounded-md border px-2 outline-none"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.alias || a.accountLabel}
              </option>
            ))}
          </select>
        ) : (
          <div className="oo-text-control min-w-0 flex-1 truncate font-medium">
            {selected.alias || selected.accountLabel}
          </div>
        )}
        <Button size="sm" variant="outline" className="gap-1" onClick={onAddAccount}>
          <Plus className="size-3.5" />
          {t("connections.addAccount")}
        </Button>
      </div>

      <dl className="grid gap-2">
        <AliasRow account={selected} onSave={(alias) => void connections.updateAlias(selected.id, alias)} />
        <Row label={t("connections.statusLabel")}>
          <span className="inline-flex items-center gap-1.5">
            <span
              className={cn(
                "size-1.5 rounded-full",
                selected.status === "active" ? "bg-[var(--success)]" : "bg-[var(--warning)]",
              )}
            />
            {selected.status === "active" ? t("connections.active") : selected.status}
          </span>
        </Row>
        {authType && <Row label={t("connections.authLabel")}>{authTypeLabel(t, authType)}</Row>}
        <Row label={t("connections.default")}>
          {selected.isDefault ? (
            <span className="oo-status-ready inline-flex items-center gap-1">
              <Check className="size-3.5" />
              {t("connections.defaultOn")}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void connections.setDefaultAccount(selected.service, selected.id)}
              className="oo-text-accent"
            >
              {t("connections.setDefault")}
            </button>
          )}
        </Row>
        <Row label={t("connections.updatedAt")}>{formatTimestamp(selected.updatedAt)}</Row>
        <Row label={t("connections.appId")}>
          <CopyInline value={selected.id} />
        </Row>
      </dl>

      <div className="flex items-center gap-2">
        {authType && authType !== "no_auth" && (
          <Button size="sm" className="gap-1.5" disabled={busy} onClick={() => onReconnect(selected.id)}>
            {busy ? <Loader size={14} /> : <Plug className="size-3.5" />}
            {t("connections.reconnect")}
          </Button>
        )}
        {connections.summary?.providers.find((p) => p.service === selected.service)?.canDisconnect !== false && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={busy}
            onClick={() => void connections.disconnectAccount(selected.id)}
          >
            <Unplug className="size-3.5" />
            {t("connections.disconnect")}
          </Button>
        )}
      </div>
    </div>
  )
}

function AliasRow({ account, onSave }: { account: ConnectionAccount; onSave: (alias: string) => void }) {
  const t = useT()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(account.alias ?? "")

  React.useEffect(() => {
    setDraft(account.alias ?? "")
    setEditing(false)
  }, [account.id, account.alias])

  if (editing) {
    return (
      <div className="grid grid-cols-[auto_1fr] items-center gap-3">
        <dt className="oo-text-caption">{t("connections.alias")}</dt>
        <input
          autoFocus
          value={draft}
          placeholder={t("connections.aliasPlaceholder")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false)
            if (draft !== (account.alias ?? "")) {
              onSave(draft)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur()
            } else if (e.key === "Escape") {
              setDraft(account.alias ?? "")
              setEditing(false)
            }
          }}
          className="oo-input-surface oo-text-control h-7 w-full rounded-md border px-2 outline-none"
        />
      </div>
    )
  }

  return (
    <Row label={t("connections.alias")}>
      <button type="button" onClick={() => setEditing(true)} className="group flex items-center gap-1.5">
        <span className={cn(!account.alias && "oo-text-muted")}>{account.alias || t("connections.aliasEmpty")}</span>
        <Pencil className="oo-icon-muted size-3 opacity-0 group-hover:opacity-100" />
      </button>
    </Row>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-3">
      <dt className="oo-text-caption">{label}</dt>
      <dd className="oo-text-control min-w-0 truncate">{children}</dd>
    </div>
  )
}

function CopyInline({ value }: { value: string }) {
  const t = useT()
  const [copied, setCopied] = React.useState(false)
  return (
    <button
      type="button"
      aria-label={t("connections.copy")}
      onClick={() => {
        void navigator.clipboard?.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
      className="group inline-flex max-w-full items-center gap-1.5"
    >
      <span className="truncate font-mono text-[length:var(--oo-font-micro)]">{value}</span>
      {copied ? (
        <Check className="oo-status-ready size-3 shrink-0" />
      ) : (
        <Copy className="oo-icon-muted size-3 shrink-0 opacity-60 group-hover:opacity-100" />
      )}
    </button>
  )
}

function CollapsibleSection({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string
  count: number
  defaultOpen: boolean
  children: React.ReactNode
}) {
  return (
    <Task defaultOpen={defaultOpen} className="oo-border-divider rounded-lg border">
      <TaskTrigger title={title} className="px-3 py-2.5">
        <div className="flex w-full cursor-pointer items-center gap-2">
          <span className="oo-text-title flex-1 text-left">{title}</span>
          <Badge variant="muted">{count}</Badge>
          <ChevronDown className="oo-icon-muted size-4 transition-transform group-data-[state=open]:rotate-180" />
        </div>
      </TaskTrigger>
      <TaskContent className="px-3">{children}</TaskContent>
    </Task>
  )
}

function ExecutionRow({ execution }: { execution: ConnectionExecution }) {
  const t = useT()
  return (
    <div className="oo-border-divider flex items-center gap-2 rounded-md border px-2.5 py-2">
      <div className="min-w-0 flex-1">
        <div className="oo-text-control truncate font-mono">{execution.action}</div>
        {execution.finishedAt && <div className="oo-text-micro truncate">{execution.finishedAt}</div>}
      </div>
      <Badge variant={execution.status === "success" ? "success" : "warning"}>
        {execution.status === "success" ? t("connections.statusSuccess") : t("connections.statusError")}
      </Badge>
    </div>
  )
}

function ActionRow({ action }: { action: ConnectionAction }) {
  const t = useT()
  const [copied, setCopied] = React.useState(false)
  return (
    <div className="oo-border-divider rounded-md border px-2.5 py-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="oo-text-control truncate font-medium">{action.name}</div>
          {action.description && <p className="oo-text-micro mt-0.5 line-clamp-2">{action.description}</p>}
        </div>
        <button
          type="button"
          aria-label={t("connections.copy")}
          onClick={() => {
            void navigator.clipboard?.writeText(action.id)
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          }}
          className="oo-icon-muted flex size-6 shrink-0 items-center justify-center rounded hover:bg-accent hover:text-foreground"
        >
          {copied ? <Check className="oo-status-ready size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
      {action.requiredScopes.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {action.requiredScopes.map((scope) => (
            <Badge key={scope} variant="outline">
              {scope}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
