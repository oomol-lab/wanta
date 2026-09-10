import type { LocalePreference, TranslateFn } from "./i18n.ts"

import * as React from "react"
import { isLocalePreference } from "../../electron/app-locale.ts"
import { detectLocalePreference, I18nContext, localeStorageKey, systemLocale, translate } from "./i18n.ts"

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreference] = React.useState<LocalePreference>(detectLocalePreference)
  const [detected, setDetected] = React.useState(systemLocale)
  const [hydrated, setHydrated] = React.useState(false)
  const changedByUser = React.useRef(false)
  const locale = preference === "system" ? detected : preference

  React.useEffect(() => {
    let cancelled = false
    const override = import.meta.env.VITE_WANTA_LOCALE
    void Promise.resolve(globalThis.wanta?.getAppLocalePreference?.())
      .then((saved) => {
        if (!cancelled && !changedByUser.current && !isLocalePreference(override) && isLocalePreference(saved)) {
          setPreference(saved)
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setHydrated(true)
      })
    const update = () => setDetected(systemLocale())
    globalThis.addEventListener("languagechange", update)
    return () => {
      cancelled = true
      globalThis.removeEventListener("languagechange", update)
    }
  }, [])

  React.useEffect(() => {
    document.documentElement.lang = locale
    if (hydrated) {
      // The native store is authoritative; localStorage is a startup cache and legacy migration source.
      globalThis.wanta?.setAppLocale(
        locale,
        isLocalePreference(import.meta.env.VITE_WANTA_LOCALE) ? undefined : preference,
      )
      if (!isLocalePreference(import.meta.env.VITE_WANTA_LOCALE)) {
        try {
          globalThis.localStorage?.setItem(localeStorageKey, preference)
        } catch {
          /* Best-effort startup cache. */
        }
      }
    }
  }, [locale, preference, hydrated])

  const setLocale = React.useCallback((next: LocalePreference) => {
    if (!isLocalePreference(next)) return
    changedByUser.current = true
    setPreference(next)
  }, [])
  const t = React.useCallback<TranslateFn>((key, vars) => translate(locale, key, vars), [locale])
  const value = React.useMemo(() => ({ locale, preference, setLocale, t }), [locale, preference, setLocale, t])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
