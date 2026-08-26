import type { WantaReasoningLevel } from "./reasoning.ts"
import type { JSONValue, LanguageModel } from "ai"

import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"

export type WantaModelRouteProviderKind = "openai-compatible" | "openai-responses"

/** A credential-bearing route that remains inside Electron main. */
export interface WantaModelRoute {
  apiKey: string
  baseUrl: string
  contextWindow?: number
  displayName: string
  maxOutputTokens?: number
  modelId: string
  providerKind: WantaModelRouteProviderKind
  reasoningLevel?: WantaReasoningLevel
  reasoningStyle?: "effort" | "qwen-thinking"
}

/** Build the AI SDK model shared by each authenticated loopback protocol gateway. */
export function createLanguageModel(route: WantaModelRoute): LanguageModel {
  if (route.providerKind === "openai-responses") {
    return createOpenAI({ apiKey: route.apiKey, baseURL: route.baseUrl, name: "wanta" }).responses(route.modelId)
  }
  return createOpenAICompatible({
    apiKey: route.apiKey,
    baseURL: route.baseUrl,
    includeUsage: true,
    name: "wanta",
    ...(route.reasoningStyle === "qwen-thinking" && route.reasoningLevel !== undefined
      ? {
          transformRequestBody: (body: Record<string, unknown>) => ({
            ...body,
            enable_thinking: route.reasoningLevel !== "low",
          }),
        }
      : {}),
  }).languageModel(route.modelId)
}

export function reasoningProviderOptions(
  route: WantaModelRoute,
): Record<string, Record<string, JSONValue | undefined>> | undefined {
  const level = route.reasoningLevel
  if (!level || level === "default" || route.reasoningStyle === "qwen-thinking") return undefined
  const effort = level === "max" && route.providerKind === "openai-responses" ? "xhigh" : level
  return { [route.providerKind === "openai-responses" ? "openai" : "wanta"]: { reasoningEffort: effort } }
}

export function boundedMaxOutputTokens(requested: number | undefined, configured: number | undefined): number {
  const requestValue = positiveInteger(requested) ?? 8_192
  return configured ? Math.min(requestValue, configured) : requestValue
}

function positiveInteger(value: number | undefined): number | undefined {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value : undefined
}
