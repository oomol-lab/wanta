import { expect, test } from "vitest"
import {
  getDiscoverySearchAliases,
  getDiscoverySearchPriority,
  isDiscoveryProviderVisible,
} from "./connections-discovery.ts"

test("keeps existing official connections and business providers visible", () => {
  expect(isDiscoveryProviderVisible("instagram", false)).toBe(false)
  expect(isDiscoveryProviderVisible("bilibili", false)).toBe(false)
  expect(isDiscoveryProviderVisible("instagram", true)).toBe(true)
  expect(isDiscoveryProviderVisible("quickbooks", false)).toBe(true)
})
test("maps public research only to verified services", () => {
  expect(getDiscoverySearchAliases("tikhub")).toContain("instagram")
  expect(getDiscoverySearchAliases("aisa")).not.toContain("instagram")
  expect(getDiscoverySearchPriority("aisa", " Reddit ")).toBeLessThan(getDiscoverySearchPriority("reddit", "reddit"))
  expect(getDiscoverySearchPriority("tikhub", "TikTok Ads")).toBe(
    getDiscoverySearchPriority("tiktok_business", "TikTok Ads"),
  )
  expect(getDiscoverySearchPriority("tikhub", "")).toBe(getDiscoverySearchPriority("quickbooks", ""))
})
