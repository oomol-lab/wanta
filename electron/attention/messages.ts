import type { AppLocale } from "../app-locale.ts"

import { supportedAppLocales } from "../app-locale.ts"
import { nativeTranslate } from "../native-messages.ts"

const keys = ["completedBody", "completedTitle", "testBody", "testTitle", "unreadBadge"] as const
export const notificationMessages = Object.fromEntries(
  supportedAppLocales.map((locale) => [
    locale,
    Object.fromEntries(keys.map((key) => [key, nativeTranslate(locale, `notification.${key}`)])),
  ]),
) as Record<AppLocale, Record<(typeof keys)[number], string>>
