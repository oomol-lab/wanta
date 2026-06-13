import type { UseAuth } from "@/hooks/useAuth"

import { LogIn, Sparkles } from "lucide-react"
import { branding } from "../../../electron/branding.ts"
import { Loader } from "@/components/ai-elements/loader"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"

/** 首屏登录页：打开系统浏览器完成 OOMOL 登录，deep-link 回调后自动进入主界面。 */
export function LoginRoute({ auth }: { auth: UseAuth }) {
  const t = useT()

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* 无边框窗口的可拖拽标题区 */}
      <header className="h-[var(--app-titlebar-height)] shrink-0 [-webkit-app-region:drag]" />

      <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-8 pb-16">
        <div className="flex flex-col items-center gap-3">
          <Sparkles className="oo-icon-accent size-10" />
          <h1 className="oo-text-title text-2xl font-semibold">{branding.appName}</h1>
          <p className="oo-text-caption max-w-sm text-center">{t("login.subtitle")}</p>
        </div>

        <div className="flex flex-col items-center gap-3">
          <Button className="gap-2" disabled={auth.loggingIn} onClick={() => void auth.login()}>
            {auth.loggingIn ? <Loader size={16} /> : <LogIn className="size-4" />}
            {auth.loggingIn ? t("login.waiting") : t("login.button")}
          </Button>
          {auth.error && (
            <p className="max-w-sm text-center text-sm text-destructive">{t("login.failed", { error: auth.error })}</p>
          )}
        </div>
      </main>
    </div>
  )
}
