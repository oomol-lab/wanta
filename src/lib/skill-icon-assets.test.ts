import assert from "node:assert/strict"
import { test } from "vitest"
import { packageAssetsBaseUrl } from "@/lib/domain"
import { resolvePackageAssetIconSource } from "@/lib/skill-icon-assets.ts"

test("resolvePackageAssetIconSource resolves relative package image paths", () => {
  assert.equal(
    resolvePackageAssetIconSource("assets/icon.svg", "@acme/demo", "1.2.3"),
    `${packageAssetsBaseUrl}/packages/@acme/demo/1.2.3/files/package/assets/icon.svg`,
  )
})

test("resolvePackageAssetIconSource preserves absolute URLs, tokens, and emoji", () => {
  assert.equal(
    resolvePackageAssetIconSource("https://static.oomol.com/logo/logo.png", "@acme/demo", "1.2.3"),
    "https://static.oomol.com/logo/logo.png",
  )
  assert.equal(resolvePackageAssetIconSource(":lucide:box", "@acme/demo", "1.2.3"), ":lucide:box")
  assert.equal(resolvePackageAssetIconSource("simple-icons:wechat", "@acme/demo", "1.2.3"), "simple-icons:wechat")
  assert.equal(resolvePackageAssetIconSource("🛍️", "@acme/demo", "1.2.3"), "🛍️")
})
