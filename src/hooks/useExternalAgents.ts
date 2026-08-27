import type { ExternalAgentRuntimeStatus } from "../../electron/agent/external/status.ts"

import * as React from "react"
import { useChatService } from "../components/AppContext.ts"
import { reportRendererHandledError } from "../lib/renderer-diagnostics.ts"

export interface UseExternalAgents {
  agents: ExternalAgentRuntimeStatus[]
  refresh: () => Promise<void>
}

/**
 * Probed runtime status of every external (BYOA) agent. Loaded once on mount;
 * `refresh` re-probes on demand (for example when the agent picker opens).
 * Probe failures are reported but never surface as UI errors: the picker keeps
 * showing the last known statuses.
 */
export function useExternalAgents(): UseExternalAgents {
  const chatService = useChatService()
  const [agents, setAgents] = React.useState<ExternalAgentRuntimeStatus[]>([])
  const requestSequenceRef = React.useRef(0)

  const refresh = React.useCallback(async (): Promise<void> => {
    const requestId = ++requestSequenceRef.current
    await chatService
      .invoke("getExternalAgents")
      .then((next) => {
        if (requestId !== requestSequenceRef.current) {
          return
        }
        setAgents(next)
      })
      .catch((cause: unknown) => {
        reportRendererHandledError("agent", "probe external agents failed", cause)
      })
  }, [chatService])

  React.useEffect(() => {
    void refresh()
    return () => {
      // Invalidate in-flight probes on unmount or service change.
      requestSequenceRef.current += 1
    }
  }, [refresh])

  return { agents, refresh }
}
