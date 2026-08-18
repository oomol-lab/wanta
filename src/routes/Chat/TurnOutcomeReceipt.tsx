import type { ChatTurnProcessStatus } from "./chat-turns.ts"

import { CircleAlert, CircleCheck, CircleStop } from "lucide-react"
import { Message, MessageContent } from "@/components/ai-elements/message"
import { useT } from "@/i18n/i18n"

export function TurnOutcomeReceipt({ status }: { status: ChatTurnProcessStatus }) {
  const t = useT()
  if (status === "running" || status === "retrying") {
    return null
  }
  const { Icon, text } = (() => {
    switch (status) {
      case "completed":
        return { Icon: CircleCheck, text: t("chat.turnOutcomeCompleted") }
      case "completedWithIssues":
        return { Icon: CircleAlert, text: t("chat.turnOutcomeCompletedWithIssues") }
      case "needsAction":
        return { Icon: CircleAlert, text: t("chat.turnOutcomeNeedsAction") }
      case "error":
        return { Icon: CircleAlert, text: t("chat.turnOutcomeError") }
      case "stopped":
        return { Icon: CircleStop, text: t("chat.turnOutcomeStopped") }
    }
  })()

  return (
    <Message from="assistant">
      <MessageContent className="w-full">
        <div className="flex items-start gap-2 text-muted-foreground">
          <Icon className="mt-0.5 size-4 shrink-0" />
          <p className="m-0 leading-6">{text}</p>
        </div>
      </MessageContent>
    </Message>
  )
}
