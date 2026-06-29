import type { TranslateFn } from "@/i18n/i18n"

import { LoginAppMarquee } from "./LoginAppMarquee.tsx"

export function LoginBrandPanel({ t }: { t: TranslateFn }) {
  return (
    <aside className="oo-login-brand-panel" aria-label={t("login.brandPanelAriaLabel")}>
      <div className="oo-login-brand-grid" aria-hidden="true" />
      <div className="oo-login-brand-glow" aria-hidden="true" />
      <div className="oo-login-brand-content">
        <LoginAppMarquee t={t} />
      </div>
    </aside>
  )
}
