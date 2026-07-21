import type { AuthState } from "../../electron/auth/common.ts"
import type { UserFacingError } from "../lib/user-facing-error.ts"

import * as React from "react"
import { useAuthService } from "../components/AppContext.ts"
import { authRequiredMessage, oomolAuthRequiredEventName } from "../lib/oomol-http.ts"
import { resolveUserFacingError } from "../lib/user-facing-error.ts"
import { observeAuthState } from "./auth-state-observer.ts"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"

export interface UseAuth {
  /** null = 初始状态尚未加载（避免应用入口闪烁）。 */
  state: AuthState | null
  loggingIn: boolean
  loggingOut: boolean
  error: UserFacingError | null
  login: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = React.createContext<UseAuth | null>(null)

function useAuthController(): UseAuth {
  const service = useAuthService()
  const [state, setState] = React.useState<AuthState | null>(null)
  const [loggingIn, setLoggingIn] = React.useState(false)
  const [loggingOut, setLoggingOut] = React.useState(false)
  const [error, setError] = React.useState<UserFacingError | null>(null)
  const loginInFlight = React.useRef(false)
  const sessionExpireInFlight = React.useRef(false)
  const stateRef = React.useRef<AuthState | null>(null)

  React.useEffect(() => {
    stateRef.current = state
  }, [state])

  React.useEffect(() => {
    return observeAuthState({
      load: () => service.invoke("getAuthState"),
      onError: (err) => {
        reportRendererHandledError("auth", "initial auth state load failed", err)
        setError(resolveUserFacingError(err, { area: "auth" }))
      },
      onState: (next) => {
        setState(next)
        setError(null)
      },
      subscribe: (listener) => service.serverEvents.on("authStateChanged", listener),
    })
  }, [service])

  React.useEffect(() => {
    const expireSession = (event: Event) => {
      const currentState = stateRef.current
      if (currentState?.status !== "authenticated") {
        return
      }
      const requestedAt = event instanceof CustomEvent ? (event.detail as { requestedAt?: unknown }).requestedAt : null
      const authenticatedAt = Date.parse(currentState.updatedAt)
      if (typeof requestedAt === "number" && Number.isFinite(authenticatedAt) && requestedAt < authenticatedAt) {
        return
      }
      if (sessionExpireInFlight.current) {
        return
      }
      sessionExpireInFlight.current = true
      setError(null)
      void service
        .invoke("expireSession")
        .then(
          (next) => {
            setState(next)
            setError(resolveUserFacingError(authRequiredMessage, { area: "auth" }))
          },
          (err) => {
            reportRendererHandledError("auth", "session expiry handling failed", err)
            setError(resolveUserFacingError(err, { area: "auth" }))
          },
        )
        .finally(() => {
          sessionExpireInFlight.current = false
        })
    }

    window.addEventListener(oomolAuthRequiredEventName, expireSession)
    return () => window.removeEventListener(oomolAuthRequiredEventName, expireSession)
  }, [service])

  const login = React.useCallback(async () => {
    if (loginInFlight.current) {
      return
    }
    loginInFlight.current = true
    setLoggingIn(true)
    setError(null)
    try {
      // resolve 于浏览器 deep-link 回调完成（或超时 reject）。
      setState(await service.invoke("login"))
    } catch (err) {
      reportRendererHandledError("auth", "login failed", err)
      setError(resolveUserFacingError(err, { area: "auth" }))
    } finally {
      loginInFlight.current = false
      setLoggingIn(false)
    }
  }, [service])

  const logout = React.useCallback(async () => {
    setLoggingOut(true)
    setError(null)
    try {
      setState(await service.invoke("logout"))
    } catch (err) {
      reportRendererHandledError("auth", "logout failed", err)
      setError(resolveUserFacingError(err, { area: "auth" }))
    } finally {
      setLoggingOut(false)
    }
  }, [service])

  return { state, loggingIn, loggingOut, error, login, logout }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuthController()
  return React.createElement(AuthContext.Provider, { value: auth }, children)
}

export function useAuth(): UseAuth {
  const auth = React.useContext(AuthContext)
  if (!auth) {
    throw new Error("useAuth must be used within AuthProvider")
  }
  return auth
}
