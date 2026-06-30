import { packageAssetsBaseUrl } from "@/lib/domain"

const absoluteIconUrlPattern = /^(https?:|data:)/i
const iconTokenPattern = /^:?[a-z0-9-]+:[^/?#]+:?$/i
const imageFileExtensionPattern = /\.(avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i

export function resolvePackageAssetIconSource(
  icon: string | undefined,
  packageName: string,
  version: string,
): string | undefined {
  const value = icon?.trim()
  if (!value) {
    return undefined
  }
  if (!shouldResolveAsPackageAsset(value)) {
    return value
  }

  const baseUrl = new URL(
    `/packages/${encodePackagePath(packageName)}/${encodeURIComponent(version.trim() || "latest")}/files/package/`,
    packageAssetsBaseUrl,
  )
  return new URL(value.startsWith("/") ? value.slice(1) : value, baseUrl).toString()
}

function shouldResolveAsPackageAsset(value: string): boolean {
  if (absoluteIconUrlPattern.test(value) || iconTokenPattern.test(value) || isEmojiIconSource(value)) {
    return false
  }
  return value.startsWith("/") || value.includes("/") || imageFileExtensionPattern.test(value)
}

function isEmojiIconSource(value: string): boolean {
  return !/^\d+$/.test(value) && !value.includes("/") && /\p{Emoji}/u.test(value)
}

function encodePackagePath(packageName: string): string {
  return packageName
    .trim()
    .split("/")
    .map((part) => encodeURIComponent(part).replaceAll("%40", "@"))
    .join("/")
}
