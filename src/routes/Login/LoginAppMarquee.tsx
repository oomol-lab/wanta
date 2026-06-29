import type { MessageKey, TranslateFn } from "@/i18n/i18n"

import cloudflareIconUrl from "@/assets/apps/cloudflare.svg"
import cloudinaryIconUrl from "@/assets/apps/cloudinary.svg"
import dropboxIconUrl from "@/assets/apps/dropbox.svg"
import figmaIconUrl from "@/assets/apps/figma.svg"
import githubIconUrl from "@/assets/apps/github.svg"
import gmailIconUrl from "@/assets/apps/gmail.svg"
import googleCalendarIconUrl from "@/assets/apps/google-calendar.svg"
import microsoftTeamsIconUrl from "@/assets/apps/microsoft-teams.svg"
import mondayIconUrl from "@/assets/apps/monday.svg"
import notionIconUrl from "@/assets/apps/notion.svg"
import openaiIconUrl from "@/assets/apps/openai.svg"
import outlookIconUrl from "@/assets/apps/outlook.webp"
import sendgridIconUrl from "@/assets/apps/sendgrid.svg"
import slackIconUrl from "@/assets/apps/slack.svg"
import stripeIconUrl from "@/assets/apps/stripe.svg"
import twilioIconUrl from "@/assets/apps/twilio.svg"
import vercelIconUrl from "@/assets/apps/vercel.svg"

type LoginApp = {
  id: string
  categoryKey: MessageKey
  icon: string
  nameKey: MessageKey
}

const APP_ROWS = [
  [
    {
      id: "github",
      categoryKey: "login.appCategories.developer",
      icon: githubIconUrl,
      nameKey: "login.appNames.github",
    },
    {
      id: "slack",
      categoryKey: "login.appCategories.communication",
      icon: slackIconUrl,
      nameKey: "login.appNames.slack",
    },
    {
      id: "notion",
      categoryKey: "login.appCategories.productivity",
      icon: notionIconUrl,
      nameKey: "login.appNames.notion",
    },
    {
      id: "gmail",
      categoryKey: "login.appCategories.communication",
      icon: gmailIconUrl,
      nameKey: "login.appNames.gmail",
    },
    {
      id: "vercel",
      categoryKey: "login.appCategories.developer",
      icon: vercelIconUrl,
      nameKey: "login.appNames.vercel",
    },
    {
      id: "openai",
      categoryKey: "login.appCategories.ai",
      icon: openaiIconUrl,
      nameKey: "login.appNames.openai",
    },
  ],
  [
    {
      id: "google-calendar",
      categoryKey: "login.appCategories.productivity",
      icon: googleCalendarIconUrl,
      nameKey: "login.appNames.googleCalendar",
    },
    {
      id: "dropbox",
      categoryKey: "login.appCategories.storage",
      icon: dropboxIconUrl,
      nameKey: "login.appNames.dropbox",
    },
    {
      id: "outlook",
      categoryKey: "login.appCategories.communication",
      icon: outlookIconUrl,
      nameKey: "login.appNames.outlook",
    },
    {
      id: "cloudflare",
      categoryKey: "login.appCategories.developer",
      icon: cloudflareIconUrl,
      nameKey: "login.appNames.cloudflare",
    },
    {
      id: "figma",
      categoryKey: "login.appCategories.design",
      icon: figmaIconUrl,
      nameKey: "login.appNames.figma",
    },
    {
      id: "stripe",
      categoryKey: "login.appCategories.payments",
      icon: stripeIconUrl,
      nameKey: "login.appNames.stripe",
    },
  ],
  [
    {
      id: "sendgrid",
      categoryKey: "login.appCategories.communication",
      icon: sendgridIconUrl,
      nameKey: "login.appNames.sendgrid",
    },
    {
      id: "twilio",
      categoryKey: "login.appCategories.communication",
      icon: twilioIconUrl,
      nameKey: "login.appNames.twilio",
    },
    {
      id: "cloudinary",
      categoryKey: "login.appCategories.media",
      icon: cloudinaryIconUrl,
      nameKey: "login.appNames.cloudinary",
    },
    {
      id: "monday",
      categoryKey: "login.appCategories.productivity",
      icon: mondayIconUrl,
      nameKey: "login.appNames.monday",
    },
    {
      id: "microsoft-teams",
      categoryKey: "login.appCategories.communication",
      icon: microsoftTeamsIconUrl,
      nameKey: "login.appNames.microsoftTeams",
    },
  ],
] satisfies readonly (readonly LoginApp[])[]

export function LoginAppMarquee({ t }: { t: TranslateFn }) {
  return (
    <div className="oo-login-app-marquee" role="img" aria-label={t("login.appsAriaLabel")}>
      <div className="oo-login-app-marquee-rows" aria-hidden="true">
        {APP_ROWS.map((row, rowIndex) => (
          <div className="oo-login-app-marquee-row" data-reverse={rowIndex % 2 === 1} key={rowIndex}>
            <div className="oo-login-app-marquee-track">
              {[0, 1].map((setIndex) => (
                <div className="oo-login-app-marquee-set" key={setIndex}>
                  {row.map((app) => (
                    <span className="oo-login-app-chip" key={`${setIndex}-${app.id}`}>
                      <span className="oo-login-app-icon">
                        <img src={app.icon} alt="" loading="eager" decoding="async" />
                      </span>
                      <span className="oo-login-app-copy">
                        <strong>{t(app.nameKey)}</strong>
                        <span>{t(app.categoryKey)}</span>
                      </span>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
