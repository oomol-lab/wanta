import type { AgentKind } from "../../../electron/agent/contract/profile.ts"
import type { ExternalAgentRuntimeStatus } from "../../../electron/agent/external/status.ts"
import type { AgentMode, AgentPermissionMode, ReasoningLevel } from "../../../electron/chat/common.ts"
import type { ModelCatalog, ModelChoice } from "../../../electron/models/common.ts"
import type { ContextUsageInfo } from "./context-usage.ts"

import { Mic } from "lucide-react"
import { AgentModePicker } from "./AgentModePicker.tsx"
import { AgentPicker } from "./AgentPicker.tsx"
import { ComposerContextUsageIndicator } from "./ComposerContextUsageIndicator.tsx"
import { ModelReasoningPicker } from "./ModelReasoningPicker.tsx"
import { PermissionModePicker } from "./PermissionModePicker.tsx"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"

const NO_EXTERNAL_AGENTS: ExternalAgentRuntimeStatus[] = []

interface ComposerModeControlsProps {
  agentKind?: AgentKind
  agentMode: AgentMode
  agentModesEnabled?: boolean
  agentPickerLocked?: boolean
  composerDisabled: boolean
  contextUsage: ContextUsageInfo | null
  externalAgents?: ExternalAgentRuntimeStatus[]
  modelCatalog: ModelCatalog | null
  modelRoutingEnabled?: boolean
  permissionMode: AgentPermissionMode
  reasoningLevel: ReasoningLevel
  modelRequired?: boolean
  voiceEnabled: boolean
  onAddModel: () => void
  onAgentPickerOpen?: () => void
  onDeleteModel: (id: string) => void
  onRequestFullAccessPermissionMode: () => void
  onSelectAgentKind?: (kind: AgentKind) => void
  onSelectAgentMode: (mode: AgentMode) => void
  onSelectDefaultPermissionMode: () => void
  onSelectModel: (choice: ModelChoice) => void
  onSelectReasoningLevel: (level: ReasoningLevel) => void
  onStartVoice: () => void
}

export function ComposerModeControls({
  agentKind = "opencode",
  agentMode,
  agentModesEnabled = true,
  agentPickerLocked = false,
  composerDisabled,
  contextUsage,
  externalAgents = NO_EXTERNAL_AGENTS,
  modelCatalog,
  modelRoutingEnabled = true,
  permissionMode,
  reasoningLevel,
  modelRequired = false,
  voiceEnabled,
  onAddModel,
  onAgentPickerOpen,
  onDeleteModel,
  onRequestFullAccessPermissionMode,
  onSelectAgentKind,
  onSelectAgentMode,
  onSelectDefaultPermissionMode,
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
        value={permissionMode}
        onDefault={onSelectDefaultPermissionMode}
        onFullAccess={onRequestFullAccessPermissionMode}
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
