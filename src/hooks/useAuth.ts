import type { AuthState } from "../../electron/auth/common.ts"
import type { UserFacingError } from "../lib/user-facing-error.ts"

import * as React from "react"
import { useAuthService } from "../components/AppContext.ts"
import { resolveUserFacingError } from "../lib/user-facing-error.ts"

export interface UseAuth {
  /** null = 初始状态尚未加载（避免登录页闪烁）。 */
  state: AuthState | null
  loggingIn: boolean
  loggingOut: boolean
  error: UserFacingError | null
  login: () => Promise<void>
  logout: () => Promise<void>
}

export function useAuth(): UseAuth {
  const service = useAuthService()
  const [state, setState] = React.useState<AuthState | null>(null)
  const [loggingIn, setLoggingIn] = React.useState(false)
  const [loggingOut, setLoggingOut] = React.useState(false)
  const [error, setError] = React.useState<UserFacingError | null>(null)
  const loginInFlight = React.useRef(false)

  React.useEffect(() => {
    let cancelled = false
    void service.invoke("getAuthState").then(
      (next) => {
        if (!cancelled) {
          setState(next)
        }
      },
      (err) => {
        if (!cancelled) {
          setError(resolveUserFacingError(err, { area: "auth" }))
        }
      },
    )
    const off = service.serverEvents.on("authStateChanged", (next) => setState(next))
    return () => {
      cancelled = true
      off()
    }
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
      setError(resolveUserFacingError(err, { area: "auth" }))
    } finally {
      setLoggingOut(false)
    }
  }, [service])

  return { state, loggingIn, loggingOut, error, login, logout }
}
