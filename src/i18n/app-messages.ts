import type { AppLocale } from "../../electron/app-locale.ts"

import { enMessages } from "./app-messages.en.ts"
import { zhCNMessages } from "./app-messages.zh.ts"
import es from "./locales/es.json"
import fr from "./locales/fr.json"
import ja from "./locales/ja.json"
import ko from "./locales/ko.json"
import ru from "./locales/ru.json"
import zhTW from "./locales/zh-TW.json"

export const messages = {
  "zh-CN": zhCNMessages,
  en: enMessages,
  "zh-TW": zhTW,
  ja: ja,
  ko: ko,
  ru: ru,
  fr: fr,
  es: es,
} as const satisfies Record<AppLocale, Record<keyof typeof enMessages, string>>
