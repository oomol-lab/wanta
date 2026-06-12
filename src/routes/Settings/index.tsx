import type { ThemePreference } from "@/components/theme-context"
import type { Locale } from "@/i18n/i18n"

import { Languages, LogOut, Monitor, Moon, Palette, Settings as SettingsIcon, Sun, UserRound } from "lucide-react"
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion"
import { useTheme } from "@/components/theme-context"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/useAuth"
import { useI18n } from "@/i18n/i18n"

const themeOptions = [
  { value: "system", labelKey: "settings.themeSystem", icon: Monitor },
  { value: "light", labelKey: "settings.themeLight", icon: Sun },
  { value: "dark", labelKey: "settings.themeDark", icon: Moon },
] as const

const localeOptions: Array<{ value: Locale; label: string }> = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en", label: "English" },
]

export function SettingsRoute() {
  const { preference, setPreference } = useTheme()
  const { locale, setLocale, t } = useI18n()
  const auth = useAuth()

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-6 overflow-y-auto p-6">
      <div className="flex items-center gap-2">
        <SettingsIcon className="oo-icon-muted size-5" />
        <h1 className="oo-text-value">{t("settings.title")}</h1>
      </div>

      <section className="grid gap-2">
        <h2 className="oo-text-label flex items-center gap-1">
          <UserRound className="size-4" />
          {t("settings.account")}
        </h2>
        <div className="flex items-center gap-3">
          <div className="grid">
            <span className="oo-text-control">{auth.state?.account?.name ?? "—"}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={auth.loggingOut}
            onClick={() => void auth.logout()}
          >
            <LogOut className="size-4" />
            {t("settings.logout")}
          </Button>
        </div>
        {auth.error && <p className="oo-text-caption text-destructive">{auth.error}</p>}
      </section>

      <section className="grid gap-2">
        <h2 className="oo-text-label flex items-center gap-1">
          <Palette className="size-4" />
          {t("settings.theme")}
        </h2>
        <Suggestions>
          {themeOptions.map((option) => (
            <Suggestion
              key={option.value}
              suggestion={option.value}
              variant={preference === (option.value as ThemePreference) ? "default" : "outline"}
              className="gap-2"
              onClick={(value) => setPreference(value as ThemePreference)}
            >
              <option.icon className="size-4" />
              {t(option.labelKey)}
            </Suggestion>
          ))}
        </Suggestions>
      </section>

      <section className="grid gap-2">
        <h2 className="oo-text-label flex items-center gap-1">
          <Languages className="size-4" />
          {t("settings.language")}
        </h2>
        <Suggestions>
          {localeOptions.map((option) => (
            <Suggestion
              key={option.value}
              suggestion={option.value}
              variant={locale === option.value ? "default" : "outline"}
              onClick={(value) => setLocale(value as Locale)}
            >
              {option.label}
            </Suggestion>
          ))}
        </Suggestions>
      </section>
    </div>
  )
}
