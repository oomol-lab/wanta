import type {
  ConnectionAppSummary,
  ConnectionProviderDetail,
  ConnectionProviderSummary,
} from "../../electron/connections/common.ts"
import type { DingTalkCliState } from "../../electron/link-runtime/common.ts"

import * as React from "react"
import { useLinkRuntimeService } from "../components/AppContext.ts"
import { resolveConnectionError } from "../lib/connections-error.ts"
import dingTalkIconUrl from "@/assets/apps/dingtalk.svg"

export const dingTalkCliService = "dingtalk-cli"

function appFromState(state: DingTalkCliState, connectedUpdatedAt?: number): ConnectionAppSummary | null {
  if (state.connection === "disconnected") return null
  const timestamp = connectedUpdatedAt ?? Date.now()
  return {
    accountLabel: state.accountLabel,
    authType: "oauth2",
    connectionName: "default",
    createdAt: timestamp,
    displayName: state.accountLabel,
    id: "direct:dingtalk-cli:default",
    isDefault: true,
    service: dingTalkCliService,
    status: state.connection === "connected" ? "active" : "reauth_required",
    updatedAt: timestamp,
  }
}

export function dingTalkCliProviderFromState(
  state: DingTalkCliState,
  copy: { connectActionLabel: string; connectionMethodLabel: string; description: string; displayName: string },
  connectedUpdatedAt?: number,
): ConnectionProviderSummary {
  const app = appFromState(state, connectedUpdatedAt)
  return {
    accountLabel: state.accountLabel,
    actionKind: state.available ? "oauth2" : "unavailable",
    appAuthType: "oauth2",
    appCount: app ? 1 : 0,
    apps: app ? [app] : [],
    authTypes: ["oauth2"],
    canDisconnect: Boolean(app),
    categoryLabels: ["Communication", "Documentation", "Productivity"],
    connectActionLabel: copy.connectActionLabel,
    connectedUpdatedAt: app?.updatedAt,
    connectionMethodLabel: copy.connectionMethodLabel,
    description: copy.description,
    displayName: copy.displayName,
    executionMode: "direct",
    iconUrl: dingTalkIconUrl,
    runtimeVersion: state.activeVersion ?? undefined,
    service: dingTalkCliService,
    status:
      state.connection === "connected" ? "connected" : state.connection === "expired" ? "needs_attention" : "available",
  }
}

export function dingTalkCliProviderDetail(provider: ConnectionProviderSummary): ConnectionProviderDetail {
  return {
    ...provider,
    apiKeyConfig: null,
    customCredentialConfig: null,
    federatedCredentialConfig: null,
    homepageUrl: "https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli",
    oauthClientConfig: null,
  }
}

export function useDingTalkCliConnection() {
  const linkRuntimeService = useLinkRuntimeService()
  const [state, setState] = React.useState<DingTalkCliState | null>(null)
  const [error, setError] = React.useState<ReturnType<typeof resolveConnectionError> | null>(null)
  const cancelledOperationRef = React.useRef<"connect" | null>(null)
  const connectionRef = React.useRef<DingTalkCliState["connection"] | undefined>(undefined)
  const connectedUpdatedAtRef = React.useRef<number | undefined>(undefined)
  const acceptState = React.useCallback((next: DingTalkCliState) => {
    if (next.connection === "connected" && connectionRef.current !== "connected") {
      connectedUpdatedAtRef.current = Date.now()
    } else if (next.connection === "disconnected") {
      connectedUpdatedAtRef.current = undefined
    }
    connectionRef.current = next.connection
    setState(next)
  }, [])

  React.useEffect(() => {
    let active = true
    void linkRuntimeService
      .invoke("getDingTalkCliState")
      .then((next) => {
        if (active) acceptState(next)
      })
      .catch((cause: unknown) => {
        if (active) setError(resolveConnectionError(cause, "summary"))
      })
    const unsubscribe = linkRuntimeService.serverEvents.on("dingTalkCliChanged", (next) => {
      if (active) acceptState(next)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [acceptState, linkRuntimeService])

  const mutate = React.useCallback(
    async (method: "connectDingTalkCli" | "disconnectDingTalkCli") => {
      const operation = method === "connectDingTalkCli" ? "connect" : "disconnect"
      if (operation === "connect") cancelledOperationRef.current = null
      setError(null)
      try {
        const next = await linkRuntimeService.invoke(method)
        acceptState(next)
        return true
      } catch (cause) {
        if (cancelledOperationRef.current !== operation) setError(resolveConnectionError(cause, operation))
        if (cancelledOperationRef.current === operation) cancelledOperationRef.current = null
        return false
      }
    },
    [acceptState, linkRuntimeService],
  )

  const cancel = React.useCallback(() => {
    cancelledOperationRef.current = "connect"
    setError(null)
    return linkRuntimeService.invoke("cancelDingTalkCliConnection").catch((cause: unknown) => {
      cancelledOperationRef.current = null
      setError(resolveConnectionError(cause, "connect"))
    })
  }, [linkRuntimeService])
  const connect = React.useCallback(() => mutate("connectDingTalkCli"), [mutate])
  const disconnect = React.useCallback(() => mutate("disconnectDingTalkCli"), [mutate])
  const reopenAuthorization = React.useCallback(
    () => linkRuntimeService.invoke("reopenDingTalkCliAuthorization").then(() => undefined),
    [linkRuntimeService],
  )
  const stateError = React.useMemo(
    () => (state?.error ? resolveConnectionError(new Error(state.error), "summary") : null),
    [state?.error],
  )

  return React.useMemo(
    () => ({
      cancel,
      connect,
      connectedUpdatedAt: connectedUpdatedAtRef.current,
      disconnect,
      error: error ?? stateError,
      reopenAuthorization,
      state,
    }),
    [cancel, connect, disconnect, error, reopenAuthorization, state, stateError],
  )
}
