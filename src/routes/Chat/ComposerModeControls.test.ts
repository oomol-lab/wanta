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
  const agentConfigurationLabel = `aria-label="${t("chat.agentConfiguration")}"`
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

  it("renders one combined agent configuration trigger", () => {
    const html = renderControls({})
    expect(html).toContain(agentConfigurationLabel)
    expect(html).not.toContain(modelPickerLabel)
    expect(html).not.toContain(reasoningPickerLabel)
  })

  it("keeps Agent configuration enabled when only the composer runtime is unavailable", () => {
    const html = renderControls({ agentConfigurationDisabled: false, composerDisabled: true })
    const trigger = html.match(/<button[^>]*aria-label="Agent configuration"[^>]*>/u)?.[0]
    expect(trigger).toBeDefined()
    expect(trigger).not.toContain(' disabled=""')
    expect(html.match(/<button[^>]*aria-label="Switch mode"[^>]*>/u)?.[0]).toContain(' disabled=""')
  })

  it("keeps Wanta model and reasoning selections inside the combined trigger", () => {
    const html = renderControls({ agentModesEnabled: true, modelRoutingEnabled: true })
    expect(html).toContain(agentModeLabel)
    expect(html).toContain(agentConfigurationLabel)
    expect(html).toContain("Built-in Agent · Auto · Default")
  })

  it("orders mode and permission before the combined configuration trigger", () => {
    const html = renderControls({ agentModesEnabled: true, modelRoutingEnabled: true })
    const positions = [agentModeLabel, permissionModeLabel, agentConfigurationLabel].map((label) => html.indexOf(label))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it("hides the agent mode picker when the agent does not honor modes", () => {
    expect(renderControls({ agentModesEnabled: false })).not.toContain(agentModeLabel)
  })

  it("uses the same combined trigger when the external agent owns model routing", () => {
    const html = renderControls({
      agentCatalog: {
        defaultModelId: "sonnet",
        efforts: [{ id: "high", label: "High" }],
        models: [{ id: "sonnet", label: "Claude Sonnet" }],
      },
      agentEffortSelectionEnabled: true,
      agentKind: "claude-code",
      agentModelSelectionEnabled: true,
      modelRoutingEnabled: false,
    })
    expect(html).toContain(agentConfigurationLabel)
    expect(html).toContain("Claude Code · Default")
    expect(html).not.toContain(modelPickerLabel)
  })

  it("hides the permission mode picker for single-mode agents", () => {
    expect(renderControls({ permissionModes: ["default"] })).not.toContain(permissionModeLabel)
    expect(renderControls({ permissionModes: ["default", "full_access"] })).toContain(permissionModeLabel)
  })

  it("keeps a model-only Wanta configuration in the combined trigger", () => {
    const html = renderControls({ modelCatalog: noReasoningCatalog })
    expect(html).toContain(agentConfigurationLabel)
    expect(html).toContain("Built-in Agent · GPT 5.6 Sol · Default")
    expect(html).not.toContain(reasoningPickerLabel)
  })

  it("prompts for configuration on the model trigger when a model is required", () => {
    expect(renderControls({ modelRequired: true })).toContain(t("chat.modelSelectOrConfigure"))
  })
})
