import type { RuntimeCapabilities } from "../../electron/runtime/common.ts"
import type { UserFacingError } from "../lib/user-facing-error.ts"

import * as React from "react"
import { useChatService } from "../components/AppContext.ts"
import { reportRendererHandledError } from "../lib/renderer-diagnostics.ts"
import { resolveUserFacingError } from "../lib/user-facing-error.ts"
import { observeRuntimeCapabilities } from "./runtime-capabilities-observer.ts"

export interface UseRuntimeCapabilities {
  capabilities: RuntimeCapabilities | null
  error: UserFacingError | null
}

const RuntimeCapabilitiesContext = React.createContext<UseRuntimeCapabilities | null>(null)

function useRuntimeCapabilitiesController(): UseRuntimeCapabilities {
  const service = useChatService()
  const [capabilities, setCapabilities] = React.useState<RuntimeCapabilities | null>(null)
  const [error, setError] = React.useState<UserFacingError | null>(null)

  React.useEffect(() => {
    return observeRuntimeCapabilities({
      load: () => service.invoke("getRuntimeCapabilities"),
      onError: (cause) => {
        reportRendererHandledError("runtime", "initial runtime capabilities load failed", cause)
        setError(resolveUserFacingError(cause, { area: "agent" }))
      },
      onState: (next) => {
        setCapabilities(next)
        setError(null)
      },
      subscribe: (listener) =>
        service.serverEvents.on("runtimeCapabilitiesChanged", ({ capabilities: next }) => listener(next)),
    })
  }, [service])

  return { capabilities, error }
}

export function RuntimeCapabilitiesProvider({ children }: { children: React.ReactNode }) {
  const runtime = useRuntimeCapabilitiesController()
  return React.createElement(RuntimeCapabilitiesContext.Provider, { value: runtime }, children)
}

export function useRuntimeCapabilities(): UseRuntimeCapabilities {
  const runtime = React.useContext(RuntimeCapabilitiesContext)
  if (!runtime) {
    throw new Error("useRuntimeCapabilities must be used within RuntimeCapabilitiesProvider")
  }
  return runtime
}
