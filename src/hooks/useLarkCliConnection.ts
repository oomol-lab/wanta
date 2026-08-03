import type {
  ConnectionAppSummary,
  ConnectionProviderDetail,
  ConnectionProviderSummary,
} from "../../electron/connections/common.ts"
import type { LarkCliState } from "../../electron/link-runtime/common.ts"

import * as React from "react"
import { useLinkRuntimeService } from "../components/AppContext.ts"
import { resolveConnectionError } from "../lib/connections-error.ts"
import larkIconUrl from "@/assets/apps/lark.svg"

export const larkCliService = "lark-cli"

function appFromState(state: LarkCliState, connectedUpdatedAt?: number): ConnectionAppSummary | null {
  if (state.connection === "disconnected") return null
  const timestamp = connectedUpdatedAt ?? Date.now()
  return {
    accountLabel: state.accountLabel,
    authType: "oauth2",
    connectionName: "default",
    createdAt: timestamp,
    displayName: state.accountLabel,
    id: "direct:lark-cli:default",
    isDefault: true,
    service: larkCliService,
    status: state.connection === "connected" ? "active" : "reauth_required",
    updatedAt: timestamp,
  }
}

export function larkCliProviderFromState(
  state: LarkCliState,
  copy: { description: string; displayName: string },
  connectedUpdatedAt?: number,
): ConnectionProviderSummary {
  const app = appFromState(state, connectedUpdatedAt)
  return {
    accountLabel: state.accountLabel,
    appAuthType: "oauth2",
    appCount: app ? 1 : 0,
    apps: app ? [app] : [],
    authTypes: ["oauth2"],
    actionKind: state.available ? "oauth2" : "unavailable",
    canDisconnect: Boolean(app),
    canReconnect: true,
    categoryLabels: ["Communication", "Documentation", "Productivity"],
    connectedUpdatedAt: app?.updatedAt,
    description: copy.description,
    displayName: copy.displayName,
    executionMode: "direct",
    iconUrl: larkIconUrl,
    runtimeVersion: state.activeVersion ?? undefined,
    service: larkCliService,
    status:
      state.connection === "connected" ? "connected" : state.connection === "expired" ? "needs_attention" : "available",
  }
}

export function larkCliProviderDetail(provider: ConnectionProviderSummary): ConnectionProviderDetail {
  return {
    ...provider,
    apiKeyConfig: null,
    customCredentialConfig: null,
    federatedCredentialConfig: null,
    homepageUrl: "https://github.com/larksuite/cli",
    oauthClientConfig: null,
  }
}

export function useLarkCliConnection() {
  const linkRuntimeService = useLinkRuntimeService()
  const [state, setState] = React.useState<LarkCliState | null>(null)
  const [error, setError] = React.useState<ReturnType<typeof resolveConnectionError> | null>(null)
  const cancelledOperationRef = React.useRef<"connect" | null>(null)
  const connectionRef = React.useRef<LarkCliState["connection"] | undefined>(undefined)
  const connectedUpdatedAtRef = React.useRef<number | undefined>(undefined)
  const acceptState = React.useCallback((next: LarkCliState) => {
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
      .invoke("getLarkCliState")
      .then((next) => {
        if (active) acceptState(next)
      })
      .catch((cause: unknown) => {
        if (active) setError(resolveConnectionError(cause, "summary"))
      })
    const unsubscribe = linkRuntimeService.serverEvents.on("larkCliChanged", (next) => {
      if (active) acceptState(next)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [acceptState, linkRuntimeService])

  const mutate = React.useCallback(
    async (method: "connectLarkCli" | "disconnectLarkCli") => {
      const operation = method === "connectLarkCli" ? "connect" : "disconnect"
      if (operation === "connect") cancelledOperationRef.current = null
      setError(null)
      try {
        const next = await linkRuntimeService.invoke(method)
        acceptState(next)
        return true
      } catch (cause) {
        if (cancelledOperationRef.current !== operation) {
          setError(resolveConnectionError(cause, method === "connectLarkCli" ? "connect" : "disconnect"))
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
    return linkRuntimeService.invoke("cancelLarkCliConnection").catch((cause: unknown) => {
      cancelledOperationRef.current = null
      setError(resolveConnectionError(cause, "connect"))
    })
  }, [linkRuntimeService])
  const connect = React.useCallback(() => mutate("connectLarkCli"), [mutate])
  const disconnect = React.useCallback(() => mutate("disconnectLarkCli"), [mutate])
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
      state,
    }),
    [cancel, connect, disconnect, error, state, stateError],
  )
}
