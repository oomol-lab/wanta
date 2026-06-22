import type { Locale, TranslateFn } from "./i18n.ts"

import * as React from "react"
import { detectInitialLocale, I18nContext, localeStorageKey, translate } from "./i18n.ts"

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = React.useState<Locale>(detectInitialLocale)

  React.useEffect(() => {
    document.documentElement.lang = locale
    globalThis.lumo?.setAppLocale(locale)
  }, [locale])

  const setLocale = React.useCallback((next: Locale) => {
    setLocaleState(next)
    globalThis.localStorage?.setItem(localeStorageKey, next)
  }, [])

  const t = React.useCallback<TranslateFn>((key, vars) => translate(locale, key, vars), [locale])

  const value = React.useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
