import { describe, expect, it } from "vitest"
import {
  isAppLocale,
  isLocalePreference,
  normalizeAppLocale,
  resolveSystemLocale,
  supportedAppLocales,
} from "./app-locale.ts"

describe("application locales", () => {
  it.each([
    ["zh-Hant", "zh-TW"],
    ["zh-HK", "zh-TW"],
    ["zh-TW", "zh-TW"],
    ["zh-Hans-HK", "zh-CN"],
    ["zh-Hant-CN", "zh-TW"],
    ["zh-SG", "zh-CN"],
    ["EN_us", "en"],
    ["fr-CA", "fr"],
    ["es-MX", "es"],
    ["ja-JP", "ja"],
    ["ko-KR", "ko"],
    ["ru-RU", "ru"],
    ["de-DE", "en"],
  ])("maps %s to %s", (input, expected) => expect(normalizeAppLocale(input)).toBe(expected))
  it("validates IPC input without accepting inherited object keys", () => {
    for (const locale of supportedAppLocales) expect(isAppLocale(locale)).toBe(true)
    for (const invalid of ["constructor", "toString", "system", null, {}, "en-US"])
      expect(isAppLocale(invalid)).toBe(false)
    expect(isLocalePreference("system")).toBe(true)
    expect(isLocalePreference("zh-TW")).toBe(true)
  })
  it("uses the first supported system preference", () => {
    expect(resolveSystemLocale(["de-DE", "fr-CA", "en-US"])).toBe("fr")
    expect(resolveSystemLocale([])).toBe("en")
  })
})
