import type { Team } from "../../../electron/teams/common.ts"
import type { WorkbenchLocation } from "@oomol-lab/open-flow/workbench"

import { isWorkbenchLanguage, OpenFlowWorkbench } from "@oomol-lab/open-flow/workbench"
import "@oomol-lab/open-flow/workbench.css"
import "./workbench.css"

import * as React from "react"
import { toast } from "sonner"
import { FlowsLoading } from "./FlowsLoading.tsx"
import { createFlowHost } from "./host.ts"
import { workbenchHref } from "./location.ts"
import { createFlowPreferences, flowScopeKey } from "./preferences.ts"
import { useChatService } from "@/components/AppContext"
import { useTheme } from "@/components/theme-context"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { useI18n } from "@/i18n/i18n"
import { consoleBaseUrl } from "@/lib/domain"

function TeamWorkbench({
  accountId,
  team,
  writable,
  onConfigureConnector,
}: {
  accountId: string
  team: Team
  writable: boolean
  onConfigureConnector?: (() => void) | undefined
}) {
  const { locale, t } = useI18n()
  const { effectiveTheme } = useTheme()
  const chatService = useChatService()
  const [location, setLocation] = React.useState<WorkbenchLocation>({ view: "design" })
  const scopeKey = flowScopeKey(accountId, team.id)
  const readOnlyMessage = t("flows.readOnly")
  const readOnlyMessageRef = React.useRef(readOnlyMessage)
  readOnlyMessageRef.current = readOnlyMessage
  const host = React.useMemo(
    () =>
      createFlowHost({
        teamName: team.name,
        writable,
        readOnlyMessage: () => readOnlyMessageRef.current,
        openExternal: (url) => chatService.invoke("openExternalUrl", { url }),
      }),
    [chatService, team.name, writable],
  )
  const preferences = React.useMemo(() => createFlowPreferences(scopeKey), [scopeKey])
  React.useEffect(() => () => host.dispose(), [host])
  const configureConnector = () => {
    if (onConfigureConnector) {
      onConfigureConnector()
      return
    }
    void host
      .openExternalPage(async () =>
        new URL(`/team/${encodeURIComponent(team.name)}/connections`, consoleBaseUrl).toString(),
      )
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
  }
  return (
    <div className="wanta-flow-workbench relative h-full min-h-0 overflow-hidden">
      <OpenFlowWorkbench
        sessionKey={`${scopeKey}:${team.name}:${writable}`}
        host={host}
        hrefFor={workbenchHref}
        location={location}
        onNavigate={setLocation}
        preferences={preferences}
        language={isWorkbenchLanguage(locale) ? locale : "en"}
        theme={effectiveTheme}
        createFlowDisabled={!writable}
        catalogWidth="full"
        onConfigureConnector={configureConnector}
        variables
      />
      <FlowsLoading className="wanta-flow-loading absolute inset-0" />
    </div>
  )
}

export function FlowsRoute({
  accountId,
  team,
  writable,
  onConfigureConnector,
}: {
  accountId: string
  team: Team | null
  writable: boolean
  onConfigureConnector?: (() => void) | undefined
}) {
  const { t } = useI18n()
  if (!team || !accountId || team.status === "paused") {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyTitle>{t("flows.title")}</EmptyTitle>
          <EmptyDescription>{t(team?.status === "paused" ? "flows.teamPaused" : "flows.selectTeam")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <TeamWorkbench
      key={`${accountId}:${team.id}:${team.name}:${writable}`}
      accountId={accountId}
      team={team}
      writable={writable}
      onConfigureConnector={onConfigureConnector}
    />
  )
}
