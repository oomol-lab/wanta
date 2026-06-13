import { lazy, Suspense } from "react"
import { ThemeProvider } from "@/components/ThemeProvider"
import { useAuth } from "@/hooks/useAuth"
import { useGlobalScrollbars } from "@/hooks/useGlobalScrollbars"
import { I18nProvider } from "@/i18n/I18nProvider"
import { LoginRoute } from "@/routes/Login"

// 已登录才需要的主界面：懒加载，把聊天渲染的重型依赖（streamdown / shiki / motion，约 2MB）
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
  // fallback 复用未知态的空背景：AppShell chunk 加载期间不闪烁、不留白。
  const account = auth.state.account
  return (
    <Suspense fallback={<div className="h-full bg-background" />}>
      <AppShell key={account?.id} />
    </Suspense>
  )
}

export function App() {
  useGlobalScrollbars()

  return (
    <I18nProvider>
      <ThemeProvider>
        <AuthGate />
      </ThemeProvider>
    </I18nProvider>
  )
}
