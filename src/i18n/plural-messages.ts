import type { AppLocale } from "../../electron/app-locale.ts"

import en from "./plurals/en.json"
import es from "./plurals/es.json"
import fr from "./plurals/fr.json"
import ru from "./plurals/ru.json"

export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }
export const pluralMessages: Partial<Record<AppLocale, Record<string, PluralForms>>> = { en, es, fr, ru }
const rules = new Map<AppLocale, Intl.PluralRules>()
export function pluralMessage(locale: AppLocale, key: string, count: unknown): string | undefined {
  if (typeof count !== "number" || !Number.isFinite(count)) return undefined
  const forms = pluralMessages[locale]?.[key]
  if (!forms) return undefined
  let rule = rules.get(locale)
  if (!rule) {
    rule = new Intl.PluralRules(locale)
    rules.set(locale, rule)
  }
  return forms[rule.select(count)] ?? forms.other
}
