import type { AgentKind } from "../../../electron/agent/contract/profile.ts"
import type { ExternalAgentCatalog, ExternalAgentRuntimeStatus } from "../../../electron/agent/external/status.ts"
import type { AgentMode, AgentPermissionMode, ReasoningLevel } from "../../../electron/chat/common.ts"
import type { ModelCatalog, ModelChoice } from "../../../electron/models/common.ts"
import type { ContextUsageInfo } from "./context-usage.ts"

import { Brain, Cpu, Mic } from "lucide-react"
import { AgentModePicker } from "./AgentModePicker.tsx"
import { AgentOptionPicker } from "./AgentOptionPicker.tsx"
import { AgentPicker } from "./AgentPicker.tsx"
import { ComposerContextUsageIndicator } from "./ComposerContextUsageIndicator.tsx"
import { ModelReasoningPicker } from "./ModelReasoningPicker.tsx"
import { PermissionModePicker } from "./PermissionModePicker.tsx"
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
      {agentModesEnabled ? (
        <AgentModePicker disabled={composerDisabled} value={agentMode} onValueChange={onSelectAgentMode} />
      ) : null}
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
      {modelRoutingEnabled ? (
        <ModelReasoningPicker
          catalog={modelCatalog}
          disabled={composerDisabled}
          modelRequired={modelRequired}
          reasoningLevel={reasoningLevel}
          onAddModel={onAddModel}
          onDeleteModel={onDeleteModel}
          onSelectModel={onSelectModel}
          onSelectReasoningLevel={onSelectReasoningLevel}
        />
      ) : null}
      {!modelRoutingEnabled && agentModelSelectionEnabled ? (
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
      ) : null}
      {!modelRoutingEnabled && agentEffortSelectionEnabled ? (
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
      ) : null}
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
