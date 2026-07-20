import type { ModelCatalog, ModelChoice } from "../../../electron/models/common.ts"

import { DEFAULT_BUILTIN_MODEL_ID, resolveBuiltinModel } from "../../../electron/models/builtin.ts"

export interface SelectedModelSummary {
  label: string
  supportsImages: boolean
}

export type ModelMenuItem =
  | {
      active: boolean
      choice: ModelChoice
      id: string
      kind: "builtin"
      supportsImages?: boolean
      title: string
    }
  | {
      active: boolean
      choice: ModelChoice
      id: string
      kind: "custom"
      modelId: string
      providerName: string
      supportsImages?: boolean
      title: string
    }
  | {
      active: false
      id: string
      kind: "add"
      title: string
    }

export function sameModelChoice(a: ModelChoice | undefined, b: ModelChoice | undefined): boolean {
  return Boolean(a && b && a.kind === b.kind && a.id === b.id)
}

export function selectedModelSummary(catalog: ModelCatalog | null): SelectedModelSummary {
  if (!catalog) {
    const fallback = resolveBuiltinModel(DEFAULT_BUILTIN_MODEL_ID)
    return { label: fallback.displayName, supportsImages: fallback.capabilities.supportsImages }
  }
  const selected = catalog.selected
  if (selected.kind === "custom") {
    const custom = catalog.customModels.find((model) => model.id === selected.id)
    if (custom) {
      return { label: custom.displayName, supportsImages: custom.supportsImages }
    }
  }
  const builtin =
    (selected.kind === "builtin" ? catalog.builtins.find((model) => model.id === selected.id) : undefined) ??
    catalog.builtins[0]
  return { label: builtin?.displayName ?? "Auto", supportsImages: builtin?.supportsImages ?? false }
}

export function buildModelMenuItems(catalog: ModelCatalog | null, addTitle: string): ModelMenuItem[] {
  const selected = selectedModelSummary(catalog)
  if (!catalog) {
    return [
      {
        active: true,
        choice: { kind: "builtin", id: DEFAULT_BUILTIN_MODEL_ID },
        id: `builtin:${DEFAULT_BUILTIN_MODEL_ID}`,
        kind: "builtin",
        supportsImages: selected.supportsImages,
        title: selected.label,
      },
      { active: false, id: "action:add", kind: "add", title: addTitle },
    ]
  }

  return [
    ...catalog.builtins.map((model): ModelMenuItem => {
      const choice: ModelChoice = { kind: "builtin", id: model.id }
      return {
        active: sameModelChoice(catalog.selected, choice),
        choice,
        id: `builtin:${model.id}`,
        kind: "builtin",
        supportsImages: model.supportsImages,
        title: model.displayName,
      }
    }),
    ...catalog.customModels.map((model): ModelMenuItem => {
      const choice: ModelChoice = { kind: "custom", id: model.id }
      return {
        active: sameModelChoice(catalog.selected, choice),
        choice,
        id: `custom:${model.id}`,
        kind: "custom",
        modelId: model.id,
        providerName: model.providerName,
        supportsImages: model.supportsImages,
        title: model.displayName,
      }
    }),
    { active: false, id: "action:add", kind: "add", title: addTitle },
  ]
}

export function combinedModelReasoningLabel(modelLabel: string, reasoningLabel: string): string {
  return `${modelLabel} · ${reasoningLabel}`
}

export function modelReasoningTriggerLabel({
  modelLabel,
  modelRequired,
  modelRequiredLabel,
  reasoningLabel,
}: {
  modelLabel: string
  modelRequired: boolean
  modelRequiredLabel: string
  reasoningLabel: string
}): string {
  return modelRequired ? modelRequiredLabel : combinedModelReasoningLabel(modelLabel, reasoningLabel)
}
