import type { ModelChoice } from "../models/common.ts"
import type { RuntimeCustomModel } from "../models/store.ts"
import type { ClaudeModelRoute } from "./claude-model-gateway.ts"
import type { WantaReasoningLevel } from "./reasoning.ts"

import { llmBaseUrl } from "../domain.ts"
import { builtinProviderDefinition, isBuiltinModelId, resolveBuiltinModel } from "../models/builtin.ts"
import { customModelDisplayName } from "../models/store.ts"

export interface ClaudeModelRouteInput {
  accountSessionToken?: string
  choice: ModelChoice
  customModels: readonly RuntimeCustomModel[]
  reasoningLevel?: WantaReasoningLevel
}

/** Resolve a public Wanta model choice into a credential-bearing main-process route. */
export function resolveClaudeModelRoute(input: ClaudeModelRouteInput): ClaudeModelRoute {
  if (input.choice.kind === "custom") {
    const model = input.customModels.find((candidate) => candidate.id === input.choice.id)
    if (!model) throw new Error("The selected custom model is unavailable or its API key is missing.")
    return {
      apiKey: model.apiKey,
      baseUrl: model.baseUrl,
      contextWindow: model.contextWindow,
      displayName: customModelDisplayName(model),
      maxOutputTokens: model.maxOutputTokens,
      modelId: model.modelName,
      providerKind: "openai-compatible",
      reasoningLevel: input.reasoningLevel,
      reasoningStyle: isQwenModel(model.providerId, model.providerName, model.modelName) ? "qwen-thinking" : "effort",
    }
  }
  if (!isBuiltinModelId(input.choice.id)) throw new Error(`Unknown Wanta model: ${input.choice.id}`)
  const sessionToken = input.accountSessionToken?.trim()
  if (!sessionToken) {
    throw new Error("Sign in to Wanta to use a built-in model, or select a configured custom model.")
  }
  const model = resolveBuiltinModel(input.choice.id)
  const provider = builtinProviderDefinition(model.runtime.providerID)
  if (!provider) throw new Error(`Unknown Wanta model provider: ${model.runtime.providerID}`)
  return {
    apiKey: sessionToken,
    baseUrl: llmBaseUrl,
    contextWindow: model.contextWindow,
    displayName: model.displayName,
    maxOutputTokens: model.maxOutputTokens,
    modelId: model.runtime.modelID,
    providerKind: provider.kind,
    reasoningLevel: input.reasoningLevel,
    reasoningStyle: model.providerName === "Qwen" ? "qwen-thinking" : "effort",
  }
}

function isQwenModel(providerId: string, providerName: string, modelName: string): boolean {
  return (
    providerId === "qwen" ||
    providerName.trim().toLowerCase() === "qwen" ||
    modelName.trim().toLowerCase().startsWith("qwen")
  )
}
