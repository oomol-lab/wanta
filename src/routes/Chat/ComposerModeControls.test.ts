import type { TranslateFn } from "@/i18n/i18n"
import type { ComponentProps } from "react"

import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ComposerModeControls } from "./ComposerModeControls.tsx"
import { I18nContext, translate } from "@/i18n/i18n"

const t: TranslateFn = (key, vars) => translate("en", key, vars)

const baseProps: ComponentProps<typeof ComposerModeControls> = {
  agentMode: "build",
  composerDisabled: false,
  contextUsage: null,
  modelCatalog: null,
  permissionMode: "default",
  reasoningLevel: "default",
  voiceEnabled: false,
  onAddModel: () => undefined,
  onDeleteModel: () => undefined,
  onRequestFullAccessPermissionMode: () => undefined,
  onSelectAgentMode: () => undefined,
  onSelectDefaultPermissionMode: () => undefined,
  onSelectModel: () => undefined,
  onSelectReasoningLevel: () => undefined,
  onStartVoice: () => undefined,
}

function renderControls(overrides: Partial<ComponentProps<typeof ComposerModeControls>>): string {
  return renderToStaticMarkup(
    React.createElement(
      I18nContext.Provider,
      { value: { locale: "en", setLocale: () => undefined, t } },
      React.createElement(ComposerModeControls, { ...baseProps, ...overrides }),
    ),
  )
}

describe("ComposerModeControls", () => {
  const voiceLabel = `aria-label="${t("chat.voiceInput")}"`
  const agentPickerLabel = `aria-label="${t("chat.agentPickerLabel")}"`
  const agentModeLabel = `aria-label="${t("chat.agentModePicker")}"`
  const modelPickerLabel = `aria-label="${t("chat.modelReasoningPicker")}"`

  it("shows voice input when the runtime enables voice", () => {
    expect(renderControls({ voiceEnabled: true })).toContain(voiceLabel)
  })

  it("hides voice input when the runtime disables voice", () => {
    expect(renderControls({ voiceEnabled: false })).not.toContain(voiceLabel)
  })

  it("always renders the agent picker with the built-in label by default", () => {
    const html = renderControls({})
    expect(html).toContain(agentPickerLabel)
    expect(html).toContain(t("chat.agentBuiltIn"))
  })

  it("renders mode and model pickers for agents with Wanta-owned capabilities", () => {
    const html = renderControls({ agentModesEnabled: true, modelRoutingEnabled: true })
    expect(html).toContain(agentModeLabel)
    expect(html).toContain(modelPickerLabel)
  })

  it("hides the agent mode picker when the agent does not honor modes", () => {
    expect(renderControls({ agentModesEnabled: false })).not.toContain(agentModeLabel)
  })

  it("hides the model picker when the agent owns model routing", () => {
    expect(renderControls({ modelRoutingEnabled: false })).not.toContain(modelPickerLabel)
  })
})
