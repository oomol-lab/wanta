import type { AppLocale } from "./app-locale.ts"

import { branding } from "./branding.ts"
import en from "./locales/en.json"
import es from "./locales/es.json"
import fr from "./locales/fr.json"
import ja from "./locales/ja.json"
import ko from "./locales/ko.json"
import ru from "./locales/ru.json"
import zhCN from "./locales/zh-CN.json"
import zhTW from "./locales/zh-TW.json"

export const nativeMessages = { en, "zh-CN": zhCN, "zh-TW": zhTW, ja, ko, ru, fr, es } satisfies Record<
  AppLocale,
  Record<keyof typeof en, string>
>
export type NativeMessageKey = keyof typeof en

export function nativeTranslate(
  locale: AppLocale,
  key: NativeMessageKey,
  vars: Record<string, string | number> = {},
): string {
  const values: Record<string, string | number> = { appName: branding.appName, ...vars }
  return (nativeMessages[locale]?.[key] ?? en[key]).replace(/\{([A-Za-z0-9_.-]+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  )
}
