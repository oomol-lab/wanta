import { lazy, Suspense } from "react"
import { AppDataProvider } from "@/components/AppDataProvider"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { ThemeProvider } from "@/components/ThemeProvider"
import { Button } from "@/components/ui/button"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAuth } from "@/hooks/useAuth"
import { useGlobalScrollbars } from "@/hooks/useGlobalScrollbars"
import { useT } from "@/i18n"
import { I18nProvider } from "@/i18n/I18nProvider"
import { LoginRoute } from "@/routes/Login"

// 已登录才需要的主界面：懒加载，把聊天渲染的重型依赖（streamdown / motion）
// 移出首帧关键路径。登录页 / 未知态可立即绘制，窗口 ready-to-show 不再被整棵依赖树拖住。
const AppShell = lazy(() => import("@/components/app-shell/AppShell").then((m) => ({ default: m.AppShell })))

function AuthGate() {
  const auth = useAuth()

  // 初始状态未知：渲染空背景，避免登录页/主界面闪烁。
  if (!auth.state) {
    return <div className="h-full bg-background" />
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
        <AppDataProvider>
          <TooltipProvider>
            <AppShell key={account?.id} />
            <Toaster />
          </TooltipProvider>
        </AppDataProvider>
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
          <AuthGate />
        </ThemeProvider>
      </I18nProvider>
    </ErrorBoundary>
  )
}

function RootFallback() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-background text-foreground">
      <p className="text-sm text-muted-foreground">Wanta could not render this window.</p>
      <Button variant="outline" onClick={() => window.location.reload()}>
        Reload
      </Button>
    </div>
  )
}
