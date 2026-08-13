import type { ChatQuestionInfo } from "../chat/common.ts"
import type { HostCapability } from "./host-capability.ts"

import { z } from "zod"
import { HostQuestionBroker } from "./host-question-broker.ts"

export const QUESTION_CAPABILITY_ID = "question"

const optionSchema = z.object({ label: z.string().min(1), description: z.string().optional() })
const questionSchema = z.object({
  header: z.string().min(1).max(12),
  question: z.string().min(1),
  options: z.array(optionSchema).min(2).max(3),
  multiple: z.boolean().optional(),
  custom: z.boolean().optional(),
})

export function createQuestionHostCapability(broker: HostQuestionBroker): HostCapability {
  return {
    id: QUESTION_CAPABILITY_ID,
    version: "1.0.0",
    instructions:
      "Use ask_user only when a missing choice materially changes the result. It blocks until the user answers or declines.",
    tools: [
      {
        name: "ask_user",
        description:
          "Ask one to three concise structured questions in Wanta's native UI and wait for the answers. Put the recommended option first and mark its label with '(Recommended)'.",
        inputSchema: z.object({ questions: z.array(questionSchema).min(1).max(3) }),
        execute: async (context, input) => ({
          text: JSON.stringify({ answers: await broker.ask(context.sessionId, input.questions as ChatQuestionInfo[]) }),
        }),
      },
    ],
  }
}
