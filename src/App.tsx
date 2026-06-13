import { AppShell } from "@/components/app-shell/AppShell"
import { ThemeProvider } from "@/components/ThemeProvider"
import { useAuth } from "@/hooks/useAuth"
import { useGlobalScrollbars } from "@/hooks/useGlobalScrollbars"
import { I18nProvider } from "@/i18n/I18nProvider"
import { LoginRoute } from "@/routes/Login"

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
  const account = auth.state.account
  return <AppShell key={account?.id} />
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
