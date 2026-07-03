import type {
  ConnectionOAuthClientConfigFieldDefinition,
  ConnectionProviderOAuthClientConfigSummary,
  ConnectionUserOAuthClientConfigSummary,
  UpsertConnectionOAuthClientConfigPayload,
} from "../../../electron/connections/common.ts"

export interface OAuthClientConfigDraft {
  clientId: string
  clientSecret: string
  extra: Record<string, OAuthClientConfigFieldDraftValue>
  secretExtra: Record<string, OAuthClientConfigFieldDraftValue>
}

export type OAuthClientConfigFieldDraftValue = string | string[]
export type OAuthConnectBlockedReason = "oauth-client-config-required" | "service-unavailable"

export interface OAuthConnectViewModel {
  blockedReason: OAuthConnectBlockedReason | null
  canConnect: boolean
  connectOnlyFields: ConnectionOAuthClientConfigFieldDefinition[]
  persistentDirty: boolean
  persistentFields: ConnectionOAuthClientConfigFieldDefinition[]
  requiresClientSecret: boolean
  showConnectOnlySection: boolean
  showPersistentSection: boolean
}

export function createEmptyOAuthClientConfigDraft(): OAuthClientConfigDraft {
  return {
    clientId: "",
    clientSecret: "",
    extra: {},
    secretExtra: {},
  }
}

export function resolveProviderOAuthClientConfig(
  providerOAuthClientConfig: ConnectionProviderOAuthClientConfigSummary | null | undefined,
  userOAuthClientConfig: ConnectionUserOAuthClientConfigSummary | null | undefined,
): ConnectionProviderOAuthClientConfigSummary | null | undefined {
  if (
    providerOAuthClientConfig &&
    userOAuthClientConfig?.configured &&
    providerOAuthClientConfig.clientConfigPolicy === "user_required"
  ) {
    return {
      ...providerOAuthClientConfig,
      configured: true,
      nextConnectSource: userOAuthClientConfig.nextConnectSource,
    }
  }
  return providerOAuthClientConfig
}

export function createOAuthClientConfigDraft(input: {
  providerOAuthClientConfig: ConnectionProviderOAuthClientConfigSummary | null | undefined
  previousDraft?: OAuthClientConfigDraft
  userOAuthClientConfig: ConnectionUserOAuthClientConfigSummary | null | undefined
}): OAuthClientConfigDraft {
  const { previousDraft, providerOAuthClientConfig, userOAuthClientConfig } = input
  const fieldDefinitions = getOAuthClientConfigFieldDefinitions(providerOAuthClientConfig, userOAuthClientConfig)
  const extra: Record<string, OAuthClientConfigFieldDraftValue> = {}
  const secretExtra: Record<string, OAuthClientConfigFieldDraftValue> = {}

  for (const field of fieldDefinitions) {
    if (field.location === "extra") {
      extra[field.key] = getDraftFieldValue({
        field,
        previousDraftValue: previousDraft?.extra,
        storedValue: isConnectOnlyOAuthClientConfigField(field) ? undefined : userOAuthClientConfig?.extra,
      })
      continue
    }

    secretExtra[field.key] = getDraftFieldValue({
      field,
      previousDraftValue: previousDraft?.secretExtra,
    })
  }

  return {
    clientId: previousDraft?.clientId ?? userOAuthClientConfig?.clientId ?? "",
    clientSecret: previousDraft?.clientSecret ?? "",
    extra,
    secretExtra,
  }
}

export function getOAuthClientConfigFieldDefinitions(
  providerOAuthClientConfig: ConnectionProviderOAuthClientConfigSummary | null | undefined,
  userOAuthClientConfig: ConnectionUserOAuthClientConfigSummary | null | undefined,
): ConnectionOAuthClientConfigFieldDefinition[] {
  return providerOAuthClientConfig?.clientConfigFields ?? userOAuthClientConfig?.clientConfigFields ?? []
}

export function getPersistentOAuthClientConfigFieldDefinitions(
  fieldDefinitions: readonly ConnectionOAuthClientConfigFieldDefinition[],
): ConnectionOAuthClientConfigFieldDefinition[] {
  return fieldDefinitions.filter((field) => !isConnectOnlyOAuthClientConfigField(field))
}

export function getConnectOnlyOAuthClientConfigFieldDefinitions(
  fieldDefinitions: readonly ConnectionOAuthClientConfigFieldDefinition[],
): ConnectionOAuthClientConfigFieldDefinition[] {
  return fieldDefinitions.filter(isConnectOnlyOAuthClientConfigField)
}

export function isConnectOnlyOAuthClientConfigField(field: ConnectionOAuthClientConfigFieldDefinition): boolean {
  return field.connectOnly === true
}

export function buildOAuthConnectViewModel(input: {
  baselineDraft?: OAuthClientConfigDraft
  currentDraft?: OAuthClientConfigDraft
  providerOAuthClientConfig: ConnectionProviderOAuthClientConfigSummary | null | undefined
  userOAuthClientConfig: ConnectionUserOAuthClientConfigSummary | null | undefined
}): OAuthConnectViewModel {
  const providerOAuthClientConfig = resolveProviderOAuthClientConfig(
    input.providerOAuthClientConfig,
    input.userOAuthClientConfig,
  )
  const fieldDefinitions = getOAuthClientConfigFieldDefinitions(providerOAuthClientConfig, input.userOAuthClientConfig)
  const persistentFields = getPersistentOAuthClientConfigFieldDefinitions(fieldDefinitions)
  const connectOnlyFields = getConnectOnlyOAuthClientConfigFieldDefinitions(fieldDefinitions)
  const currentDraft = input.currentDraft ?? createEmptyOAuthClientConfigDraft()
  const baselineDraft = input.baselineDraft ?? createEmptyOAuthClientConfigDraft()
  const blockedReason = getOAuthClientConfigBlockedReason(providerOAuthClientConfig)
  const showPersistentSection = providerOAuthClientConfig?.clientConfigPolicy === "user_required"
  const showConnectOnlySection = connectOnlyFields.length > 0 && blockedReason == null
  const requiresClientSecret = providerOAuthClientConfig?.tokenEndpointAuthMethod !== "none"
  const persistentDirty =
    showPersistentSection &&
    isPersistentDraftDirty({
      baselineDraft,
      currentDraft,
      persistentFields,
      requiresClientSecret,
    })

  return {
    blockedReason,
    canConnect: blockedReason == null && !persistentDirty,
    connectOnlyFields,
    persistentDirty,
    persistentFields,
    requiresClientSecret,
    showConnectOnlySection,
    showPersistentSection,
  }
}

export function shouldOpenOAuthClientDialog(input: {
  providerOAuthClientConfig: ConnectionProviderOAuthClientConfigSummary | null | undefined
  userOAuthClientConfig: ConnectionUserOAuthClientConfigSummary | null | undefined
}): boolean {
  if (!input.providerOAuthClientConfig) {
    return false
  }
  const emptyDraft = createEmptyOAuthClientConfigDraft()
  const viewModel = buildOAuthConnectViewModel({
    baselineDraft: emptyDraft,
    currentDraft: emptyDraft,
    providerOAuthClientConfig: input.providerOAuthClientConfig,
    userOAuthClientConfig: input.userOAuthClientConfig,
  })
  return !viewModel.canConnect || viewModel.showPersistentSection || viewModel.showConnectOnlySection
}

export function buildOAuthClientConfigPayload(input: {
  draft: OAuthClientConfigDraft
  fieldDefinitions: ConnectionOAuthClientConfigFieldDefinition[]
  tokenEndpointAuthMethod?: ConnectionProviderOAuthClientConfigSummary["tokenEndpointAuthMethod"]
}): UpsertConnectionOAuthClientConfigPayload {
  const payload = buildOAuthFieldPayload({
    draft: input.draft,
    fieldDefinitions: getPersistentOAuthClientConfigFieldDefinitions(input.fieldDefinitions),
  })
  const clientSecret = input.draft.clientSecret.trim()

  return {
    clientId: input.draft.clientId.trim(),
    clientSecret: input.tokenEndpointAuthMethod === "none" || !clientSecret ? undefined : clientSecret,
    extra: payload.extra,
    secretExtra: payload.secretExtra,
  }
}

export function buildOAuthConnectPayload(input: {
  draft: OAuthClientConfigDraft
  fieldDefinitions: ConnectionOAuthClientConfigFieldDefinition[]
}): { extra?: Record<string, unknown>; secretExtra?: Record<string, string> } {
  return buildOAuthFieldPayload({
    draft: input.draft,
    fieldDefinitions: getConnectOnlyOAuthClientConfigFieldDefinitions(input.fieldDefinitions),
  })
}

export function validateOAuthPersistentFields(
  viewModel: OAuthConnectViewModel,
  draft: OAuthClientConfigDraft,
  userOAuthClientConfig: ConnectionUserOAuthClientConfigSummary | null,
): boolean {
  if (!viewModel.showPersistentSection) {
    return true
  }
  if (!draft.clientId.trim()) {
    return false
  }
  if (
    viewModel.requiresClientSecret &&
    !draft.clientSecret.trim() &&
    draft.clientId.trim() !== userOAuthClientConfig?.clientId
  ) {
    return false
  }
  return validateOAuthFields(viewModel.persistentFields, draft, userOAuthClientConfig?.hasSecretExtra)
}

export function validateOAuthFields(
  fields: ConnectionOAuthClientConfigFieldDefinition[],
  draft: OAuthClientConfigDraft,
  savedSecretExtra: Record<string, boolean> = {},
): boolean {
  return fields.every((field) => {
    if (!field.required) {
      return true
    }
    const record = field.location === "extra" ? draft.extra : draft.secretExtra
    const value = getOAuthClientConfigRequiredRuleValue(field, record[field.key])
    if (field.location === "secretExtra" && savedSecretExtra[field.key] && value.length === 0) {
      return true
    }
    return value.length > 0
  })
}

export function getOAuthClientConfigRequiredRuleValue(
  field: ConnectionOAuthClientConfigFieldDefinition,
  value: OAuthClientConfigFieldDraftValue | undefined,
): string | string[] {
  return field.inputType === "string_array"
    ? normalizeStringArrayDraft(value)
    : (typeof value === "string" ? value : "").trim()
}

export function normalizeStringArrayDraft(value: OAuthClientConfigFieldDraftValue | undefined): string[] {
  const items = Array.isArray(value) ? value : (value?.split("\n") ?? [])
  return items.map((item) => item.trim()).filter(Boolean)
}

function getOAuthClientConfigBlockedReason(
  providerOAuthClientConfig: ConnectionProviderOAuthClientConfigSummary | null | undefined,
): OAuthConnectBlockedReason | null {
  if (providerOAuthClientConfig == null) {
    return "service-unavailable"
  }
  if (providerOAuthClientConfig.clientConfigPolicy === "user_required") {
    return providerOAuthClientConfig.configured ? null : "oauth-client-config-required"
  }
  return providerOAuthClientConfig.nextConnectSource === "default" ? null : "service-unavailable"
}

function isPersistentDraftDirty(input: {
  baselineDraft: OAuthClientConfigDraft
  currentDraft: OAuthClientConfigDraft
  persistentFields: readonly ConnectionOAuthClientConfigFieldDefinition[]
  requiresClientSecret: boolean
}): boolean {
  const { baselineDraft, currentDraft, persistentFields, requiresClientSecret } = input
  return (
    currentDraft.clientId.trim() !== baselineDraft.clientId.trim() ||
    (requiresClientSecret && currentDraft.clientSecret.trim() !== baselineDraft.clientSecret.trim()) ||
    persistentFields.some((field) => isFieldDirty(field, currentDraft, baselineDraft))
  )
}

function isFieldDirty(
  field: ConnectionOAuthClientConfigFieldDefinition,
  currentDraft: OAuthClientConfigDraft,
  baselineDraft: OAuthClientConfigDraft,
): boolean {
  const currentValue = getFieldRuleValue(field, currentDraft)
  const baselineValue = getFieldRuleValue(field, baselineDraft)
  return Array.isArray(currentValue) || Array.isArray(baselineValue)
    ? JSON.stringify(currentValue) !== JSON.stringify(baselineValue)
    : currentValue !== baselineValue
}

function getFieldRuleValue(
  field: ConnectionOAuthClientConfigFieldDefinition,
  draft: OAuthClientConfigDraft,
): string | string[] {
  const record = field.location === "extra" ? draft.extra : draft.secretExtra
  return getOAuthClientConfigRequiredRuleValue(field, record[field.key])
}

function getDraftFieldValue(input: {
  field: ConnectionOAuthClientConfigFieldDefinition
  previousDraftValue?: Record<string, OAuthClientConfigFieldDraftValue>
  storedValue?: Record<string, unknown>
}): OAuthClientConfigFieldDraftValue {
  const { field, previousDraftValue, storedValue } = input

  if (previousDraftValue != null && Object.hasOwn(previousDraftValue, field.key)) {
    return previousDraftValue[field.key] ?? ""
  }

  if (storedValue != null && Object.hasOwn(storedValue, field.key)) {
    return deserializeOAuthClientConfigFieldValue(field, storedValue[field.key])
  }

  if (field.defaultValue != null) {
    return deserializeOAuthClientConfigFieldValue(field, field.defaultValue)
  }

  return field.inputType === "string_array" ? [] : ""
}

function deserializeOAuthClientConfigFieldValue(
  field: ConnectionOAuthClientConfigFieldDefinition,
  value: unknown,
): OAuthClientConfigFieldDraftValue {
  if (field.inputType === "string_array") {
    return Array.isArray(value)
      ? value.map((item) => String(item))
      : typeof value === "string"
        ? normalizeStringArrayDraft(value)
        : []
  }

  return typeof value === "string" ? value : ""
}

function serializeOAuthClientConfigFieldValue(
  field: ConnectionOAuthClientConfigFieldDefinition,
  value: OAuthClientConfigFieldDraftValue | undefined,
): string | string[] {
  if (field.inputType === "string_array") {
    return normalizeStringArrayDraft(value)
  }
  return (typeof value === "string" ? value : "").trim()
}

function buildOAuthFieldPayload(input: {
  draft: OAuthClientConfigDraft
  fieldDefinitions: readonly ConnectionOAuthClientConfigFieldDefinition[]
}): { extra?: Record<string, unknown>; secretExtra?: Record<string, string> } {
  const extra: Record<string, unknown> = {}
  const secretExtra: Record<string, string> = {}

  for (const field of input.fieldDefinitions) {
    const source = field.location === "extra" ? input.draft.extra : input.draft.secretExtra
    const rawValue = source[field.key]

    if (field.location === "secretExtra") {
      const nextValue = Array.isArray(rawValue)
        ? normalizeStringArrayDraft(rawValue).join("\n")
        : (rawValue ?? "").trim()
      if (nextValue) {
        secretExtra[field.key] = nextValue
      }
      continue
    }

    extra[field.key] = serializeOAuthClientConfigFieldValue(field, rawValue)
  }

  return {
    extra: Object.keys(extra).length > 0 ? extra : undefined,
    secretExtra: Object.keys(secretExtra).length > 0 ? secretExtra : undefined,
  }
}
