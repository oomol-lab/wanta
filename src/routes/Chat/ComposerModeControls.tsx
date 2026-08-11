import type { AgentKind } from "../../../electron/agent/contract/profile.ts"
import type { ExternalAgentCatalog, ExternalAgentRuntimeStatus } from "../../../electron/agent/external/status.ts"
import type { AgentMode, AgentPermissionMode, ReasoningLevel } from "../../../electron/chat/common.ts"
import type { ModelCatalog, ModelChoice } from "../../../electron/models/common.ts"
import type { ContextUsageInfo } from "./context-usage.ts"

import { Brain, Cpu, Mic } from "lucide-react"
import * as React from "react"
import { AgentModePicker } from "./AgentModePicker.tsx"
import { AgentOptionPicker } from "./AgentOptionPicker.tsx"
import { AgentPicker } from "./AgentPicker.tsx"
import { ComposerContextUsageIndicator } from "./ComposerContextUsageIndicator.tsx"
import { reasoningLevelLabel } from "./model-control-utils.ts"
import { selectedModelReasoningLevels } from "./model-reasoning-levels.ts"
import { PermissionModePicker } from "./PermissionModePicker.tsx"
import { WantaModelPicker } from "./WantaModelPicker.tsx"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"

const NO_EXTERNAL_AGENTS: ExternalAgentRuntimeStatus[] = []

interface ComposerModeControlsProps {
  agentCatalog?: ExternalAgentCatalog
  agentEffortId?: string
  agentEffortSelectionEnabled?: boolean
  agentKind?: AgentKind
  agentMode: AgentMode
  agentModelId?: string
  agentModelSelectionEnabled?: boolean
  agentModesEnabled?: boolean
  agentPickerLocked?: boolean
  composerDisabled: boolean
  contextUsage: ContextUsageInfo | null
  externalAgents?: ExternalAgentRuntimeStatus[]
  modelCatalog: ModelCatalog | null
  modelRoutingEnabled?: boolean
  permissionMode: AgentPermissionMode
  permissionModes?: readonly AgentPermissionMode[]
  reasoningLevel: ReasoningLevel
  modelRequired?: boolean
  voiceEnabled: boolean
  onAddModel: () => void
  onAgentPickerOpen?: () => void
  onDeleteModel: (id: string) => void
  onRequestFullAccessPermissionMode: () => void
  onSelectAgentEffort?: (effortId?: string) => void
  onSelectAgentKind?: (kind: AgentKind) => void
  onSelectAgentMode: (mode: AgentMode) => void
  onSelectAgentModel?: (modelId?: string) => void
  onSelectPermissionMode: (mode: AgentPermissionMode) => void
  onSelectModel: (choice: ModelChoice) => void
  onSelectReasoningLevel: (level: ReasoningLevel) => void
  onStartVoice: () => void
}

export function ComposerModeControls({
  agentCatalog,
  agentEffortId,
  agentEffortSelectionEnabled = false,
  agentKind = "opencode",
  agentMode,
  agentModelId,
  agentModelSelectionEnabled = false,
  agentModesEnabled = true,
  agentPickerLocked = false,
  composerDisabled,
  contextUsage,
  externalAgents = NO_EXTERNAL_AGENTS,
  modelCatalog,
  modelRoutingEnabled = true,
  permissionMode,
  permissionModes,
  reasoningLevel,
  modelRequired = false,
  voiceEnabled,
  onAddModel,
  onAgentPickerOpen,
  onDeleteModel,
  onRequestFullAccessPermissionMode,
  onSelectAgentEffort,
  onSelectAgentKind,
  onSelectAgentMode,
  onSelectAgentModel,
  onSelectPermissionMode,
  onSelectModel,
  onSelectReasoningLevel,
  onStartVoice,
}: ComposerModeControlsProps) {
  const t = useT()
  // Kernel reasoning options for the selected Wanta model; "default" is the
  // picker's Auto row rather than an explicit option.
  const kernelReasoningOptions = React.useMemo(
    () =>
      selectedModelReasoningLevels(modelCatalog)
        .filter((level) => level !== "default")
        .map((level) => ({ id: level, label: reasoningLevelLabel(level, t) })),
    [modelCatalog, t],
  )
  // An unavailable persisted level renders as Auto until the user picks again.
  const kernelReasoningValue = kernelReasoningOptions.some((option) => option.id === reasoningLevel)
    ? reasoningLevel
    : undefined
  const selectModel = React.useCallback(
    (choice: ModelChoice): void => {
      // Switching models clamps a reasoning level the new model cannot serve.
      const nextLevels = selectedModelReasoningLevels(
        modelCatalog ? { ...modelCatalog, selected: choice } : modelCatalog,
      )
      if (!nextLevels.includes(reasoningLevel)) {
        onSelectReasoningLevel("default")
      }
      onSelectModel(choice)
    },
    [modelCatalog, onSelectModel, onSelectReasoningLevel, reasoningLevel],
  )
  // A single-mode agent has nothing to choose; hide the picker entirely.
  const permissionModePickerVisible = !permissionModes || permissionModes.length >= 2

  const modelPicker = modelRoutingEnabled ? (
    <WantaModelPicker
      catalog={modelCatalog}
      disabled={composerDisabled}
      modelRequired={modelRequired}
      onAddModel={onAddModel}
      onDeleteModel={onDeleteModel}
      onSelectModel={selectModel}
    />
  ) : agentModelSelectionEnabled ? (
    <AgentOptionPicker
      ariaLabel={t("chat.agentModelPicker")}
      defaultOptionId={agentCatalog?.defaultModelId}
      disabled={composerDisabled}
      icon={Cpu}
      options={agentCatalog?.models ?? []}
      value={agentModelId}
      onOpen={onAgentPickerOpen}
      onSelect={(id) => onSelectAgentModel?.(id)}
    />
  ) : null

  const reasoningPicker = modelRoutingEnabled ? (
    kernelReasoningOptions.length > 0 ? (
      <AgentOptionPicker
        ariaLabel={t("chat.reasoningSection")}
        disabled={composerDisabled}
        icon={Brain}
        options={kernelReasoningOptions}
        value={kernelReasoningValue}
        onSelect={(id) => onSelectReasoningLevel((id ?? "default") as ReasoningLevel)}
      />
    ) : null
  ) : agentEffortSelectionEnabled ? (
    <AgentOptionPicker
      ariaLabel={t("chat.agentEffortPicker")}
      defaultOptionId={agentCatalog?.defaultEffortId}
      disabled={composerDisabled}
      icon={Brain}
      options={agentCatalog?.efforts ?? []}
      value={agentEffortId}
      onOpen={onAgentPickerOpen}
      onSelect={(id) => onSelectAgentEffort?.(id)}
    />
  ) : null

  return (
    <>
      <ComposerContextUsageIndicator usage={contextUsage} />
      <AgentPicker
        disabled={composerDisabled}
        locked={agentPickerLocked}
        options={externalAgents}
        value={agentKind}
        onOpen={onAgentPickerOpen}
        onSelect={(kind) => onSelectAgentKind?.(kind)}
      />
      {modelPicker}
      {agentModesEnabled ? (
        <AgentModePicker disabled={composerDisabled} value={agentMode} onValueChange={onSelectAgentMode} />
      ) : null}
      {permissionModePickerVisible ? (
        <PermissionModePicker
          disabled={composerDisabled}
          modes={permissionModes}
          value={permissionMode}
          onSelect={(mode) => {
            if (mode === "full_access") {
              onRequestFullAccessPermissionMode()
            } else {
              onSelectPermissionMode(mode)
            }
          }}
        />
      ) : null}
      {reasoningPicker}
      {voiceEnabled ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title={t("chat.voiceInput")}
          aria-label={t("chat.voiceInput")}
          disabled={composerDisabled}
          className="size-8 rounded-full"
          onClick={onStartVoice}
        >
          <Mic className="size-4" />
        </Button>
      ) : null}
    </>
  )
}
