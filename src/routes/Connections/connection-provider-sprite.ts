import * as React from "react"

type SpriteStatus = "loading" | "loaded" | "failed"

function createSpriteResource(url: string) {
  let status: SpriteStatus = "loading"
  let started = false
  const listeners = new Set<() => void>()

  return {
    getSnapshot: () => status,
    subscribe(listener: () => void) {
      listeners.add(listener)
      if (!started) {
        started = true
        const image = new Image()
        const finish = (nextStatus: SpriteStatus) => {
          status = nextStatus
          image.onload = null
          image.onerror = null
          for (const notify of listeners) notify()
        }
        image.onload = () => finish("loaded")
        image.onerror = () => finish("failed")
        image.referrerPolicy = "no-referrer"
        image.src = url
      }
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

// Sprite URLs are immutable. Keep successes and failures across component remounts.
const resources = new Map<string, ReturnType<typeof createSpriteResource>>()

export function getProviderSpriteResource(url: string) {
  let resource = resources.get(url)
  if (!resource) {
    resource = createSpriteResource(url)
    resources.set(url, resource)
  }
  return resource
}

const unavailable = {
  getSnapshot: () => "unavailable" as const,
  subscribe: () => () => {},
}
const getServerSnapshot = (): SpriteStatus => "loading"

export function useProviderSpriteStatus(url: string | null) {
  const resource = url ? getProviderSpriteResource(url) : unavailable
  return React.useSyncExternalStore<SpriteStatus | "unavailable">(
    resource.subscribe,
    resource.getSnapshot,
    url ? getServerSnapshot : unavailable.getSnapshot,
  )
}
