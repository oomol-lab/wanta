import type { BrowserViewBounds } from "./common.ts"

const allowedProtocols = new Set(["http:", "https:"])

export function parseBrowserUrl(value: string): URL {
  const input = value.trim()
  if (!input) throw new Error("Enter a web address.")
  const hasExplicitScheme = /^[A-Za-z][A-Za-z\d+.-]*:/u.test(input)
  const isBareHostWithPort = /^[^:/?#\s]+:\d+(?:[/?#]|$)/u.test(input)
  const candidate = hasExplicitScheme && !isBareHostWithPort ? input : `https://${input}`
  const url = new URL(candidate)
  if (!allowedProtocols.has(url.protocol)) {
    throw new Error("The integrated browser supports only HTTP and HTTPS URLs.")
  }
  return url
}

export function isAllowedBrowserUrl(value: string): boolean {
  if (value === "about:blank") return true
  try {
    return allowedProtocols.has(new URL(value).protocol)
  } catch {
    return false
  }
}

export function normalizeBrowserBounds(bounds: BrowserViewBounds, content: BrowserViewBounds): BrowserViewBounds {
  const x = clampInteger(bounds.x, 0, content.width)
  const y = clampInteger(bounds.y, 0, content.height)
  const width = clampInteger(bounds.width, 1, Math.max(1, content.width - x))
  const height = clampInteger(bounds.height, 1, Math.max(1, content.height - y))
  return { height, width, x, y }
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum
  return Math.min(maximum, Math.max(minimum, Math.round(value)))
}
