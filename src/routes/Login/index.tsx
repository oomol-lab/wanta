import type { UseAuth } from "@/hooks/useAuth"

import { LogIn } from "lucide-react"
import { LoginBrandPanel } from "./LoginBrandPanel.tsx"
import { Loader } from "@/components/ai-elements/loader"
import { BrandIcon } from "@/components/BrandIcon"
import { ErrorNotice } from "@/components/ErrorNotice"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"

/** 首屏登录页：打开系统浏览器完成 OOMOL 登录，deep-link 回调后自动进入主界面。 */
export function LoginRoute({ auth }: { auth: UseAuth }) {
  const t = useT()

  return (
    <div className="relative flex h-full flex-col bg-background text-foreground">
      {/* 无边框窗口的可拖拽标题区 */}
      <header className="absolute inset-x-0 top-0 z-10 h-[var(--app-titlebar-height)] [-webkit-app-region:drag]" />

      <main className="min-h-0 flex-1 p-4 md:p-6 lg:p-8">
        <div className="mx-auto grid h-full max-w-[1480px] grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] gap-4 md:gap-6 lg:gap-8 xl:grid-cols-[minmax(24rem,0.78fr)_minmax(30rem,1.22fr)]">
          <section className="flex min-h-0 items-center">
            <div className="w-full max-w-[32rem] px-2 py-8 md:px-6 lg:-translate-y-5 lg:px-10 xl:px-12">
              <div className="flex items-center">
                <BrandIcon className="size-14" />
              </div>

              <div className="mt-10 space-y-6">
                <h1 className="text-[1.8rem] leading-[1.15] font-semibold tracking-normal text-foreground md:text-[2rem] lg:whitespace-nowrap">
                  {t("login.title")}
                </h1>
                <p className="text-sm leading-6 font-medium text-muted-foreground">{t("login.tagline")}</p>
                <h2 className="max-w-[27rem] text-sm leading-6 font-medium text-muted-foreground">
                  {t("login.featureSummary")}
                </h2>
              </div>

              <div className="mt-16 flex max-w-[27rem] flex-col items-start gap-3">
                <Button
                  className="px-6 [-webkit-app-region:no-drag] has-[>svg]:px-5"
                  disabled={auth.loggingIn}
                  size="lg"
                  onClick={() => void auth.login()}
                >
                  {auth.loggingIn ? <Loader /> : <LogIn />}
                  {auth.loggingIn ? t("login.waiting") : t("login.button")}
                </Button>
                {auth.error ? <ErrorNotice error={auth.error} compact /> : null}
              </div>
            </div>
          </section>

          <LoginBrandPanel t={t} />
        </div>
      </main>
    </div>
  )
}
