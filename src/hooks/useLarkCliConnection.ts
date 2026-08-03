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

const service = "lark-cli"

function appFromState(state: LarkCliState): ConnectionAppSummary | null {
  if (state.connection === "disconnected") return null
  const now = Date.now()
  return {
    accountLabel: state.accountLabel,
    authType: "oauth2",
    connectionName: "default",
    createdAt: now,
    displayName: state.accountLabel,
    id: "direct:lark-cli:default",
    isDefault: true,
    service,
    status: state.connection === "connected" ? "active" : "reauth_required",
    updatedAt: now,
  }
}

export function larkCliProviderFromState(
  state: LarkCliState,
  copy: { description: string; displayName: string },
): ConnectionProviderSummary {
  const app = appFromState(state)
  return {
    accountLabel: state.accountLabel,
    appAuthType: "oauth2",
    appCount: app ? 1 : 0,
    apps: app ? [app] : [],
    authTypes: ["oauth2"],
    actionKind: state.available ? "oauth2" : "unavailable",
    canDisconnect: Boolean(app),
    categoryLabels: ["Communication", "Documentation", "Productivity"],
    connectedUpdatedAt: app?.updatedAt,
    description: copy.description,
    displayName: copy.displayName,
    executionMode: "direct",
    iconUrl: larkIconUrl,
    runtimeVersion: state.activeVersion ?? undefined,
    service,
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
  const cancellationRequestedRef = React.useRef(false)

  React.useEffect(() => {
    let active = true
    void linkRuntimeService
      .invoke("getLarkCliState")
      .then((next) => {
        if (active) setState(next)
      })
      .catch((cause: unknown) => {
        if (active) setError(resolveConnectionError(cause, "summary"))
      })
    const unsubscribe = linkRuntimeService.serverEvents.on("larkCliChanged", (next) => {
      if (active) setState(next)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [linkRuntimeService])

  const mutate = React.useCallback(
    async (method: "connectLarkCli" | "disconnectLarkCli") => {
      cancellationRequestedRef.current = false
      setError(null)
      try {
        const next = await linkRuntimeService.invoke(method)
        setState(next)
        return true
      } catch (cause) {
        if (!cancellationRequestedRef.current) {
          setError(resolveConnectionError(cause, method === "connectLarkCli" ? "connect" : "disconnect"))
        }
        cancellationRequestedRef.current = false
        return false
      }
    },
    [linkRuntimeService],
  )

  const cancel = React.useCallback(() => {
    cancellationRequestedRef.current = true
    setError(null)
    return linkRuntimeService.invoke("cancelLarkCliConnection")
  }, [linkRuntimeService])
  const connect = React.useCallback(() => mutate("connectLarkCli"), [mutate])
  const disconnect = React.useCallback(() => mutate("disconnectLarkCli"), [mutate])
  const stateError = React.useMemo(
    () => (state?.error ? resolveConnectionError(new Error(state.error), "summary") : null),
    [state?.error],
  )

  return {
    cancel,
    connect,
    disconnect,
    error: error ?? stateError,
    state,
  }
}
