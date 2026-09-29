import type { ConnectionProviderIconSprite } from "./common.ts"

export function normalizeProviderIconSprite(value: unknown): ConnectionProviderIconSprite | undefined {
  if (!value || typeof value !== "object") return undefined
  const sprite = value as Record<string, unknown>
  const { version, pixelRatio, iconSize, bleed, width, height, lightUrl, darkUrl } = sprite
  if (
    typeof version !== "string" ||
    !version.trim() ||
    !positiveNumber(pixelRatio) ||
    !positiveNumber(iconSize) ||
    !positiveNumber(width) ||
    !positiveNumber(height) ||
    typeof bleed !== "number" ||
    !Number.isFinite(bleed) ||
    bleed < 0 ||
    iconSize > width ||
    iconSize > height ||
    !imageUrl(lightUrl) ||
    !imageUrl(darkUrl)
  )
    return undefined
  return { version, pixelRatio, iconSize, bleed, width, height, lightUrl, darkUrl }
}

export function normalizeProviderIconPosition(value: unknown, sprite: ConnectionProviderIconSprite | undefined) {
  if (!sprite || !value || typeof value !== "object") return undefined
  const { x, y } = value as Record<string, unknown>
  if (
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    x < 0 ||
    typeof y !== "number" ||
    !Number.isFinite(y) ||
    y < 0 ||
    x + sprite.iconSize > sprite.width ||
    y + sprite.iconSize > sprite.height
  )
    return undefined
  return { x, y }
}

export function providerIconSpriteFromMeta(meta: unknown): ConnectionProviderIconSprite | undefined {
  if (!meta || typeof meta !== "object") return undefined
  return normalizeProviderIconSprite((meta as Record<string, unknown>)["iconSprite"])
}

function positiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

function imageUrl(value: unknown): value is string {
  if (typeof value !== "string") return false
  try {
    const url = new URL(value)
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
  } catch {
    return false
  }
}
