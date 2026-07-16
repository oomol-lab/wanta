import type { UseAppUpdate } from "@/hooks/useAppUpdate"

import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import { AppUpdateTitlebarEntry } from "./AppUpdateTitlebarEntry.tsx"
import { I18nContext, translate } from "@/i18n/i18n"

function renderEntry(update: UseAppUpdate): string {
  return renderToStaticMarkup(
    React.createElement(
      I18nContext.Provider,
      {
        value: {
          locale: "zh-CN",
          setLocale: () => undefined,
          t: (key, vars) => translate("zh-CN", key, vars),
        },
      },
      React.createElement(AppUpdateTitlebarEntry, { update }),
    ),
  )
}

it("renders the restart action after an update is downloaded", () => {
  const update: UseAppUpdate = {
    check: async () => null,
    checkAndDownload: async () => undefined,
    download: async () => undefined,
    install: async () => undefined,
    isDownloadInFlight: false,
    isInstallTriggered: false,
    setChannel: async () => undefined,
    state: {
      channel: "stable",
      currentVersion: "0.1.0",
      isPackaged: true,
      status: { status: "downloaded", version: "0.1.1" },
    },
  }

  const html = renderEntry(update)

  expect(html).toContain(translate("zh-CN", "nav.restartToUpdate"))
  expect(html).toContain("refresh-cw")
})
