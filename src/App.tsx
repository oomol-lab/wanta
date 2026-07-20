import { lazy, Suspense } from "react"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { ThemeProvider } from "@/components/ThemeProvider"
import { Button } from "@/components/ui/button"
import { AuthProvider, useAuth } from "@/hooks/useAuth"
import { useGlobalScrollbars } from "@/hooks/useGlobalScrollbars"
import { RuntimeCapabilitiesProvider, useRuntimeCapabilities } from "@/hooks/useRuntimeCapabilities"
import { useT } from "@/i18n"
import { detectInitialLocale, translate } from "@/i18n/i18n"
import { I18nProvider } from "@/i18n/I18nProvider"
import { LoginRoute } from "@/routes/Login"

// 已登录才需要的主界面与数据 Provider：整体懒加载，把聊天渲染的重型依赖（streamdown / motion）
// 及其数据层移出首帧关键路径。登录页 / 未知态可立即绘制，窗口 ready-to-show 不再被整棵依赖树拖住。
const AuthenticatedAppShell = lazy(() =>
  import("@/components/AuthenticatedAppShell").then((module) => ({ default: module.AuthenticatedAppShell })),
)

function AuthGate() {
  const auth = useAuth()
  const runtime = useRuntimeCapabilities()

  // 身份或无凭证 capability 尚未就绪：渲染空背景，避免登录页/主界面闪烁。
  if (!auth.state || (!runtime.capabilities && !runtime.error)) {
    return <div className="h-full bg-background" />
  }

  if (!runtime.capabilities) {
    return <AppShellFallback />
  }

  if (auth.state.status !== "authenticated") {
    return <LoginRoute auth={auth} />
  }

  // key：账号变化时整体重挂载（会话列表 / 连接面板 / isReady 轮询全部重置）。
  // Suspense fallback 复用未知态的空背景，chunk 加载期间不闪烁、不留白；
  // ErrorBoundary 兜底动态 import 失败：渲染可恢复的重载入口，而非崩成空白页。
  const account = auth.state.account
  return (
    <ErrorBoundary fallback={<AppShellFallback />}>
      <Suspense fallback={<div className="h-full bg-background" />}>
        <AuthenticatedAppShell key={`${account?.id}:${runtime.capabilities.mode}`} auth={auth} />
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
