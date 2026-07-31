import type { TranslateFn } from "@/i18n/i18n"

import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ComposerModeControls } from "./ComposerModeControls.tsx"
import { I18nContext, translate } from "@/i18n/i18n"

const t: TranslateFn = (key, vars) => translate("en", key, vars)

function renderControls(voiceEnabled: boolean): string {
  return renderToStaticMarkup(
    React.createElement(
      I18nContext.Provider,
      { value: { locale: "en", setLocale: () => undefined, t } },
      React.createElement(ComposerModeControls, {
        agentMode: "build",
        composerDisabled: false,
        contextUsage: null,
        modelCatalog: null,
        permissionMode: "default",
        reasoningLevel: "default",
        voiceEnabled,
        onAddModel: () => undefined,
        onDeleteModel: () => undefined,
        onRequestFullAccessPermissionMode: () => undefined,
        onSelectAgentMode: () => undefined,
        onSelectDefaultPermissionMode: () => undefined,
        onSelectModel: () => undefined,
        onSelectReasoningLevel: () => undefined,
        onStartVoice: () => undefined,
      }),
    ),
  )
}

describe("ComposerModeControls", () => {
  const voiceLabel = `aria-label="${t("chat.voiceInput")}"`

  it("shows voice input when the runtime enables voice", () => {
    expect(renderControls(true)).toContain(voiceLabel)
  })

  it("hides voice input when the runtime disables voice", () => {
    expect(renderControls(false)).not.toContain(voiceLabel)
  })
})
