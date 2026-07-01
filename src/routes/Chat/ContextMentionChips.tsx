import type { ChatContextMention } from "../../../electron/chat/common.ts"
import type { ConnectionProvider } from "../../../electron/connections/common.ts"

import { Package, Plug, X } from "lucide-react"
import { contextMentionKey } from "./composer-state.ts"
import { normalizeServiceSlug } from "./tool-display.ts"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"
import { ProviderIcon } from "@/routes/Connections/ProviderIcon"

function providerForMention(
  mention: Extract<ChatContextMention, { kind: "connection" }>,
  providerByService?: ReadonlyMap<string, ConnectionProvider>,
): ConnectionProvider | undefined {
  return providerByService?.get(normalizeServiceSlug(mention.service)) ?? providerByService?.get(mention.service)
}

function activeAccountCount(provider: ConnectionProvider | undefined): number {
  return provider?.apps.filter((app) => app.status === "active").length ?? 0
}

function connectionAccountLabel(
  mention: Extract<ChatContextMention, { kind: "connection" }>,
  provider: ConnectionProvider | undefined,
): string | undefined {
  return activeAccountCount(provider) > 1 ? mention.accountLabel : undefined
}

function contextMentionLabel(mention: ChatContextMention, provider?: ConnectionProvider): string {
  if (mention.kind === "skill") {
    return mention.name
  }
  const accountLabel = connectionAccountLabel(mention, provider)
  return accountLabel ? `${mention.displayName} ${accountLabel}` : mention.displayName
}

function contextMentionTitle(mention: ChatContextMention, provider?: ConnectionProvider): string | undefined {
  if (mention.kind === "skill") {
    return mention.description
  }
  return contextMentionLabel(mention, provider)
}

export function ContextMentionChips({
  className,
  mentions,
  onRemove,
  providerByService,
}: {
  className?: string
  mentions: ChatContextMention[]
  onRemove?: (mention: ChatContextMention) => void
  providerByService?: ReadonlyMap<string, ConnectionProvider>
}) {
  const t = useT()
  if (mentions.length === 0) {
    return null
  }
  return (
    <div className={cn("flex w-full flex-wrap gap-2", className)}>
      {mentions.map((mention) => {
        const provider = mention.kind === "connection" ? providerForMention(mention, providerByService) : undefined
        const accountLabel = mention.kind === "connection" ? connectionAccountLabel(mention, provider) : undefined
        const label = contextMentionLabel(mention, provider)
        return (
          <span
            key={contextMentionKey(mention)}
            className="oo-border-divider oo-text-body flex h-8 max-w-full items-center gap-2 rounded-lg border bg-background/70 px-2 shadow-xs"
            title={contextMentionTitle(mention, provider)}
          >
            {mention.kind === "connection" && provider ? (
              <ProviderIcon iconUrl={provider.iconUrl} displayName={provider.displayName} size="compact" />
            ) : (
              <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                {mention.kind === "skill" ? <Package className="size-3.5" /> : <Plug className="size-3.5" />}
              </span>
            )}
            <span className="flex min-w-0 items-center">
              {mention.kind === "skill" ? (
                <>
                  <span className="text-muted-foreground">{t("chat.contextSkillPrefix")}</span>
                  <span className="ml-1 font-medium text-foreground">{mention.name}</span>
                </>
              ) : (
                <>
                  <span className="min-w-0 truncate font-medium text-foreground">{mention.displayName}</span>
                  {accountLabel ? (
                    <>
                      <span className="mx-1 shrink-0 text-muted-foreground/55">·</span>
                      <span className="max-w-[12rem] min-w-0 truncate text-muted-foreground">{accountLabel}</span>
                    </>
                  ) : null}
                </>
              )}
            </span>
            {onRemove ? (
              <button
                type="button"
                aria-label={t("chat.contextRemove", { name: label })}
                className="-mr-1 flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => onRemove(mention)}
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </span>
        )
      })}
    </div>
  )
}
