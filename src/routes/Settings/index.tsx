import type { NotificationCapability, NotificationTestResult } from "../../../electron/attention/common.ts"
import type { AuthAccountSummary } from "../../../electron/auth/common.ts"
import type { CompletionNotificationCondition } from "../../../electron/settings/common.ts"
import type { UpdateChannel } from "../../../electron/update/common.ts"
import type { ThemePreference } from "@/components/theme-context"
import type { UseAppUpdate } from "@/hooks/useAppUpdate"
import type { Locale, MessageKey } from "@/i18n/i18n"
import type { UserFacingError } from "@/lib/user-facing-error"

import {
  BellRingIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SunIcon,
} from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { branding } from "../../../electron/branding.ts"
import { notificationPresentation } from "./notification-presentation.ts"
import { CachedAvatarImage } from "@/components/CachedAvatarImage"
import { ErrorNotice } from "@/components/ErrorNotice"
import { PageRouteShell } from "@/components/PageRouteShell"
import { SectionHeading } from "@/components/SectionHeading"
import { useTheme } from "@/components/theme-context"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useAppSettings } from "@/hooks/useAppSettings"
import { useAppUpdate } from "@/hooks/useAppUpdate"
import { useAttention } from "@/hooks/useAttention"
import { useAuth } from "@/hooks/useAuth"
import { useI18n } from "@/i18n/i18n"
import { resolveUserFacingError } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"

const themeOptions = [
  { value: "light", labelKey: "settings.themeLight", icon: SunIcon },
  { value: "dark", labelKey: "settings.themeDark", icon: MoonIcon },
  { value: "system", labelKey: "settings.themeSystem", icon: MonitorIcon },
] as const

const localeOptions: Array<{ value: Locale; label: string }> = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en", label: "English" },
]

const channelOptions = [
  { value: "stable", labelKey: "settings.channelStable" },
  { value: "beta", labelKey: "settings.channelBeta" },
] as const

const completionNotificationOptions = [
  { value: "never", labelKey: "settings.notificationNever" },
  { value: "background", labelKey: "settings.notificationBackground" },
  { value: "always", labelKey: "settings.notificationAlways" },
] as const

const copyFeedbackMs = 3000

export function SettingsRoute({ onBack }: { onBack: () => void }) {
  const { preference, setPreference } = useTheme()
  const { locale, setLocale, t } = useI18n()
  const auth = useAuth()
  const update = useAppUpdate()
  const appSettings = useAppSettings()
  const attention = useAttention()

  return (
    <PageRouteShell backLabel={t("settings.backToApp")} contentClassName="max-w-[60rem] gap-6" onBack={onBack}>
      <h1 className="oo-text-page-title">{t("settings.title")}</h1>

      <div className="grid gap-5">
        <SettingsSection title={t("settings.groupPersonal")}>
          <AccountSettings
            account={auth.state?.account}
            error={auth.error}
            loggingOut={auth.loggingOut}
            onLogout={() => void auth.logout()}
          />
          <SettingsItem title={t("settings.appearance")}>
            <ThemeSettings preference={preference} setPreference={setPreference} />
          </SettingsItem>
          <SettingsItem title={t("settings.language")}>
            <LanguageSettings locale={locale} setLocale={setLocale} />
          </SettingsItem>
        </SettingsSection>

        <SettingsSection title={t("settings.groupApplication")}>
          <NotificationSettings
            capability={attention.notificationCapability}
            loading={appSettings.loading}
            settings={appSettings.settings}
            onConditionChange={appSettings.setCompletionNotificationCondition}
            onSoundChange={appSettings.setNotificationSoundEnabled}
            onOpenSystemSettings={attention.openSystemNotificationSettings}
            onBadgeChange={appSettings.setUnreadBadgeEnabled}
            onTest={attention.testCompletionNotification}
          />
          <AboutSettings update={update} />
          <SettingsItem title={t("settings.updateChannel")} description={t("settings.channelHint")}>
            <UpdateChannelSettings update={update} />
          </SettingsItem>
        </SettingsSection>

        <SettingsSection title={t("settings.groupBetaFeatures")}>
          <SettingsItem title={t("settings.knowledgeBeta")} description={t("settings.knowledgeBetaDescription")}>
            <KnowledgeBetaToggle
              enabled={appSettings.settings.knowledgeBaseBetaEnabled}
              loading={appSettings.loading}
              onChange={appSettings.setKnowledgeBaseBetaEnabled}
            />
          </SettingsItem>
        </SettingsSection>
      </div>
    </PageRouteShell>
  )
}

function NotificationSettings({
  capability,
  loading,
  onBadgeChange,
  onConditionChange,
  onOpenSystemSettings,
  onSoundChange,
  onTest,
  settings,
}: {
  capability: NotificationCapability | null
  loading: boolean
  onBadgeChange: (enabled: boolean) => Promise<void>
  onConditionChange: (condition: CompletionNotificationCondition) => Promise<void>
  onOpenSystemSettings: () => Promise<void>
  onSoundChange: (enabled: boolean) => Promise<void>
  onTest: () => Promise<NotificationTestResult>
  settings: ReturnType<typeof useAppSettings>["settings"]
}) {
  const { t } = useI18n()
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [lastTestResult, setLastTestResult] = React.useState<NotificationTestResult | null>(null)
  const disabled = loading || saving || testing
  const testDisabled =
    disabled || !capability || capability.status === "unsupported" || capability.status === "development-unavailable"
  const presentation = notificationPresentation(capability, lastTestResult)

  const save = React.useCallback(
    (task: Promise<void>) => {
      setSaving(true)
      void task
        .catch((error: unknown) => {
          toast.error(t("settings.notificationsUpdateFailed"))
          console.error("[wanta] update notification setting failed", error)
        })
        .finally(() => setSaving(false))
    },
    [t],
  )

  return (
    <>
      <SettingsItem title={t("settings.notificationSystemStatus")} description={t(presentation.descriptionKey)}>
        <div className="flex flex-wrap justify-end gap-2 max-[760px]:justify-start">
          {presentation.recovery && capability?.canOpenSystemSettings ? (
            <SystemNotificationSettingsButton
              disabled={disabled}
              labelKey={presentation.settingsLabelKey}
              onOpen={onOpenSystemSettings}
            />
          ) : null}
          <Button
            type="button"
            variant={presentation.recovery ? "outline" : "default"}
            size="sm"
            disabled={testDisabled}
            onClick={() => {
              setTesting(true)
              void onTest()
                .then((result) => {
                  setLastTestResult(result)
                  if (result.outcome === "shown") {
                    toast.success(t("settings.notificationTestSent"))
                    return
                  }
                  toast.error(t(notificationTestFailureKey(result)))
                  console.error("[wanta] test notification was not delivered", result)
                })
                .catch((error: unknown) => {
                  setLastTestResult({
                    error: error instanceof Error ? error.message : String(error),
                    outcome: "failed",
                  })
                  toast.error(t("settings.notificationTestFailed"))
                  console.error("[wanta] test notification failed", error)
                })
                .finally(() => setTesting(false))
            }}
          >
            <BellRingIcon className="size-4" />
            {t(presentation.testLabelKey)}
          </Button>
          {!presentation.recovery && capability?.canOpenSystemSettings ? (
            <SystemNotificationSettingsButton
              disabled={disabled}
              labelKey={presentation.settingsLabelKey}
              onOpen={onOpenSystemSettings}
            />
          ) : null}
        </div>
      </SettingsItem>
      <SettingsItem title={t("settings.notifications")} description={t("settings.notificationsDescription")}>
        <ToggleGroup
          type="single"
          value={settings.completionNotificationCondition}
          onValueChange={(value) => {
            if (value) save(onConditionChange(value as CompletionNotificationCondition))
          }}
          variant="outline"
          size="sm"
          disabled={disabled}
          className="flex-wrap justify-end max-[760px]:grid max-[760px]:w-full max-[760px]:grid-cols-3"
        >
          {completionNotificationOptions.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value} className="max-[760px]:w-full">
              {t(option.labelKey)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </SettingsItem>
      <SettingsItem title={t("settings.notificationSound")} description={t("settings.notificationSoundDescription")}>
        <Switch
          checked={settings.notificationSoundEnabled}
          disabled={disabled}
          aria-label={t("settings.notificationSound")}
          onCheckedChange={(enabled) => save(onSoundChange(enabled))}
        />
      </SettingsItem>
      <SettingsItem title={t("settings.notificationBadge")} description={t("settings.notificationBadgeDescription")}>
        <Switch
          checked={settings.unreadBadgeEnabled}
          disabled={disabled}
          aria-label={t("settings.notificationBadge")}
          onCheckedChange={(enabled) => save(onBadgeChange(enabled))}
        />
      </SettingsItem>
    </>
  )
}

function SystemNotificationSettingsButton({
  disabled,
  labelKey,
  onOpen,
}: {
  disabled: boolean
  labelKey: MessageKey
  onOpen: () => Promise<void>
}) {
  const { t } = useI18n()
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={() => {
        void onOpen().catch((error: unknown) => {
          toast.error(t("settings.notificationSettingsOpenFailed"))
          console.error("[wanta] open system notification settings failed", error)
        })
      }}
    >
      {t(labelKey)}
    </Button>
  )
}

function notificationTestFailureKey(
  result: NotificationTestResult,
): "settings.notificationTestFailed" | "settings.notificationTestTimedOut" | "settings.notificationUnsupported" {
  switch (result.outcome) {
    case "timed-out":
      return "settings.notificationTestTimedOut"
    case "unsupported":
      return "settings.notificationUnsupported"
    default:
      return "settings.notificationTestFailed"
  }
}

function KnowledgeBetaToggle({
  enabled,
  loading,
  onChange,
}: {
  enabled: boolean
  loading: boolean
  onChange: (enabled: boolean) => Promise<void>
}) {
  const { t } = useI18n()
  const [saving, setSaving] = React.useState(false)
  const disabled = loading || saving

  return (
    <Switch
      checked={enabled}
      disabled={disabled}
      aria-label={t("settings.knowledgeBeta")}
      onCheckedChange={(next) => {
        setSaving(true)
        void onChange(next)
          .catch((error: unknown) => {
            toast.error(t("settings.knowledgeBetaUpdateFailed"))
            console.error("[wanta] update knowledge beta setting failed", error)
          })
          .finally(() => setSaving(false))
      }}
    />
  )
}

function SettingsSection({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="grid gap-2">
      <SectionHeading>{title}</SectionHeading>
      <div className="overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">{children}</div>
    </section>
  )
}

function SettingsItem({
  children,
  description,
  title,
}: {
  children: React.ReactNode
  description?: React.ReactNode
  title: string
}) {
  return (
    <section className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-[var(--oo-divider)] px-3 py-2.5 last:border-b-0 max-[760px]:grid-cols-1">
      <div className="min-w-0">
        <h3 className="oo-text-label truncate text-foreground">{title}</h3>
        {description ? <div className="oo-text-caption mt-0.5 max-w-[44rem]">{description}</div> : null}
      </div>
      <div className="min-w-0 justify-self-end max-[760px]:w-full max-[760px]:justify-self-stretch">{children}</div>
    </section>
  )
}

function AccountSettings({
  account,
  error,
  loggingOut,
  onLogout,
}: {
  account?: AuthAccountSummary
  error?: UserFacingError | null
  loggingOut: boolean
  onLogout: () => void
}) {
  const { t } = useI18n()
  const accountCopy = useClipboardCopy()
  const displayName = account?.name.trim() || t("settings.account")
  const AccountCopyIcon = accountCopy.copied ? CheckIcon : CopyIcon

  return (
    <>
      <section className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 border-b border-[var(--oo-divider)] px-3 py-3 max-[760px]:grid-cols-1">
        <div className="flex min-w-0 items-center gap-3">
          <AccountAvatar name={displayName} avatarUrl={account?.avatarUrl} />
          <div className="min-w-0">
            <div className="oo-text-title truncate text-foreground">{displayName}</div>
            <div className="oo-text-caption truncate">{account ? t("settings.signedIn") : t("settings.signedOut")}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 max-[760px]:justify-start">
          {account ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(accountCopy.copied && "bg-accent text-foreground hover:bg-accent hover:text-foreground")}
              onClick={() => void accountCopy.copyText(formatAccountInfo(account, t))}
            >
              <AccountCopyIcon className="size-4" />
              {accountCopy.copied ? t("settings.copied") : t("settings.copyAccountInfo")}
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" disabled={loggingOut || !account} onClick={onLogout}>
            <LogOutIcon className="size-4" />
            {t("settings.logout")}
          </Button>
        </div>
      </section>

      {account ? <AccountField label={t("settings.userId")} value={account.id} /> : null}

      {error ? <ErrorNotice error={error} compact className="m-3" /> : null}
    </>
  )
}

function AccountField({ label, value }: { label: string; value: string }) {
  const { t } = useI18n()
  const fieldCopy = useClipboardCopy()
  const FieldCopyIcon = fieldCopy.copied ? CheckIcon : CopyIcon

  return (
    <div className="grid min-h-12 grid-cols-[minmax(8rem,0.35fr)_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--oo-divider)] px-3 py-2.5 max-[760px]:grid-cols-[minmax(0,1fr)_auto]">
      <div className="oo-text-label text-muted-foreground max-[760px]:col-span-2">{label}</div>
      <div className="oo-text-control min-w-0 truncate font-mono text-foreground">{value}</div>
      <button
        type="button"
        onClick={() => void fieldCopy.copyText(value)}
        className={cn(
          "grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
          fieldCopy.copied && "bg-accent text-foreground hover:bg-accent hover:text-foreground",
        )}
        aria-label={fieldCopy.copied ? t("settings.copied") : t("settings.copyField", { field: label })}
        title={fieldCopy.copied ? t("settings.copied") : t("settings.copyField", { field: label })}
      >
        <FieldCopyIcon className="size-4" />
      </button>
    </div>
  )
}

function ThemeSettings({
  preference,
  setPreference,
}: {
  preference: ThemePreference
  setPreference: (preference: ThemePreference) => void
}) {
  const { t } = useI18n()
  return (
    <ToggleGroup
      type="single"
      value={preference}
      onValueChange={(value) => {
        if (value) {
          setPreference(value as ThemePreference)
        }
      }}
      variant="outline"
      size="sm"
      className="flex-wrap"
    >
      {themeOptions.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value}>
          <option.icon className="size-4" />
          {t(option.labelKey)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

function LanguageSettings({ locale, setLocale }: { locale: Locale; setLocale: (locale: Locale) => void }) {
  return (
    <ToggleGroup
      type="single"
      value={locale}
      onValueChange={(value) => {
        if (value) {
          setLocale(value as Locale)
        }
      }}
      variant="outline"
      size="sm"
      className="flex-wrap"
    >
      {localeOptions.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

function AboutSettings({ update }: { update: UseAppUpdate }) {
  const { t } = useI18n()
  const statusText = getUpdateStatusText(update, t)
  const updateStatus = update.state?.status
  const downloadingStatus = updateStatus?.status === "downloading" ? updateStatus : null
  const updateError =
    updateStatus?.status === "error" ? resolveUserFacingError(updateStatus.error, { area: "update" }) : null
  const percent = Math.round(downloadingStatus?.percent ?? 0)
  const version = update.state?.currentVersion ?? globalThis.wanta?.version ?? "—"
  const platform = globalThis.wanta?.platform ?? "browser"

  return (
    <section className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 border-b border-[var(--oo-divider)] px-3 py-3 max-[760px]:grid-cols-1">
      <div className="grid min-w-0 gap-1">
        <div className="oo-text-label text-muted-foreground">{branding.appName}</div>
        <div className="oo-text-value text-foreground">v{version}</div>
        <div className="oo-text-caption">{t("settings.platform", { platform })}</div>
        {updateError ? null : <div className="oo-text-caption">{statusText}</div>}
        {updateError ? <ErrorNotice error={updateError} compact className="mt-2 max-w-xl" /> : null}
        {downloadingStatus ? <Progress value={percent} className="mt-3 h-1.5 max-w-sm" /> : null}
      </div>
      <UpdateAction update={update} />
    </section>
  )
}

function UpdateChannelSettings({ update }: { update: UseAppUpdate }) {
  const { t } = useI18n()
  return (
    <div className="grid max-w-[48rem] gap-3">
      <ToggleGroup
        type="single"
        value={update.state?.channel ?? "stable"}
        onValueChange={(value) => {
          if (value) {
            void update.setChannel(value as UpdateChannel)
          }
        }}
        variant="outline"
        size="sm"
        className="flex-wrap"
      >
        {channelOptions.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value}>
            {t(option.labelKey)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
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
          <RefreshCwIcon className="size-4 animate-spin" />
          {t("settings.updateChecking")}
        </Button>
      )
    case "available":
      return (
        <Button variant="outline" size="sm" onClick={() => void update.download()}>
          <DownloadIcon className="size-4" />
          {t("settings.updateDownload")}
        </Button>
      )
    case "downloading":
      return (
        <Button variant="outline" size="sm" disabled>
          <DownloadIcon className="size-4" />
          {t("settings.updateDownloading", { percent: Math.round(state.status.percent ?? 0) })}
        </Button>
      )
    case "downloaded":
      return (
        <Button variant="outline" size="sm" onClick={() => void update.install()}>
          <RotateCcwIcon className="size-4" />
          {t("settings.updateRestart")}
        </Button>
      )
    default:
      return (
        <Button variant="outline" size="sm" onClick={() => void update.checkAndDownload()}>
          <RefreshCwIcon className="size-4" />
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
      return t("error.update.title")
    default:
      return t("settings.updateIdle")
  }
}

function AccountAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  return (
    <div className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-semibold text-foreground">
      <span aria-hidden="true">{name.trim().charAt(0).toLocaleUpperCase() || "L"}</span>
      <CachedAvatarImage src={avatarUrl} alt="" className="absolute inset-0 size-full object-cover" />
    </div>
  )
}

function useClipboardCopy(): { copied: boolean; copyText: (text: string) => Promise<boolean> } {
  const { t } = useI18n()
  const [copied, setCopied] = React.useState(false)
  const timeoutRef = React.useRef<number | undefined>(undefined)

  React.useEffect(
    () => () => {
      if (timeoutRef.current !== undefined) {
        window.clearTimeout(timeoutRef.current)
      }
    },
    [],
  )

  const copyText = React.useCallback(
    async (text: string): Promise<boolean> => {
      const didCopy = await writeClipboardText(text)
      if (!didCopy) {
        setCopied(false)
        toast.error(t("settings.copyFailed"))
        return false
      }

      setCopied(true)
      if (timeoutRef.current !== undefined) {
        window.clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = window.setTimeout(() => setCopied(false), copyFeedbackMs)
      return true
    },
    [t],
  )

  return { copied, copyText }
}

async function writeClipboardText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 继续走 DOM fallback。
    }
  }

  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.top = "-9999px"
  textarea.style.left = "-9999px"
  document.body.append(textarea)
  textarea.select()
  try {
    return document.execCommand("copy")
  } finally {
    textarea.remove()
  }
}

function formatAccountInfo(account: AuthAccountSummary, t: ReturnType<typeof useI18n>["t"]): string {
  const wanta = globalThis.wanta
  const version = wanta?.version ?? "unknown"
  const platform = wanta?.platform ?? "browser"
  const appCommit = wanta?.appCommit ?? "unknown"
  const lines = [
    t("settings.accountDiagnosticsTitle"),
    `${t("settings.accountName")}: ${account.name}`,
    `${t("settings.userId")}: ${account.id}`,
    `${t("settings.appVersion")}: ${version}`,
    `${t("settings.appCommit")}: ${appCommit}`,
    `${t("settings.platformName")}: ${platform}`,
  ]
  return lines.join("\n")
}
