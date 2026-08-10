import type { ModelCatalog } from "../../../electron/models/common.ts"
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
  onSelectPermissionMode: () => undefined,
  onSelectModel: () => undefined,
  onSelectReasoningLevel: () => undefined,
  onStartVoice: () => undefined,
}

// Selected built-in model without reasoning variants: the kernel reasoning
// picker has no explicit levels to offer and must disappear.
const noReasoningCatalog: ModelCatalog = {
  selected: { kind: "builtin", id: "gpt-5.6-sol" },
  providers: [],
  builtins: [
    {
      id: "gpt-5.6-sol",
      displayName: "GPT 5.6 Sol",
      providerName: "OpenAI",
      supportsImages: true,
      toolCall: true,
      runtimeKind: "openai-responses",
    },
  ],
  customModels: [],
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
  const modelPickerLabel = `aria-label="${t("chat.modelPicker")}"`
  const permissionModeLabel = `aria-label="${t("chat.permissionModePicker")}"`
  const reasoningPickerLabel = `aria-label="${t("chat.reasoningSection")}"`

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

  it("renders mode, model, and reasoning pickers for agents with Wanta-owned capabilities", () => {
    const html = renderControls({ agentModesEnabled: true, modelRoutingEnabled: true })
    expect(html).toContain(agentModeLabel)
    expect(html).toContain(modelPickerLabel)
    expect(html).toContain(reasoningPickerLabel)
  })

  it("orders controls as agent, model, mode, permission, reasoning", () => {
    const html = renderControls({ agentModesEnabled: true, modelRoutingEnabled: true })
    const positions = [
      agentPickerLabel,
      modelPickerLabel,
      agentModeLabel,
      permissionModeLabel,
      reasoningPickerLabel,
    ].map((label) => html.indexOf(label))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it("hides the agent mode picker when the agent does not honor modes", () => {
    expect(renderControls({ agentModesEnabled: false })).not.toContain(agentModeLabel)
  })

  it("hides the model picker when the agent owns model routing", () => {
    expect(renderControls({ modelRoutingEnabled: false })).not.toContain(modelPickerLabel)
  })

  it("hides the permission mode picker for single-mode agents", () => {
    expect(renderControls({ permissionModes: ["default"] })).not.toContain(permissionModeLabel)
    expect(renderControls({ permissionModes: ["default", "full_access"] })).toContain(permissionModeLabel)
  })

  it("hides the kernel reasoning picker when the selected model has no reasoning variants", () => {
    expect(renderControls({ modelCatalog: noReasoningCatalog })).not.toContain(reasoningPickerLabel)
  })

  it("prompts for configuration on the model trigger when a model is required", () => {
    expect(renderControls({ modelRequired: true })).toContain(t("chat.modelSelectOrConfigure"))
  })
})
