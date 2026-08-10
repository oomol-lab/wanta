import type { TranslateFn } from "@/i18n/i18n"
import type { ComponentProps } from "react"

import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ComposerTrailingControls } from "./ComposerTrailingControls.tsx"
import { ThemeContext } from "@/components/theme-context"
import { I18nContext, translate } from "@/i18n/i18n"

const t: TranslateFn = (key, vars) => translate("en", key, vars)
const baseProps: ComponentProps<typeof ComposerTrailingControls> = {
  agentMode: "build",
  canSubmit: false,
  composerDisabled: false,
  contextUsage: null,
  modelCatalog: null,
  permissionMode: "default",
  reasoningLevel: "default",
  turnState: { chatStatus: "ready", status: "idle" },
  voiceActive: false,
  voiceBars: [],
  voiceDurationMs: 0,
  voiceEnabled: true,
  voiceError: null,
  voiceRetryBlob: null,
  voiceStarting: false,
  voiceTranscribing: false,
  willQueueMessage: false,
  onAddModel: () => undefined,
  onCancelVoice: () => undefined,
  onDeleteModel: () => undefined,
  onRequestFullAccessPermissionMode: () => undefined,
  onRetryVoice: () => undefined,
  onSelectAgentMode: () => undefined,
  onSelectPermissionMode: () => undefined,
  onSelectModel: () => undefined,
  onSelectReasoningLevel: () => undefined,
  onStartVoice: () => undefined,
  onStop: () => undefined,
  onStopVoice: () => undefined,
}

function renderControls(overrides: Partial<ComponentProps<typeof ComposerTrailingControls>>): string {
  return renderToStaticMarkup(
    React.createElement(
      ThemeContext.Provider,
      { value: { effectiveTheme: "light", preference: "light", setPreference: () => undefined } },
      React.createElement(
        I18nContext.Provider,
        { value: { locale: "en", setLocale: () => undefined, t } },
        React.createElement(ComposerTrailingControls, { ...baseProps, ...overrides }),
      ),
    ),
  )
}

describe("ComposerTrailingControls", () => {
  it("does not expose stale voice errors when the runtime disables voice", () => {
    const html = renderControls({ voiceEnabled: false, voiceError: "Transcription failed" })

    expect(html).not.toContain(`aria-label="${t("chat.voiceRetry")}"`)
    expect(html).not.toContain(`aria-label="${t("chat.voiceCancel")}"`)
  })

  it("distinguishes cancelling startup from discarding the recording", () => {
    const html = renderControls({ voiceActive: true, voiceStarting: true })

    expect(html).toContain(`aria-label="${t("chat.voiceCancel")}"`)
    expect(html).toContain(`aria-label="${t("chat.voiceDiscard")}"`)
  })
})
