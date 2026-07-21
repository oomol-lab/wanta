import type { ModelChoice } from "../models/common.ts"
import type { RuntimeCustomModel } from "../models/store.ts"

import { createHash } from "node:crypto"
import { defaultModelChoice } from "../models/store.ts"

export type ModelAccess = { kind: "local" } | { kind: "oomol"; sessionToken: string }

export type LinkRuntime =
  | { kind: "oomol"; sessionToken: string; teamName?: string }
  | { kind: "openconnector"; baseUrl: string; consoleUrl: string; runtimeToken?: string }

export interface RuntimeAccountInput {
  id: string
  sessionToken: string
}

export interface AgentRuntimeResolution {
  defaultModel: ModelChoice
  key: string
  modelAccess: ModelAccess
  mode: "local" | "oomol"
}

export function resolveAgentRuntime(
  account: RuntimeAccountInput | null,
  selected: ModelChoice,
  customModels: readonly RuntimeCustomModel[],
): AgentRuntimeResolution | null {
  const availableCustomModels = customModels.filter(
    (model) => model.id.trim() && model.baseUrl.trim() && model.apiKey.trim() && model.modelName.trim(),
  )
  const sessionToken = account?.sessionToken.trim()
  if (account && sessionToken) {
    const defaultModel =
      selected.kind === "custom" && !availableCustomModels.some((model) => model.id === selected.id)
        ? defaultModelChoice()
        : selected
    return {
      defaultModel,
      key: `oomol:${account.id}:${credentialRevision(sessionToken)}`,
      modelAccess: { kind: "oomol", sessionToken },
      mode: "oomol",
    }
  }
  const selectedCustom =
    selected.kind === "custom" ? availableCustomModels.find((model) => model.id === selected.id) : undefined
  const customModel = selectedCustom ?? availableCustomModels[0]
  if (!customModel) return null
  return {
    defaultModel: { kind: "custom", id: customModel.id },
    key: `local:${customModel.id}`,
    modelAccess: { kind: "local" },
    mode: "local",
  }
}

function credentialRevision(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16)
}
