import type { AgentKind } from "../../../electron/agent/contract/profile.ts"
import type { ExternalAgentCatalog, ExternalAgentRuntimeStatus } from "../../../electron/agent/external/status.ts"
import type { AgentMode, AgentPermissionMode, ReasoningLevel } from "../../../electron/chat/common.ts"
import type { ModelCatalog, ModelChoice } from "../../../electron/models/common.ts"
import type { ContextUsageInfo } from "./context-usage.ts"

import { Mic } from "lucide-react"
import { AgentConfigurationPicker } from "./AgentConfigurationPicker.tsx"
import { AgentModePicker } from "./AgentModePicker.tsx"
import { ComposerContextUsageIndicator } from "./ComposerContextUsageIndicator.tsx"
import { PermissionModePicker } from "./PermissionModePicker.tsx"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"

const NO_EXTERNAL_AGENTS: ExternalAgentRuntimeStatus[] = []

interface ComposerModeControlsProps {
  agentConfigurationDisabled?: boolean
  agentCatalog?: ExternalAgentCatalog
  agentEffortId?: string
  agentEffortSelectionEnabled?: boolean
  agentKind?: AgentKind
  agentMode: AgentMode
  agentModelId?: string
  agentModelSelectionEnabled?: boolean
  agentModesEnabled?: boolean
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
  agentConfigurationDisabled = false,
  agentCatalog,
  agentEffortId,
  agentEffortSelectionEnabled = false,
  agentKind = "opencode",
  agentMode,
  agentModelId,
  agentModelSelectionEnabled = false,
  agentModesEnabled = true,
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
  // A single-mode agent has nothing to choose; hide the picker entirely.
  const permissionModePickerVisible = !permissionModes || permissionModes.length >= 2

  return (
    <>
      <ComposerContextUsageIndicator usage={contextUsage} />
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
      <AgentConfigurationPicker
        agentCatalog={agentCatalog}
        agentEffortId={agentEffortId}
        agentEffortSelectionEnabled={agentEffortSelectionEnabled}
        agentKind={agentKind}
        agentModelId={agentModelId}
        agentModelSelectionEnabled={agentModelSelectionEnabled}
        composerDisabled={agentConfigurationDisabled}
        externalAgents={externalAgents}
        modelCatalog={modelCatalog}
        modelRequired={modelRequired}
        modelRoutingEnabled={modelRoutingEnabled}
        reasoningLevel={reasoningLevel}
        onAddModel={onAddModel}
        onAgentPickerOpen={onAgentPickerOpen}
        onDeleteModel={onDeleteModel}
        onSelectAgentEffort={onSelectAgentEffort}
        onSelectAgentKind={onSelectAgentKind}
        onSelectAgentModel={onSelectAgentModel}
        onSelectModel={onSelectModel}
        onSelectReasoningLevel={onSelectReasoningLevel}
      />
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
