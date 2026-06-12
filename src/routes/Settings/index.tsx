import type { UpdateChannel } from "../../../electron/update/common"
import type { ThemePreference } from "@/components/theme-context"
import type { Locale } from "@/i18n/i18n"

import {
  Languages,
  LogOut,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  Settings as SettingsIcon,
  Sun,
  UserRound,
} from "lucide-react"
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion"
import { useTheme } from "@/components/theme-context"
import { Button } from "@/components/ui/button"
import { useAppUpdate } from "@/hooks/useAppUpdate"
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

const channelOptions = [
  { value: "stable", labelKey: "settings.channelStable" },
  { value: "beta", labelKey: "settings.channelBeta" },
] as const

export function SettingsRoute() {
  const { preference, setPreference } = useTheme()
  const { locale, setLocale, t } = useI18n()
  const auth = useAuth()
  const update = useAppUpdate()

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

      <section className="grid gap-2">
        <h2 className="oo-text-label flex items-center gap-1">
          <RefreshCw className="size-4" />
          {t("settings.update")}
        </h2>
        <div className="flex items-center gap-3">
          <span className="oo-text-control">
            {t("settings.updateCurrentVersion", { version: update.state?.currentVersion ?? "—" })}
          </span>
          <UpdateAction update={update} />
        </div>
        <UpdateStatusLine update={update} />
        <h3 className="oo-text-label">{t("settings.updateChannel")}</h3>
        <Suggestions>
          {channelOptions.map((option) => (
            <Suggestion
              key={option.value}
              suggestion={option.value}
              variant={update.state?.channel === option.value ? "default" : "outline"}
              onClick={(value) => void update.setChannel(value as UpdateChannel)}
            >
              {t(option.labelKey)}
            </Suggestion>
          ))}
        </Suggestions>
        <p className="oo-text-caption">{t("settings.channelHint")}</p>
      </section>
    </div>
  )
}

/** 更新主操作按钮：随状态在 检查 / 下载 / 重启安装 间切换；dev（未打包）无操作。 */
function UpdateAction({ update }: { update: ReturnType<typeof useAppUpdate> }) {
  const { t } = useI18n()
  const state = update.state
  if (!state || !state.isPackaged) {
    return null
  }
  switch (state.status.status) {
    case "checking":
      return (
        <Button variant="outline" size="sm" disabled>
          {t("settings.updateChecking")}
        </Button>
      )
    case "available":
      return (
        <Button variant="outline" size="sm" onClick={() => void update.download()}>
          {t("settings.updateDownload")}
        </Button>
      )
    case "downloading":
      return (
        <Button variant="outline" size="sm" disabled>
          {t("settings.updateDownloading", { percent: Math.round(state.status.percent ?? 0) })}
        </Button>
      )
    case "downloaded":
      return (
        <Button variant="outline" size="sm" onClick={() => void update.install()}>
          {t("settings.updateRestart")}
        </Button>
      )
    default:
      return (
        <Button variant="outline" size="sm" onClick={() => void update.check()}>
          {t("settings.updateCheck")}
        </Button>
      )
  }
}

/** 更新状态说明行（仅在有可说明内容时渲染）。 */
function UpdateStatusLine({ update }: { update: ReturnType<typeof useAppUpdate> }) {
  const { t } = useI18n()
  const state = update.state
  if (!state) {
    return null
  }
  if (!state.isPackaged) {
    return <p className="oo-text-caption">{t("settings.updateDevUnavailable")}</p>
  }
  switch (state.status.status) {
    case "not-available":
      return <p className="oo-text-caption">{t("settings.updateUpToDate")}</p>
    case "available":
      return <p className="oo-text-caption">{t("settings.updateAvailable", { version: state.status.version })}</p>
    case "downloaded":
      return <p className="oo-text-caption">{t("settings.updateDownloaded", { version: state.status.version })}</p>
    case "error":
      return (
        <p className="oo-text-caption text-destructive">{t("settings.updateError", { error: state.status.error })}</p>
      )
    default:
      return null
  }
}
