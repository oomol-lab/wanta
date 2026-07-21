import type { AgentMode, AgentPermissionMode, ReasoningLevel } from "../../../electron/chat/common.ts"
import type { ModelCatalog, ModelChoice } from "../../../electron/models/common.ts"
import type { ChatTurnState } from "./chat-turn-state.ts"
import type { ContextUsageInfo } from "./context-usage.ts"

import { ListPlus } from "lucide-react"
import { toast } from "sonner"
import { APP_COMMANDS } from "../../../electron/app-command.ts"
import { composerSubmitState } from "./composer-controls.ts"
import { ComposerModeControls } from "./ComposerModeControls.tsx"
import { PromptInputSubmit } from "@/components/ai-elements/prompt-input"
import { useT } from "@/i18n/i18n"
import { appCommandAriaShortcut, appCommandShortcutLabel, labelWithShortcut } from "@/lib/app-shortcuts"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"

interface ComposerTrailingControlsProps {
  canSubmit: boolean
  composerDisabled: boolean
  contextUsage: ContextUsageInfo | null
  turnState: ChatTurnState
  modelCatalog: ModelCatalog | null
  modelRequired?: boolean
  agentMode: AgentMode
  permissionMode: AgentPermissionMode
  reasoningLevel: ReasoningLevel
  willQueueMessage: boolean
  onAddModel: () => void
  onDeleteModel: (id: string) => void
  onSelectAgentMode: (mode: AgentMode) => void
  onSelectDefaultPermissionMode: () => void
  onRequestFullAccessPermissionMode: () => void
  onSelectModel: (choice: ModelChoice) => void
  onSelectReasoningLevel: (level: ReasoningLevel) => void
  onStop: () => Promise<void> | void
}

export function ComposerTrailingControls({
  canSubmit,
  composerDisabled,
  contextUsage,
  turnState,
  modelCatalog,
  modelRequired = false,
  agentMode,
  permissionMode,
  reasoningLevel,
  willQueueMessage,
  onAddModel,
  onDeleteModel,
  onSelectAgentMode,
  onSelectDefaultPermissionMode,
  onRequestFullAccessPermissionMode,
  onSelectModel,
  onSelectReasoningLevel,
  onStop,
}: ComposerTrailingControlsProps) {
  const t = useT()
  const submit = composerSubmitState({ canSubmit, turnState, willQueueMessage })
  const stopLabel = labelWithShortcut(t("aria.stop"), appCommandShortcutLabel(APP_COMMANDS.stopGeneration))

  return (
    <div className="flex min-w-0 flex-1 items-center justify-end gap-1 overflow-hidden">
      <ComposerModeControls
        agentMode={agentMode}
        composerDisabled={composerDisabled}
        contextUsage={contextUsage}
        modelCatalog={modelCatalog}
        modelRequired={modelRequired}
        permissionMode={permissionMode}
        reasoningLevel={reasoningLevel}
        onAddModel={onAddModel}
        onDeleteModel={onDeleteModel}
        onRequestFullAccessPermissionMode={onRequestFullAccessPermissionMode}
        onSelectAgentMode={onSelectAgentMode}
        onSelectDefaultPermissionMode={onSelectDefaultPermissionMode}
        onSelectModel={onSelectModel}
        onSelectReasoningLevel={onSelectReasoningLevel}
      />
      <PromptInputSubmit
        size="icon-sm"
        className="size-7"
        status={submit.visualStatus}
        disabled={submit.disabled}
        aria-label={
          submit.aria === "sending"
            ? t("aria.sending")
            : submit.aria === "stop"
              ? t("aria.stop")
              : submit.aria === "queue"
                ? t("chat.queueSend")
                : t("aria.send")
        }
        aria-keyshortcuts={submit.stopsGeneration ? appCommandAriaShortcut(APP_COMMANDS.stopGeneration) : undefined}
        title={submit.stopsGeneration ? stopLabel : submit.queuesMessage ? t("chat.queueSend") : undefined}
        onClick={
          submit.stopsGeneration
            ? (event) => {
                event.preventDefault()
                void (async () => {
                  try {
                    await onStop()
                  } catch (cause) {
                    reportRendererHandledError("chat", "stopGeneration invoke failed", cause)
                    toast.error(t("chat.stopFailed"))
                  }
                })()
              }
            : undefined
        }
      >
        {submit.queuesMessage ? <ListPlus className="size-4" /> : undefined}
      </PromptInputSubmit>
    </div>
  )
}
