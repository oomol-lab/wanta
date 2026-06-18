import type { BuiltinModelId } from "./builtin.ts"
import type { ServiceName } from "@oomol/connection"

import { serviceName } from "../branding.ts"

export interface BuiltinModelSummary {
  id: BuiltinModelId
  displayName: string
  providerName: string
  supportsImages: boolean
  toolCall: boolean
  runtimeKind: "openai-compatible" | "openai-responses"
}

export interface CustomModelProvider {
  id: string
  displayName: string
  baseUrl: string
  documentationUrl?: string
  requiresBaseUrl?: boolean
}

export interface CustomModelSummary {
  id: string
  providerId: string
  providerName: string
  baseUrl: string
  modelName: string
  displayName: string
  apiKeyConfigured: boolean
  supportsImages: boolean
}

export type ModelChoice = { kind: "builtin"; id: BuiltinModelId } | { kind: "custom"; id: string }

export interface ModelCatalog {
  builtins: BuiltinModelSummary[]
  customModels: CustomModelSummary[]
  providers: CustomModelProvider[]
  selected: ModelChoice
}

export interface SaveCustomModelRequest {
  id?: string
  providerId: string
  providerName?: string
  baseUrl?: string
  apiKey?: string
  modelName: string
  displayName?: string
  supportsImages?: boolean
}

export type ModelsService = typeof ModelsService
export const ModelsService = serviceName("models-service") as ServiceName<{
  ServerEvents: {
    modelsChanged: ModelCatalog
  }
  ClientInvokes: {
    listModels(): Promise<ModelCatalog>
    setSelectedModel(choice: ModelChoice): Promise<ModelCatalog>
    saveCustomModel(req: SaveCustomModelRequest): Promise<ModelCatalog>
    deleteCustomModel(id: string): Promise<ModelCatalog>
  }
}>
