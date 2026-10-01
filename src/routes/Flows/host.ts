import type { FlowCatalogEvent, FlowChangeEvent, WorkbenchHost } from "@oomol-lab/open-flow/workbench"

import { toast } from "sonner"
import { apiBaseUrl, openFlowBaseUrl } from "@/lib/domain"
import { oomolFetch, oomolFetchJson } from "@/lib/oomol-http"

type Subscription = ReturnType<WorkbenchHost["subscribeFlow"]>

export interface FlowHostOptions {
  teamName: string
  writable: boolean
  readOnlyMessage: string | (() => string)
  openExternal: (url: string) => Promise<void>
}

function notificationUrl(path: string, teamName: string): URL {
  const url = new URL(path, openFlowBaseUrl)
  url.protocol = "wss:"
  url.searchParams.set("teamName", teamName)
  return url
}

function decodeEvent(data: unknown): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(String(data))
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function subscribe<T>(url: URL, decode: (data: unknown) => T | undefined, listener: (event?: T) => void): Subscription {
  let retryMs = 1_000
  let socket: WebSocket | undefined
  let stopped = false
  let readySettled = false
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let resolveReady!: () => void
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })
  const settleReady = () => {
    if (readySettled) return
    readySettled = true
    clearTimeout(readyTimer)
    resolveReady()
  }
  const readyTimer = setTimeout(settleReady, 5_000)
  const connect = () => {
    if (stopped) return
    socket = new WebSocket(url)
    socket.addEventListener("open", () => {
      if (stopped) return
      retryMs = 1_000
      if (readySettled) listener()
      else settleReady()
    })
    socket.addEventListener("message", (event) => {
      if (stopped) return
      const value = decode(event.data)
      if (value !== undefined) listener(value)
    })
    socket.addEventListener("close", () => {
      if (stopped) return
      reconnectTimer = setTimeout(connect, retryMs + Math.floor(Math.random() * 250))
      retryMs = Math.min(retryMs * 2, 30_000)
    })
  }
  connect()
  return {
    ready,
    stop() {
      if (stopped) return
      stopped = true
      settleReady()
      clearTimeout(reconnectTimer)
      socket?.close()
    },
  }
}

/** One host per account/team mount; credentials remain in Chromium's HttpOnly cookie. */
export function createFlowHost(options: FlowHostOptions): WorkbenchHost & { dispose(): void } {
  const lifetime = new AbortController()
  const subscriptions = new Set<Subscription>()
  let notificationId: number | string | undefined
  const tracked = (subscription: Subscription): Subscription => {
    subscriptions.add(subscription)
    return {
      ready: subscription.ready,
      stop() {
        subscription.stop()
        subscriptions.delete(subscription)
      },
    }
  }
  const assertActive = () => lifetime.signal.throwIfAborted()
  return {
    connectorOwnerId: options.teamName,
    async openExternalPage(resolveUrl) {
      assertActive()
      const url = new URL(await resolveUrl())
      assertActive()
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
        throw new Error("Invalid external page URL.")
      }
      await options.openExternal(url.toString())
      return true
    },
    notify(notification) {
      if (notificationId !== undefined) toast.dismiss(notificationId)
      notificationId = undefined
      if (!notification || lifetime.signal.aborted) return
      notificationId = toast[notification.kind](notification.message, {
        closeButton: true,
        ...(notification.kind === "error" ? { duration: Infinity } : {}),
        ...(notification.undo
          ? {
              action: {
                label: notification.undo.label,
                onClick: () => {
                  if (!lifetime.signal.aborted)
                    void notification.undo!.run().catch((error: unknown) => {
                      if (!lifetime.signal.aborted) toast.error(error instanceof Error ? error.message : String(error))
                    })
                },
              },
            }
          : {}),
      })
    },
    async request(input, init) {
      assertActive()
      const original = input instanceof Request ? input : undefined
      const url = new URL(original?.url ?? String(input), openFlowBaseUrl)
      if (url.origin !== new URL(openFlowBaseUrl).origin || url.username || url.password) {
        throw new Error("Workflows must use the configured Open Flow service.")
      }
      const method = (init?.method ?? original?.method ?? "GET").toUpperCase()
      if (!options.writable && !["GET", "HEAD", "OPTIONS"].includes(method)) {
        const message =
          typeof options.readOnlyMessage === "function" ? options.readOnlyMessage() : options.readOnlyMessage
        return new Response(JSON.stringify({ error: { code: "permission.denied", message } }), {
          status: 403,
          headers: { "content-type": "application/json" },
        })
      }
      const headers = new Headers(original?.headers)
      new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
      headers.set("x-oo-team-name", options.teamName)
      const callerSignal = init?.signal ?? original?.signal
      return oomolFetch(original ?? url, {
        ...init,
        headers,
        redirect: "error",
        signal: callerSignal ? AbortSignal.any([callerSignal, lifetime.signal]) : lifetime.signal,
        timeoutMs: 60_000,
      })
    },
    async resolveActor(actorId, signal) {
      assertActive()
      const url = new URL("/v1/users/summaries", apiBaseUrl)
      url.searchParams.set("user_ids", actorId)
      const summaries = await oomolFetchJson<Record<string, { nickname: string; username: string; url: string }>>(url, {
        signal: AbortSignal.any([signal, lifetime.signal]),
      })
      const actor = summaries[actorId]
      return actor ? { name: actor.nickname || actor.username, avatarUrl: actor.url || undefined } : null
    },
    subscribeFlow(flowId, listener) {
      assertActive()
      return tracked(
        subscribe(
          notificationUrl(`/v1/flows/${encodeURIComponent(flowId)}/notifications`, options.teamName),
          (data) => {
            const value = decodeEvent(data)
            if (value?.version !== 1 || value.flowId !== flowId) return
            if (value.kind === "draft.changed" && typeof value.revisionId === "string")
              return value as unknown as FlowChangeEvent
            if (value.kind === "run.created" && typeof value.runId === "string")
              return value as unknown as FlowChangeEvent
            if (value.kind === "run.changed" && typeof value.runId === "string")
              return value as unknown as FlowChangeEvent
            if (
              value.kind === "access.changed" &&
              Number.isSafeInteger(value.accessRevision) &&
              (value.accessRevision as number) >= 0
            )
              return value as unknown as FlowChangeEvent
          },
          listener,
        ),
      )
    },
    subscribeFlowCatalog(listener) {
      assertActive()
      return tracked(
        subscribe(
          notificationUrl("/v1/flows/notifications", options.teamName),
          (data) => {
            const value = decodeEvent(data)
            if (value?.version === 1 && value.kind === "flows.changed") return value as unknown as FlowCatalogEvent
            if (value?.version === 1 && value.kind === "flow.created" && typeof value.flowId === "string")
              return value as unknown as FlowCatalogEvent
          },
          listener,
        ),
      )
    },
    dispose() {
      lifetime.abort()
      for (const subscription of subscriptions) subscription.stop()
      subscriptions.clear()
      if (notificationId !== undefined) toast.dismiss(notificationId)
      notificationId = undefined
    },
  }
}
