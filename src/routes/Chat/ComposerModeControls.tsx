import type { AgentMode, AgentPermissionMode, ReasoningLevel } from "../../../electron/chat/common.ts"
import type { ModelCatalog, ModelChoice } from "../../../electron/models/common.ts"
import type { ContextUsageInfo } from "./context-usage.ts"

import { Mic } from "lucide-react"
import { ComposerContextUsageIndicator } from "./ComposerContextUsageIndicator.tsx"
import { AgentModePicker, ModelReasoningPicker } from "./ModelControls.tsx"
import { PermissionModePicker } from "./PermissionModePicker.tsx"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"

interface ComposerModeControlsProps {
  agentMode: AgentMode
  composerDisabled: boolean
  contextUsage: ContextUsageInfo | null
  modelCatalog: ModelCatalog | null
  permissionMode: AgentPermissionMode
  reasoningLevel: ReasoningLevel
  onAddModel: () => void
  onDeleteModel: (id: string) => void
  onRequestFullAccessPermissionMode: () => void
  onSelectAgentMode: (mode: AgentMode) => void
  onSelectDefaultPermissionMode: () => void
  onSelectModel: (choice: ModelChoice) => void
  onSelectReasoningLevel: (level: ReasoningLevel) => void
  onStartVoice: () => void
}

export function ComposerModeControls({
  agentMode,
  composerDisabled,
  contextUsage,
  modelCatalog,
  permissionMode,
  reasoningLevel,
  onAddModel,
  onDeleteModel,
  onRequestFullAccessPermissionMode,
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
        reasoningLevel={reasoningLevel}
        onAddModel={onAddModel}
        onDeleteModel={onDeleteModel}
        onSelectModel={onSelectModel}
        onSelectReasoningLevel={onSelectReasoningLevel}
      />
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
    </>
  )
}
