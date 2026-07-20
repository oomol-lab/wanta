import type { AgentMode, AgentPermissionMode, ReasoningLevel } from "../../../electron/chat/common.ts"
import type { ModelCatalog, ModelChoice } from "../../../electron/models/common.ts"
import type { ContextUsageInfo } from "./context-usage.ts"

import { AgentModePicker } from "./AgentModePicker.tsx"
import { ComposerContextUsageIndicator } from "./ComposerContextUsageIndicator.tsx"
import { ModelReasoningPicker } from "./ModelReasoningPicker.tsx"
import { PermissionModePicker } from "./PermissionModePicker.tsx"

interface ComposerModeControlsProps {
  agentMode: AgentMode
  composerDisabled: boolean
  contextUsage: ContextUsageInfo | null
  modelCatalog: ModelCatalog | null
  permissionMode: AgentPermissionMode
  reasoningLevel: ReasoningLevel
  modelRequired?: boolean
  onAddModel: () => void
  onDeleteModel: (id: string) => void
  onRequestFullAccessPermissionMode: () => void
  onSelectAgentMode: (mode: AgentMode) => void
  onSelectDefaultPermissionMode: () => void
  onSelectModel: (choice: ModelChoice) => void
  onSelectReasoningLevel: (level: ReasoningLevel) => void
}

export function ComposerModeControls({
  agentMode,
  composerDisabled,
  contextUsage,
  modelCatalog,
  permissionMode,
  reasoningLevel,
  modelRequired = false,
  onAddModel,
  onDeleteModel,
  onRequestFullAccessPermissionMode,
  onSelectAgentMode,
  onSelectDefaultPermissionMode,
  onSelectModel,
  onSelectReasoningLevel,
}: ComposerModeControlsProps) {
  return (
    <>
      <ComposerContextUsageIndicator usage={contextUsage} />
      <AgentModePicker disabled={composerDisabled} value={agentMode} onValueChange={onSelectAgentMode} />
      <PermissionModePicker
        disabled={composerDisabled}
        value={permissionMode}
        onDefault={onSelectDefaultPermissionMode}
        onFullAccess={onRequestFullAccessPermissionMode}
      />
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
    </>
  )
}
