import type {
  ConnectionAppSummary,
  ConnectionProviderDetail,
  ConnectionProviderSummary,
} from "../../electron/connections/common.ts"
import type { WecomCliState } from "../../electron/link-runtime/common.ts"

import * as React from "react"
import { useLinkRuntimeService } from "../components/AppContext.ts"
import { resolveConnectionError } from "../lib/connections-error.ts"
import wecomIconUrl from "@/assets/apps/wecom.svg"

export const wecomCliService = "wecom-cli"

function appFromState(state: WecomCliState, connectedUpdatedAt?: number): ConnectionAppSummary | null {
  if (state.connection === "disconnected") return null
  const timestamp = connectedUpdatedAt ?? Date.now()
  return {
    accountLabel: state.accountLabel,
    authType: "oauth2",
    connectionName: "default",
    createdAt: timestamp,
    displayName: state.accountLabel,
    id: "direct:wecom-cli:default",
    isDefault: true,
    service: wecomCliService,
    status: "active",
    updatedAt: timestamp,
  }
}

export function wecomCliProviderFromState(
  state: WecomCliState,
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
    iconUrl: wecomIconUrl,
    runtimeVersion: state.activeVersion ?? undefined,
    service: wecomCliService,
    status: state.connection === "connected" ? "connected" : "available",
  }
}

export function wecomCliProviderDetail(provider: ConnectionProviderSummary): ConnectionProviderDetail {
  return {
    ...provider,
    apiKeyConfig: null,
    customCredentialConfig: null,
    federatedCredentialConfig: null,
    homepageUrl: "https://github.com/WecomTeam/wecom-cli",
    oauthClientConfig: null,
  }
}

export function useWecomCliConnection() {
  const linkRuntimeService = useLinkRuntimeService()
  const [state, setState] = React.useState<WecomCliState | null>(null)
  const [error, setError] = React.useState<ReturnType<typeof resolveConnectionError> | null>(null)
  const cancelledOperationRef = React.useRef<"connect" | null>(null)
  const connectionRef = React.useRef<WecomCliState["connection"] | undefined>(undefined)
  const connectedUpdatedAtRef = React.useRef<number | undefined>(undefined)
  const acceptState = React.useCallback((next: WecomCliState) => {
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
      .invoke("getWecomCliState")
      .then((next) => {
        if (active) acceptState(next)
      })
      .catch((cause: unknown) => {
        if (active) setError(resolveConnectionError(cause, "summary"))
      })
    const unsubscribe = linkRuntimeService.serverEvents.on("wecomCliChanged", (next) => {
      if (active) acceptState(next)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [acceptState, linkRuntimeService])

  const mutate = React.useCallback(
    async (method: "connectWecomCli" | "disconnectWecomCli") => {
      const operation = method === "connectWecomCli" ? "connect" : "disconnect"
      if (operation === "connect") cancelledOperationRef.current = null
      setError(null)
      try {
        const next = await linkRuntimeService.invoke(method)
        acceptState(next)
        return true
      } catch (cause) {
        if (cancelledOperationRef.current !== operation) {
          setError(resolveConnectionError(cause, operation))
        }
        if (cancelledOperationRef.current === operation) cancelledOperationRef.current = null
        return false
      }
    },
    [acceptState, linkRuntimeService],
  )

  const cancel = React.useCallback(() => {
    cancelledOperationRef.current = "connect"
    setError(null)
    return linkRuntimeService.invoke("cancelWecomCliConnection").catch((cause: unknown) => {
      cancelledOperationRef.current = null
      setError(resolveConnectionError(cause, "connect"))
    })
  }, [linkRuntimeService])
  const connect = React.useCallback(() => mutate("connectWecomCli"), [mutate])
  const disconnect = React.useCallback(() => mutate("disconnectWecomCli"), [mutate])
  const reopenAuthorization = React.useCallback(
    () => linkRuntimeService.invoke("reopenWecomCliAuthorization").then(() => undefined),
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
