import type {
  ConnectionAuthType,
  ConnectionProvider,
  ConnectionProviderDetail,
} from "../../../electron/connections/common"
import type { UseConnections } from "@/hooks/useConnections"

import { ChevronRight, Plug, RefreshCw, Search } from "lucide-react"
import * as React from "react"
import { ConnectDialog } from "./ConnectDialog"
import { ProviderDetail } from "./ProviderDetail"
import { ProviderIcon } from "./ProviderIcon"
import { pickAuthType } from "./shared"
import { Loader } from "@/components/ai-elements/loader"
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

const MAX_SUGGESTIONS = 24
const MAX_FILTERED = 80
const TOP_CATEGORIES = 8

const ALL = "__all__"
const CONNECTED = "__connected__"

/** 不需要表单、可一键直连的鉴权类型。 */
function isDirectConnect(authType: ConnectionAuthType): boolean {
  return authType === "oauth2" || authType === "no_auth"
}

function ProviderRow({
  provider,
  busy,
  polling,
  highlighted,
  onOpenDetail,
  onConnect,
  onCancelPolling,
}: {
  provider: ConnectionProvider
  busy: boolean
  polling: boolean
  highlighted: boolean
  onOpenDetail: () => void
  onConnect: () => void
  onCancelPolling: () => void
}) {
  const t = useT()
  const rowRef = React.useRef<HTMLDivElement>(null)
  const authType = pickAuthType(provider.authTypes)

  React.useEffect(() => {
    if (highlighted) {
      rowRef.current?.scrollIntoView({ block: "nearest" })
    }
  }, [highlighted])

  const subtitle = provider.connected
    ? (provider.accountLabel ?? provider.categories[0] ?? provider.service)
    : (provider.categories[0] ?? provider.service)

  return (
    <div
      ref={rowRef}
      className={cn(
        "group flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-accent",
        highlighted && "ring-2 ring-[var(--accent-strong)]",
      )}
    >
      <button type="button" onClick={onOpenDetail} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <ProviderIcon iconUrl={provider.iconUrl} displayName={provider.displayName} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="oo-text-control truncate font-medium">{provider.displayName}</span>
            {provider.status === "connected" && <Badge variant="success">{t("connections.connected")}</Badge>}
            {provider.status === "needs_attention" && (
              <Badge variant="warning">{t("connections.needsAttention")}</Badge>
            )}
          </div>
          <div className="oo-text-micro truncate">{subtitle}</div>
        </div>
      </button>

      <div className="flex shrink-0 items-center">
        {polling ? (
          <span className="oo-text-micro oo-text-muted flex items-center gap-1">
            <Loader size={14} />
            {t("connections.waiting")}
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onCancelPolling}>
              {t("common.cancel")}
            </Button>
          </span>
        ) : busy ? (
          <Loader className="oo-icon-muted mr-2" size={16} />
        ) : provider.connected ? (
          <button
            type="button"
            onClick={onOpenDetail}
            className="oo-text-micro oo-toolbar-button flex items-center gap-0.5 rounded-md py-1 pr-1 pl-2 hover:text-foreground"
          >
            {t("connections.manage")}
            <ChevronRight className="size-3.5" />
          </button>
        ) : authType ? (
          <button
            type="button"
            onClick={onConnect}
            className="oo-text-accent flex items-center gap-0.5 rounded-md py-1 pr-1 pl-2 text-[length:var(--oo-font-micro)] font-medium"
          >
            {t("connections.connect")}
            <ChevronRight className="size-3.5" />
          </button>
        ) : (
          <span className="oo-text-micro oo-text-muted pr-1">{t("connections.unsupported")}</span>
        )}
      </div>
    </div>
  )
}

function CategoryChips({
  category,
  onChange,
  total,
  connectedCount,
  categories,
}: {
  category: string
  onChange: (value: string) => void
  total: number
  connectedCount: number
  categories: Array<[string, number]>
}) {
  const t = useT()
  const chip = (value: string, label: string, count: number) => (
    <Suggestion
      key={value}
      suggestion={value}
      size="sm"
      variant={category === value ? "default" : "outline"}
      className="gap-1.5"
      onClick={onChange}
    >
      <span>{label}</span>
      <span className={cn(category === value ? "opacity-80" : "oo-text-muted")}>{count}</span>
    </Suggestion>
  )
  return (
    <Suggestions className="pb-0.5">
      {chip(ALL, t("connections.filterAll"), total)}
      {chip(CONNECTED, t("connections.filterConnected"), connectedCount)}
      {categories.map(([name, count]) => chip(name, name, count))}
    </Suggestions>
  )
}

interface ConnectionsPanelProps {
  connections: UseConnections
  selectedService?: string | null
}

export function ConnectionsPanel({ connections, selectedService }: ConnectionsPanelProps) {
  const { summary, busy, polling, error, refresh, connect, cancelPolling, getProviderDetail } = connections
  const t = useT()
  const [query, setQuery] = React.useState("")
  const [category, setCategory] = React.useState<string>(ALL)
  const [activeService, setActiveService] = React.useState<string | null>(null)
  const [dialog, setDialog] = React.useState<{
    detail: ConnectionProviderDetail
    authType: ConnectionAuthType
    appId?: string
  } | null>(null)

  const providers = summary?.providers ?? []

  // 聊天「去授权」：直接下钻到该 provider 详情，连接 CTA 一目了然。
  React.useEffect(() => {
    if (selectedService) {
      setActiveService(selectedService)
    }
  }, [selectedService])

  const categoryCounts = React.useMemo(() => {
    const map = new Map<string, number>()
    for (const p of providers) {
      for (const c of p.categories) {
        map.set(c, (map.get(c) ?? 0) + 1)
      }
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_CATEGORIES)
  }, [providers])

  const normalizedQuery = query.trim().toLowerCase()
  const visible = React.useMemo(() => {
    let list = providers
    if (normalizedQuery) {
      list = list.filter(
        (p) =>
          p.displayName.toLowerCase().includes(normalizedQuery) ||
          p.service.toLowerCase().includes(normalizedQuery) ||
          p.categories.some((c) => c.toLowerCase().includes(normalizedQuery)),
      )
    }
    if (category === CONNECTED) {
      list = list.filter((p) => p.connected)
    } else if (category !== ALL) {
      list = list.filter((p) => p.categories.includes(category))
    }

    if (!normalizedQuery && category === ALL) {
      const connected = list.filter((p) => p.connected)
      const suggestions = list.filter((p) => !p.connected).slice(0, MAX_SUGGESTIONS)
      list = [...connected, ...suggestions]
    } else {
      list = list.slice(0, MAX_FILTERED)
    }

    // 确保被选中的 provider（来自聊天"去授权"）始终可见。
    if (selectedService && !list.some((p) => p.service === selectedService)) {
      const target = providers.find((p) => p.service === selectedService)
      if (target) {
        list = [target, ...list]
      }
    }
    return list
  }, [providers, normalizedQuery, category, selectedService])

  // 一键连接：oauth/no_auth 直连；需表单的拉取详情后开对话框。
  const beginConnect = async (
    provider: ConnectionProvider,
    opts?: { detail?: ConnectionProviderDetail; appId?: string },
  ): Promise<void> => {
    const detail = opts?.detail
    const authType = detail ? pickAuthType(detail.authTypes) : pickAuthType(provider.authTypes)
    if (!authType) {
      return
    }
    if (isDirectConnect(authType)) {
      await connect(
        authType === "oauth2"
          ? { authType: "oauth2", service: provider.service, appId: opts?.appId }
          : { authType: "no_auth", service: provider.service },
      )
      return
    }
    const loaded = detail ?? (await getProviderDetail(provider.service))
    setDialog({ detail: loaded, authType, appId: opts?.appId })
  }

  const activeProvider = activeService ? providers.find((p) => p.service === activeService) : null

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {activeProvider ? (
        <ProviderDetail
          provider={activeProvider}
          connections={connections}
          onBack={() => setActiveService(null)}
          onStartConnect={(detail, _authType, appId) => void beginConnect(activeProvider, { detail, appId })}
        />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Plug className="oo-icon-muted size-4" />
              <span className="oo-text-title">{t("connections.title")}</span>
              {summary?.ready && (
                <span className="oo-text-micro oo-text-muted">
                  {summary.connectedCount}/{summary.providerCount}
                </span>
              )}
            </div>
            <button
              type="button"
              aria-label={t("aria.refresh")}
              onClick={() => void refresh()}
              className="oo-toolbar-button flex size-7 items-center justify-center rounded-md hover:bg-accent"
            >
              <RefreshCw className="size-3.5" />
            </button>
          </div>

          <div className="oo-search-surface flex items-center gap-2 rounded-lg border px-2">
            <Search className="oo-icon-muted size-3.5" />
            <input
              value={query}
              placeholder={t("connections.search")}
              onChange={(e) => setQuery(e.target.value)}
              className="oo-text-control h-8 min-w-0 flex-1 bg-transparent outline-none"
            />
          </div>

          {summary?.ready && providers.length > 0 && (
            <CategoryChips
              category={category}
              onChange={setCategory}
              total={summary.providerCount}
              connectedCount={summary.connectedCount}
              categories={categoryCounts}
            />
          )}

          {error && <div className="oo-error oo-text-micro">{error}</div>}

          {summary && !summary.ready && (
            <p className="oo-text-caption">{summary.message ?? t("connections.notReady")}</p>
          )}

          <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1 pb-2">
            {!summary ? (
              <div className="flex flex-1 items-center justify-center">
                <Loader className="oo-icon-muted" size={16} />
              </div>
            ) : visible.length === 0 ? (
              <p className="oo-text-caption px-1 pt-2">
                {normalizedQuery || category !== ALL ? t("connections.noMatch") : t("connections.none")}
              </p>
            ) : (
              visible.map((provider) => (
                <ProviderRow
                  key={provider.service}
                  provider={provider}
                  busy={busy === provider.service}
                  polling={polling === provider.service}
                  highlighted={selectedService === provider.service}
                  onOpenDetail={() => setActiveService(provider.service)}
                  onConnect={() => void beginConnect(provider)}
                  onCancelPolling={cancelPolling}
                />
              ))
            )}
          </div>

          {!normalizedQuery && category === ALL && providers.length > 0 && (
            <p className="oo-text-micro oo-text-muted px-1">
              {t("connections.more", { count: summary?.providerCount ?? 0 })}
            </p>
          )}
        </>
      )}

      <ConnectDialog
        open={dialog !== null}
        detail={dialog?.detail ?? null}
        authType={dialog?.authType ?? "api_key"}
        appId={dialog?.appId}
        busy={busy === dialog?.detail.service}
        onClose={() => setDialog(null)}
        onSubmit={async (input) => {
          await connect(input)
          setDialog(null)
        }}
        onOpenUrl={(url) => void connections.openExternal(url)}
      />
    </div>
  )
}
