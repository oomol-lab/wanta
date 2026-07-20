import { lazy, Suspense } from "react"
import { resolveAppEntryState } from "@/app-entry"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { ThemeProvider } from "@/components/ThemeProvider"
import { Button } from "@/components/ui/button"
import { AuthProvider, useAuth } from "@/hooks/useAuth"
import { useGlobalScrollbars } from "@/hooks/useGlobalScrollbars"
import { RuntimeCapabilitiesProvider, useRuntimeCapabilities } from "@/hooks/useRuntimeCapabilities"
import { useT } from "@/i18n"
import { detectInitialLocale, translate } from "@/i18n/i18n"
import { I18nProvider } from "@/i18n/I18nProvider"

// 主界面整体懒加载，把聊天渲染的重型依赖（streamdown / motion）及其数据层移出首帧关键路径。
const AuthenticatedAppShell = lazy(() =>
  import("@/components/AuthenticatedAppShell").then((module) => ({ default: module.AuthenticatedAppShell })),
)

function AuthGate() {
  const auth = useAuth()
  const runtime = useRuntimeCapabilities()
  const entry = resolveAppEntryState({
    authReady: auth.state !== null,
    runtimeFailed: runtime.error !== null,
    runtimeReady: runtime.capabilities !== null,
  })

  if (entry === "loading") {
    return <div className="h-full bg-background" />
  }

  if (entry === "fallback" || !runtime.capabilities || !auth.state) {
    return <AppShellFallback />
  }

  // key：身份/runtime 变化时整体重挂载（会话列表、云数据和 isReady 轮询全部重置）。
  // Suspense fallback 复用未知态的空背景，chunk 加载期间不闪烁、不留白；
  // ErrorBoundary 兜底动态 import 失败：渲染可恢复的重载入口，而非崩成空白页。
  const accountKey = auth.state.status === "authenticated" ? auth.state.account?.id : "local"
  return (
    <ErrorBoundary fallback={<AppShellFallback />}>
      <Suspense fallback={<div className="h-full bg-background" />}>
        <AuthenticatedAppShell key={`${accountKey}:${runtime.capabilities.mode}`} auth={auth} />
      </Suspense>
    </ErrorBoundary>
  )
}

function AppShellFallback() {
  const t = useT()

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-background text-foreground">
      <p className="text-sm text-muted-foreground">{t("app.loadFailed")}</p>
      <Button variant="outline" onClick={() => window.location.reload()}>
        {t("app.reload")}
      </Button>
    </div>
  )
}

export function App() {
  useGlobalScrollbars()

  return (
    <ErrorBoundary fallback={<RootFallback />}>
      <I18nProvider>
        <ThemeProvider>
          <AuthProvider>
            <RuntimeCapabilitiesProvider>
              <AuthGate />
            </RuntimeCapabilitiesProvider>
          </AuthProvider>
        </ThemeProvider>
      </I18nProvider>
    </ErrorBoundary>
  )
}

function RootFallback() {
  const locale = detectInitialLocale()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-background text-foreground">
      <p className="text-sm text-muted-foreground">{translate(locale, "app.renderFailed")}</p>
      <Button variant="outline" onClick={() => window.location.reload()}>
        {translate(locale, "app.reload")}
      </Button>
    </div>
  )
}
