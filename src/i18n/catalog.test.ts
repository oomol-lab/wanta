import { describe, expect, it } from "vitest"
import { supportedAppLocales } from "../../electron/app-locale.ts"
import { nativeMessages } from "../../electron/native-messages.ts"
import { messages } from "./app-messages.ts"

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}|\{\s*([A-Za-z0-9_.-]+)\s*\}/g)]
    .map((match) => match[1] ?? match[2])
    .sort()
}
for (const [name, catalogs] of [
  ["application", messages],
  ["native", nativeMessages],
] as const) {
  describe(`${name} translation catalog`, () => {
    const baseline: Record<string, string> = catalogs.en
    for (const locale of supportedAppLocales) {
      it(`${locale} has every key and preserves interpolation variables`, () => {
        const translated: Record<string, string> = catalogs[locale]
        expect(Object.keys(translated).sort()).toEqual(Object.keys(baseline).sort())
        for (const [key, original] of Object.entries(baseline)) {
          expect(translated[key].trim(), `${locale}:${key}`).not.toBe("")
          expect(placeholders(translated[key]), `${locale}:${key}`).toEqual(placeholders(original))
          const urls = original.match(/https?:\/\/[^\s<>"`]+/g) ?? []
          for (const url of urls) expect(translated[key], `${locale}:${key}`).toContain(url)
        }
      })
    }
  })
}

import { translate } from "./i18n.ts"
import { pluralMessages } from "./plural-messages.ts"
for (const locale of ["en", "fr", "es", "ru"] as const) {
  it(`${locale} count variants cover every count message and preserve variables`, () => {
    const counts = Object.entries(messages.en).filter(([, value]) => placeholders(value).includes("count"))
    const catalog = pluralMessages[locale]!
    expect(Object.keys(catalog).sort()).toEqual(counts.map(([key]) => key).sort())
    for (const [key, source] of counts) {
      const required = new Intl.PluralRules(locale).resolvedOptions().pluralCategories
      for (const category of required) {
        expect(catalog[key][category] ?? catalog[key].other, `${locale}:${key}:${category}`).toBeTruthy()
      }
      for (const value of Object.values(catalog[key])) expect(placeholders(value)).toEqual(placeholders(source))
    }
  })
}
it("uses plural forms through the public translator", () => {
  expect(translate("en", "tasks.totalCount", { count: 1 })).toBe("1 task")
  expect(translate("en", "tasks.totalCount", { count: 2 })).toBe("2 tasks")
  expect(translate("ru", "knowledge.searchResultCount", { count: 1 })).toBe("1 файл")
  expect(translate("ru", "knowledge.searchResultCount", { count: 2 })).toBe("2 файла")
  expect(translate("ru", "knowledge.searchResultCount", { count: 5 })).toBe("5 файлов")
})
