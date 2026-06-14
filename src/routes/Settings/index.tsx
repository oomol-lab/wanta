import type { UpdateChannel } from "../../../electron/update/common.ts"
import type { ThemePreference } from "@/components/theme-context"
import type { UseAppUpdate } from "@/hooks/useAppUpdate"
import type { Locale } from "@/i18n/i18n"

import {
  ArrowLeft,
  Languages,
  LogOut,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  Sun,
  UserRound,
} from "lucide-react"
import * as React from "react"
import { useTheme } from "@/components/theme-context"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useAppUpdate } from "@/hooks/useAppUpdate"
import { useAuth } from "@/hooks/useAuth"
import { useI18n } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

type SettingsSectionId = "general" | "appearance" | "account" | "updates"

const sections = [
  { id: "general", labelKey: "settings.general", groupKey: "settings.groupPersonal", icon: SettingsIcon },
  { id: "appearance", labelKey: "settings.appearance", groupKey: "settings.groupPersonal", icon: Palette },
  { id: "account", labelKey: "settings.account", groupKey: "settings.groupPersonal", icon: UserRound },
  { id: "updates", labelKey: "settings.update", groupKey: "settings.groupApplication", icon: RefreshCw },
] as const
type SettingsSectionMeta = (typeof sections)[number]

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

export function SettingsRoute({ onBack }: { onBack: () => void }) {
  const { preference, setPreference } = useTheme()
  const { locale, setLocale, t } = useI18n()
  const auth = useAuth()
  const update = useAppUpdate()
  const [activeSection, setActiveSection] = React.useState<SettingsSectionId>("general")
  const [query, setQuery] = React.useState("")
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredSections = normalizedQuery
    ? sections.filter((section) => t(section.labelKey).toLocaleLowerCase().includes(normalizedQuery))
    : sections

  React.useEffect(() => {
    if (filteredSections.length > 0 && !filteredSections.some((section) => section.id === activeSection)) {
      setActiveSection(filteredSections[0].id)
    }
  }, [activeSection, filteredSections])

  const activeMeta = sections.find((section) => section.id === activeSection) ?? sections[0]

  return (
    <div className="grid h-full min-h-0 grid-cols-[280px_minmax(0,1fr)] bg-background text-foreground max-[760px]:grid-cols-1">
      <aside className="oo-border-divider flex min-h-0 flex-col border-r bg-sidebar">
        <header
          className="flex h-[var(--app-titlebar-height)] shrink-0 items-center [-webkit-app-region:drag]"
          style={{ paddingLeft: "var(--traffic-light-space)", paddingRight: "12px" }}
        />
        <div className="flex min-h-0 flex-1 flex-col gap-5 px-4 pb-5">
          <button
            type="button"
            onClick={onBack}
            className="oo-sidebar-nav-item oo-text-control flex h-8 w-fit items-center gap-2 rounded-md px-2 text-sidebar-foreground [-webkit-app-region:no-drag]"
          >
            <ArrowLeft className="size-4" />
            <span>{t("settings.backToApp")}</span>
          </button>

          <label className="flex h-9 items-center gap-2 rounded-lg border border-sidebar-border bg-background/35 px-3 text-sidebar-foreground [-webkit-app-region:no-drag]">
            <Search className="size-4 shrink-0 opacity-70" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("settings.searchPlaceholder")}
              className="oo-text-control min-w-0 flex-1 border-0 bg-transparent p-0 text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>

          <nav className="min-h-0 flex-1 overflow-y-auto [-webkit-app-region:no-drag]" aria-label={t("settings.title")}>
            <SettingsSidebar
              activeSection={activeSection}
              filteredSections={filteredSections}
              onSelect={setActiveSection}
            />
          </nav>
        </div>
      </aside>

      <main className="grid min-h-0 grid-rows-[var(--app-titlebar-height)_minmax(0,1fr)]">
        <header className="h-[var(--app-titlebar-height)] shrink-0 [-webkit-app-region:drag]" />
        <div className="min-h-0 overflow-y-auto">
          <div className="mx-auto w-full max-w-[860px] px-10 pt-14 pb-16 max-[760px]:px-5 max-[760px]:pt-8">
            <h1 className="oo-text-title text-2xl font-semibold tracking-normal">{t(activeMeta.labelKey)}</h1>
            <div className="mt-14 max-[760px]:mt-8">
              {activeSection === "general" ? (
                <GeneralSettings locale={locale} setLocale={setLocale} />
              ) : activeSection === "appearance" ? (
                <AppearanceSettings preference={preference} setPreference={setPreference} />
              ) : activeSection === "account" ? (
                <AccountSettings
                  accountName={auth.state?.account?.name}
                  avatarUrl={auth.state?.account?.avatarUrl}
                  error={auth.error}
                  loggingOut={auth.loggingOut}
                  onLogout={() => void auth.logout()}
                />
              ) : (
                <UpdateSettings update={update} />
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

function SettingsSidebar({
  activeSection,
  filteredSections,
  onSelect,
}: {
  activeSection: SettingsSectionId
  filteredSections: readonly SettingsSectionMeta[]
  onSelect: (section: SettingsSectionId) => void
}) {
  const { t } = useI18n()
  const grouped = filteredSections.reduce<
    Array<{ groupKey: SettingsSectionMeta["groupKey"]; items: SettingsSectionMeta[] }>
  >((groups, section) => {
    const group = groups.find((item) => item.groupKey === section.groupKey)
    if (group) {
      group.items.push(section)
    } else {
      groups.push({ groupKey: section.groupKey, items: [section] })
    }
    return groups
  }, [])

  if (grouped.length === 0) {
    return <p className="oo-text-caption px-2 py-3 text-muted-foreground">{t("settings.searchEmpty")}</p>
  }

  return (
    <div className="grid gap-6">
      {grouped.map((group) => (
        <section key={group.groupKey} className="grid gap-2">
          <h2 className="oo-text-caption px-2 text-muted-foreground">{t(group.groupKey)}</h2>
          <div className="grid gap-1">
            {group.items.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item.id)}
                  className={cn(
                    "oo-sidebar-nav-item oo-text-control flex h-9 items-center gap-2 rounded-md px-2 text-left",
                    activeSection === item.id && "bg-sidebar-accent text-sidebar-accent-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="truncate">{t(item.labelKey)}</span>
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

function GeneralSettings({ locale, setLocale }: { locale: Locale; setLocale: (locale: Locale) => void }) {
  const { t } = useI18n()
  return (
    <SettingsSection>
      <SettingsGroup>
        <SettingsRow
          title={t("settings.language")}
          description={t("settings.languageDescription")}
          action={
            <LanguageSelect
              value={locale}
              onChange={(value) => {
                setLocale(value)
              }}
            />
          }
        />
      </SettingsGroup>
    </SettingsSection>
  )
}

function AppearanceSettings({
  preference,
  setPreference,
}: {
  preference: ThemePreference
  setPreference: (preference: ThemePreference) => void
}) {
  const { t } = useI18n()
  return (
    <SettingsSection>
      <SettingsGroup>
        <SettingsRow
          title={t("settings.theme")}
          description={t("settings.themeDescription")}
          action={
            <ToggleGroup
              type="single"
              value={preference}
              onValueChange={(value) => {
                if (value) {
                  setPreference(value as ThemePreference)
                }
              }}
              variant="outline"
              size="lg"
              spacing={1}
              className="flex-wrap justify-end"
            >
              {themeOptions.map((option) => (
                <ToggleGroupItem key={option.value} value={option.value} className="px-3">
                  <option.icon className="size-4" />
                  {t(option.labelKey)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          }
        />
      </SettingsGroup>
    </SettingsSection>
  )
}

function AccountSettings({
  accountName,
  avatarUrl,
  error,
  loggingOut,
  onLogout,
}: {
  accountName?: string
  avatarUrl?: string
  error?: string | null
  loggingOut: boolean
  onLogout: () => void
}) {
  const { t } = useI18n()
  const displayName = accountName?.trim() || t("settings.account")
  return (
    <SettingsSection>
      <SettingsGroup>
        <SettingsRow
          title={t("settings.account")}
          description={error ? error : t("settings.accountDescription", { name: displayName })}
          descriptionClassName={error ? "text-destructive" : undefined}
          action={
            <div className="flex items-center gap-3">
              <AccountAvatar name={displayName} avatarUrl={avatarUrl} />
              <Button variant="outline" size="sm" className="gap-2" disabled={loggingOut} onClick={onLogout}>
                <LogOut className="size-4" />
                {t("settings.logout")}
              </Button>
            </div>
          }
        />
      </SettingsGroup>
    </SettingsSection>
  )
}

function UpdateSettings({ update }: { update: UseAppUpdate }) {
  const { t } = useI18n()
  const statusText = getUpdateStatusText(update, t)
  const updateStatus = update.state?.status
  const downloadingStatus = updateStatus?.status === "downloading" ? updateStatus : null
  const percent = Math.round(downloadingStatus?.percent ?? 0)

  return (
    <SettingsSection>
      <SettingsGroup>
        <SettingsRow
          title={t("settings.updateCurrentVersion", { version: update.state?.currentVersion ?? "—" })}
          description={statusText}
          action={<UpdateAction update={update} />}
        />
        {downloadingStatus ? (
          <div className="border-t px-4 py-3">
            <Progress value={percent} className="h-1.5" />
          </div>
        ) : null}
        <SettingsRow
          title={t("settings.updateChannel")}
          description={t("settings.channelHint")}
          action={
            <ToggleGroup
              type="single"
              value={update.state?.channel ?? "stable"}
              onValueChange={(value) => {
                if (value) {
                  void update.setChannel(value as UpdateChannel)
                }
              }}
              variant="outline"
              size="lg"
              spacing={1}
              className="justify-end"
            >
              {channelOptions.map((option) => (
                <ToggleGroupItem key={option.value} value={option.value} className="px-3">
                  {t(option.labelKey)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          }
        />
      </SettingsGroup>
    </SettingsSection>
  )
}

function SettingsSection({ children }: { children: React.ReactNode }) {
  return <section>{children}</section>
}

function SettingsGroup({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-lg border bg-background">{children}</div>
}

function SettingsRow({
  title,
  description,
  descriptionClassName,
  action,
}: {
  title: string
  description: string
  descriptionClassName?: string
  action: React.ReactNode
}) {
  return (
    <div className="grid min-h-20 grid-cols-[minmax(0,1fr)_auto] items-center gap-8 border-b px-4 py-4 last:border-b-0 max-[760px]:grid-cols-1 max-[760px]:gap-3">
      <div className="min-w-0">
        <h2 className="oo-text-value font-medium">{title}</h2>
        <p className={cn("oo-text-control mt-1 max-w-[560px] text-muted-foreground", descriptionClassName)}>
          {description}
        </p>
      </div>
      <div className="flex min-w-0 justify-end max-[760px]:justify-start">{action}</div>
    </div>
  )
}

function LanguageSelect({ value, onChange }: { value: Locale; onChange: (value: Locale) => void }) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as Locale)}>
      <SelectTrigger className="h-[var(--oo-control-height-comfortable)] w-[180px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {localeOptions.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <Languages className="size-4" />
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function UpdateAction({ update }: { update: UseAppUpdate }) {
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

function getUpdateStatusText(update: UseAppUpdate, t: ReturnType<typeof useI18n>["t"]): string {
  const state = update.state
  if (!state) {
    return " "
  }
  if (!state.isPackaged) {
    return t("settings.updateDevUnavailable")
  }
  switch (state.status.status) {
    case "checking":
      return t("settings.updateChecking")
    case "not-available":
      return t("settings.updateUpToDate")
    case "available":
      return t(state.channel === "beta" ? "settings.updateAvailableOnBeta" : "settings.updateAvailable", {
        version: state.status.version,
      })
    case "downloaded":
      return t("settings.updateDownloaded", { version: state.status.version })
    case "downloading":
      return t("settings.updateDownloading", { percent: Math.round(state.status.percent ?? 0) })
    case "error":
      return t("settings.updateError", { error: state.status.error })
    default:
      return t("settings.updateIdle")
  }
}

function AccountAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    setFailed(false)
  }, [avatarUrl])

  return (
    <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-medium text-foreground">
      {avatarUrl && !failed ? (
        <img
          src={avatarUrl}
          alt=""
          className="size-full object-cover"
          draggable={false}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        name.trim().charAt(0).toLocaleUpperCase() || "L"
      )}
    </div>
  )
}
