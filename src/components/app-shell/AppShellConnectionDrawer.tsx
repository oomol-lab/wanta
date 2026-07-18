import type { UseConnections } from "@/hooks/useConnections"
import type { ConnectionAuthIntent } from "@/routes/Connections/connection-route-model.ts"

import * as React from "react"
import { CHAT_CONNECTION_DRAWER_WIDTH } from "./app-shell-model.ts"
import { cn } from "@/lib/utils"

const ConnectionsPanel = React.lazy(() =>
  import("@/routes/Connections").then((module) => ({ default: module.ConnectionsPanel })),
)

function ConnectionDrawerLoadingFallback() {
  return (
    <div className="h-full min-h-0 px-3 py-3">
      <section className="grid gap-3 rounded-lg border bg-muted/30 px-3 py-3">
        <div className="h-4 w-32 rounded-sm bg-muted" />
        <div className="h-3 w-56 max-w-full rounded-sm bg-muted" />
      </section>
    </div>
  )
}

export function AppShellConnectionDrawer({
  authIntent,
  canManageConnections,
  connections,
  onClose,
  onConnectionReady,
  selectedService,
  visible,
}: {
  authIntent: ConnectionAuthIntent | null
  canManageConnections: boolean
  connections: UseConnections
  onClose: () => void
  onConnectionReady: (target: { service: string; connectionName?: string }) => void
  selectedService: string | null
  visible: boolean
}) {
  return (
    <aside
      className={cn(
        "oo-border-divider min-h-0 shrink-0 overflow-hidden border-l bg-background transition-[width,opacity,transform] duration-200 ease-out motion-reduce:transition-none",
        visible ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-3 opacity-0",
      )}
      style={{ width: visible ? CHAT_CONNECTION_DRAWER_WIDTH : "0px" }}
      aria-hidden={!visible}
    >
      {visible ? (
        <React.Suspense fallback={<ConnectionDrawerLoadingFallback />}>
          <ConnectionsPanel
            authIntent={authIntent}
            canManageConnections={canManageConnections}
            connections={connections}
            onClose={onClose}
            onConnectionReady={onConnectionReady}
            presentation="drawer"
            selectedService={selectedService}
          />
        </React.Suspense>
      ) : null}
    </aside>
  )
}
