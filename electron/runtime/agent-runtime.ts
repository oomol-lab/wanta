import type { MainProcessCloudRuntime } from "../agent/manager.ts"
import type { ModelChoice } from "../models/common.ts"
import type { PersistedCustomModel } from "../models/store.ts"

import { defaultModelChoice } from "../models/store.ts"

export interface RuntimeAccountInput {
  id: string
  sessionToken: string
}

export interface AgentRuntimeResolution {
  cloudRuntime: MainProcessCloudRuntime
  defaultModel: ModelChoice
  key: string
  mode: "local" | "oomol"
}

export function resolveAgentRuntime(
  account: RuntimeAccountInput | null,
  selected: ModelChoice,
  customModels: readonly PersistedCustomModel[],
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
      cloudRuntime: { kind: "oomol", sessionToken },
      defaultModel,
      key: `oomol:${account.id}:${sessionToken}`,
      mode: "oomol",
    }
  }
  const selectedCustom =
    selected.kind === "custom" ? availableCustomModels.find((model) => model.id === selected.id) : undefined
  const customModel = selectedCustom ?? availableCustomModels[0]
  if (!customModel) return null
  return {
    cloudRuntime: { kind: "local" },
    defaultModel: { kind: "custom", id: customModel.id },
    key: `local:${customModel.id}`,
    mode: "local",
  }
}
