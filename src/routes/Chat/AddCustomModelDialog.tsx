import type { WantaReasoningVariant } from "../../../electron/agent/reasoning.ts"
import type {
  CustomModelApiPlan,
  CustomModelProvider,
  SaveCustomModelRequest,
} from "../../../electron/models/common.ts"
import type { UserFacingError } from "@/lib/user-facing-error"

import { ExternalLink } from "lucide-react"
import * as React from "react"
import { WANTA_REASONING_VARIANT_LEVELS } from "../../../electron/agent/reasoning.ts"
import { reasoningLevelLabel } from "./model-control-utils.ts"
import { ErrorNotice } from "@/components/ErrorNotice"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useT } from "@/i18n/i18n"

type ApiEndpointSource = Pick<CustomModelProvider | CustomModelApiPlan, "apiRegions" | "baseUrl">

function selectedApiPlan(provider: CustomModelProvider | undefined, apiPlanId: string): CustomModelApiPlan | undefined {
  return provider?.apiPlans?.find((plan) => plan.id === apiPlanId) ?? provider?.apiPlans?.[0]
}

function providerDefaultApiPlanId(provider: CustomModelProvider | undefined): string {
  return provider?.apiPlans?.[0]?.id ?? ""
}

function providerEndpoint(
  provider: CustomModelProvider | undefined,
  apiPlanId = providerDefaultApiPlanId(provider),
): ApiEndpointSource | undefined {
  return selectedApiPlan(provider, apiPlanId) ?? provider
}

function endpointBaseUrl(endpoint: ApiEndpointSource | undefined): string {
  return endpoint?.apiRegions?.[0]?.baseUrl ?? endpoint?.baseUrl ?? ""
}

function providerBaseUrl(provider: CustomModelProvider | undefined): string {
  return endpointBaseUrl(providerEndpoint(provider))
}

function endpointDefaultApiRegionId(endpoint: ApiEndpointSource | undefined): string {
  return endpoint?.apiRegions?.[0]?.id ?? ""
}

function providerDefaultModelName(provider: CustomModelProvider | undefined): string {
  return provider?.modelOptions?.[0]?.id ?? ""
}

function apiPlanLabel(id: string, t: ReturnType<typeof useT>): string {
  if (id === "standard") {
    return t("chat.modelApiPlanStandard")
  }
  if (id === "coding") {
    return t("chat.modelApiPlanCoding")
  }
  if (id === "token") {
    return t("chat.modelApiPlanToken")
  }
  return id
}

function apiRegionLabel(id: string, t: ReturnType<typeof useT>): string {
  if (id === "cn") {
    return t("chat.modelApiRegionCn")
  }
  if (id === "global") {
    return t("chat.modelApiRegionGlobal")
  }
  if (id === "sgp") {
    return t("chat.modelApiRegionSgp")
  }
  if (id === "ams") {
    return t("chat.modelApiRegionAms")
  }
  return id
}

function providerDisplayName(provider: CustomModelProvider | undefined, t: ReturnType<typeof useT>): string {
  if (!provider) {
    return ""
  }
  if (provider.id === "custom") {
    return t("chat.modelProviderCustom")
  }
  return provider.displayName
}

function providerDefaultSupportsImages(provider: CustomModelProvider | undefined, modelName: string): boolean {
  const option = provider?.modelOptions?.find((model) => model.id === modelName.trim())
  return option?.supportsImages ?? provider?.supportsImages ?? false
}

function providerDefaultSupportsToolCalls(provider: CustomModelProvider | undefined, modelName: string): boolean {
  const option = provider?.modelOptions?.find((model) => model.id === modelName.trim())
  return option?.supportsToolCalls ?? provider?.supportsToolCalls ?? true
}

function providerDefaultContextWindow(provider: CustomModelProvider | undefined, modelName: string): string {
  const option = provider?.modelOptions?.find((model) => model.id === modelName.trim())
  return String(option?.contextWindow ?? provider?.contextWindow ?? "")
}

function providerDefaultInputTokenLimit(provider: CustomModelProvider | undefined, modelName: string): string {
  const option = provider?.modelOptions?.find((model) => model.id === modelName.trim())
  return String(option?.inputTokenLimit ?? provider?.inputTokenLimit ?? "")
}

function providerDefaultMaxOutputTokens(provider: CustomModelProvider | undefined, modelName: string): string {
  const option = provider?.modelOptions?.find((model) => model.id === modelName.trim())
  return String(option?.maxOutputTokens ?? provider?.maxOutputTokens ?? "")
}

function providerDefaultReasoningVariants(
  provider: CustomModelProvider | undefined,
  modelName: string,
): WantaReasoningVariant[] {
  const option = provider?.modelOptions?.find((model) => model.id === modelName.trim())
  return [...(option?.reasoningVariants ?? provider?.reasoningVariants ?? [])]
}

function optionalTokenLimit(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

const modelDialogControlClass = "h-[var(--oo-control-height)] w-full px-2.5 text-sm"

export function AddCustomModelDialog({
  open,
  providers,
  error,
  onClose,
  onSave,
}: {
  open: boolean
  providers: CustomModelProvider[]
  error: UserFacingError | null
  onClose: () => void
  onSave: (req: SaveCustomModelRequest) => Promise<void>
}) {
  const t = useT()
  const firstProvider = providers[0]
  const [providerId, setProviderId] = React.useState(firstProvider?.id ?? "custom")
  const [apiPlanId, setApiPlanId] = React.useState(providerDefaultApiPlanId(firstProvider))
  const [baseUrl, setBaseUrl] = React.useState(providerBaseUrl(firstProvider))
  const [apiKey, setApiKey] = React.useState("")
  const [modelName, setModelName] = React.useState("")
  const [apiRegionId, setApiRegionId] = React.useState(endpointDefaultApiRegionId(providerEndpoint(firstProvider)))
  const [supportsImages, setSupportsImages] = React.useState(providerDefaultSupportsImages(firstProvider, ""))
  const [supportsToolCalls, setSupportsToolCalls] = React.useState(providerDefaultSupportsToolCalls(firstProvider, ""))
  const [contextWindow, setContextWindow] = React.useState(providerDefaultContextWindow(firstProvider, ""))
  const [inputTokenLimit, setInputTokenLimit] = React.useState(providerDefaultInputTokenLimit(firstProvider, ""))
  const [maxOutputTokens, setMaxOutputTokens] = React.useState(providerDefaultMaxOutputTokens(firstProvider, ""))
  const [reasoningVariants, setReasoningVariants] = React.useState<WantaReasoningVariant[]>(
    providerDefaultReasoningVariants(firstProvider, ""),
  )
  const [saving, setSaving] = React.useState(false)
  const wasOpenRef = React.useRef(false)
  const supportsImagesId = React.useId()
  const supportsToolCallsId = React.useId()
  const contextWindowId = React.useId()
  const inputTokenLimitId = React.useId()
  const maxOutputTokensId = React.useId()
  const provider = providers.find((item) => item.id === providerId)
  const modelOptions = provider?.modelOptions ?? []
  const apiPlans = provider?.apiPlans ?? []
  const apiEndpoint = providerEndpoint(provider, apiPlanId)
  const apiRegions = apiEndpoint?.apiRegions ?? []

  React.useEffect(() => {
    const wasOpen = wasOpenRef.current
    wasOpenRef.current = open
    if (!open || wasOpen) {
      return
    }

    const initial = providers[0]
    setProviderId(initial?.id ?? "custom")
    setBaseUrl(providerBaseUrl(initial))
    const initialModelName = providerDefaultModelName(initial)
    setModelName(initialModelName)
    setApiPlanId(providerDefaultApiPlanId(initial))
    setApiRegionId(endpointDefaultApiRegionId(providerEndpoint(initial)))
    setSupportsImages(providerDefaultSupportsImages(initial, initialModelName))
    setSupportsToolCalls(providerDefaultSupportsToolCalls(initial, initialModelName))
    setContextWindow(providerDefaultContextWindow(initial, initialModelName))
    setInputTokenLimit(providerDefaultInputTokenLimit(initial, initialModelName))
    setMaxOutputTokens(providerDefaultMaxOutputTokens(initial, initialModelName))
    setReasoningVariants(providerDefaultReasoningVariants(initial, initialModelName))
    setApiKey("")
    setSaving(false)
  }, [open, providers])

  const handleProviderChange = (nextId: string): void => {
    const next = providers.find((item) => item.id === nextId)
    const nextPlanId = providerDefaultApiPlanId(next)
    const nextEndpoint = providerEndpoint(next, nextPlanId)
    const nextModelName = providerDefaultModelName(next)
    setProviderId(nextId)
    setApiPlanId(nextPlanId)
    setBaseUrl(endpointBaseUrl(nextEndpoint))
    setModelName(nextModelName)
    setApiRegionId(endpointDefaultApiRegionId(nextEndpoint))
    setSupportsImages(providerDefaultSupportsImages(next, nextModelName))
    setSupportsToolCalls(providerDefaultSupportsToolCalls(next, nextModelName))
    setContextWindow(providerDefaultContextWindow(next, nextModelName))
    setInputTokenLimit(providerDefaultInputTokenLimit(next, nextModelName))
    setMaxOutputTokens(providerDefaultMaxOutputTokens(next, nextModelName))
    setReasoningVariants(providerDefaultReasoningVariants(next, nextModelName))
  }

  const handleModelChange = (nextModelName: string): void => {
    setModelName(nextModelName)
    setSupportsImages(providerDefaultSupportsImages(provider, nextModelName))
    setSupportsToolCalls(providerDefaultSupportsToolCalls(provider, nextModelName))
    setContextWindow(providerDefaultContextWindow(provider, nextModelName))
    setInputTokenLimit(providerDefaultInputTokenLimit(provider, nextModelName))
    setMaxOutputTokens(providerDefaultMaxOutputTokens(provider, nextModelName))
    setReasoningVariants(providerDefaultReasoningVariants(provider, nextModelName))
  }

  const handleApiPlanChange = (nextId: string): void => {
    if (!nextId) {
      return
    }
    const nextEndpoint = providerEndpoint(provider, nextId)
    setApiPlanId(nextId)
    setBaseUrl(endpointBaseUrl(nextEndpoint))
    setApiRegionId(endpointDefaultApiRegionId(nextEndpoint))
  }

  const handleApiRegionChange = (nextId: string): void => {
    if (!nextId) {
      return
    }
    const next = apiRegions.find((item) => item.id === nextId)
    if (!next) {
      return
    }
    setApiRegionId(nextId)
    setBaseUrl(next.baseUrl)
  }

  const canSave = Boolean(
    providerId && apiKey.trim() && modelName.trim() && (!(provider?.requiresBaseUrl ?? true) || baseUrl.trim()),
  )
  const toggleReasoningVariant = (variant: WantaReasoningVariant, checked: boolean): void => {
    setReasoningVariants((current) =>
      checked ? [...new Set([...current, variant])] : current.filter((item) => item !== variant),
    )
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("chat.modelAddTitle")}
      description={t("chat.modelAddDescription")}
      closeLabel={t("common.cancel")}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!canSave || saving}
            onClick={() => {
              setSaving(true)
              void onSave({
                providerId,
                providerName: providerDisplayName(provider, t),
                baseUrl,
                apiKey,
                modelName,
                supportsImages,
                supportsToolCalls,
                contextWindow: optionalTokenLimit(contextWindow),
                inputTokenLimit: optionalTokenLimit(inputTokenLimit),
                maxOutputTokens: optionalTokenLimit(maxOutputTokens),
                reasoningVariants,
              })
                .catch(() => undefined)
                .finally(() => setSaving(false))
            }}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label>{t("chat.modelProvider")}</Label>
          <Select value={providerId} onValueChange={handleProviderChange}>
            <SelectTrigger className={modelDialogControlClass}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="w-[var(--radix-select-trigger-width)]">
              {providers.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {providerDisplayName(item, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {apiPlans.length > 0 ? (
          <div className="grid gap-1.5">
            <Label>{t("chat.modelApiPlan")}</Label>
            <ToggleGroup
              type="single"
              value={apiPlanId}
              onValueChange={handleApiPlanChange}
              variant="outline"
              className="w-full"
              aria-label={t("chat.modelApiPlan")}
            >
              {apiPlans.map((plan) => (
                <ToggleGroupItem key={plan.id} value={plan.id} className="flex-1">
                  {apiPlanLabel(plan.id, t)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        ) : null}

        {apiRegions.length > 0 ? (
          <div className="grid gap-1.5">
            <Label>{t("chat.modelApiRegion")}</Label>
            <ToggleGroup
              type="single"
              value={apiRegionId}
              onValueChange={handleApiRegionChange}
              variant="outline"
              className="w-full"
              aria-label={t("chat.modelApiRegion")}
            >
              {apiRegions.map((region) => (
                <ToggleGroupItem key={region.id} value={region.id} className="flex-1">
                  {apiRegionLabel(region.id, t)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        ) : null}

        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label>{t("chat.modelBaseUrl")}</Label>
            {provider?.documentationUrl ? (
              <a
                href={provider.documentationUrl}
                target="_blank"
                rel="noreferrer"
                className="oo-text-caption-compact inline-flex items-center gap-1 font-normal text-primary hover:underline"
              >
                {t("chat.modelDocs")}
                <ExternalLink className="size-3" />
              </a>
            ) : null}
          </div>
          <Input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={t("chat.modelBaseUrlPlaceholder")}
            readOnly={!provider?.requiresBaseUrl}
            className={modelDialogControlClass}
          />
        </div>

        <div className="grid gap-1.5">
          <Label>{t("chat.modelApiKey")}</Label>
          <Input
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            type="password"
            placeholder="sk-..."
            autoComplete="off"
            className={modelDialogControlClass}
          />
        </div>

        <div className="grid gap-1.5">
          <Label>{t("chat.modelName")}</Label>
          {modelOptions.length > 0 ? (
            <Select value={modelName} onValueChange={handleModelChange}>
              <SelectTrigger className={modelDialogControlClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="w-[var(--radix-select-trigger-width)]">
                {modelOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.displayName ?? option.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={modelName}
              onChange={(event) => setModelName(event.target.value)}
              placeholder="openai/gpt-5.5"
              className={modelDialogControlClass}
            />
          )}
        </div>

        <div className="rounded-md border border-border/70 px-3 py-2.5">
          <label htmlFor={supportsImagesId} className="flex cursor-pointer items-start gap-3">
            <input
              id={supportsImagesId}
              type="checkbox"
              checked={supportsImages}
              onChange={(event) => setSupportsImages(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <span className="grid gap-1">
              <span className="oo-text-label">{t("chat.modelSupportsImages")}</span>
              <span className="oo-text-caption text-muted-foreground">{t("chat.modelSupportsImagesDescription")}</span>
            </span>
          </label>
        </div>

        <div className="rounded-md border border-border/70 px-3 py-2.5">
          <label htmlFor={supportsToolCallsId} className="flex cursor-pointer items-start gap-3">
            <input
              id={supportsToolCallsId}
              type="checkbox"
              checked={supportsToolCalls}
              onChange={(event) => setSupportsToolCalls(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <span className="grid gap-1">
              <span className="oo-text-label">{t("chat.modelSupportsToolCalls")}</span>
              <span className="oo-text-caption text-muted-foreground">
                {t("chat.modelSupportsToolCallsDescription")}
              </span>
            </span>
          </label>
        </div>

        <div className="grid gap-2 rounded-md border border-border/70 px-3 py-2.5">
          <div className="grid gap-1">
            <span className="oo-text-label">{t("chat.modelTokenLimits")}</span>
            <span className="oo-text-caption text-muted-foreground">{t("chat.modelTokenLimitsDescription")}</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor={contextWindowId}>{t("chat.modelContextWindow")}</Label>
              <Input
                id={contextWindowId}
                value={contextWindow}
                onChange={(event) => setContextWindow(event.target.value)}
                inputMode="numeric"
                placeholder={t("chat.modelOptionalTokenPlaceholder")}
                className={modelDialogControlClass}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={inputTokenLimitId}>{t("chat.modelInputTokenLimit")}</Label>
              <Input
                id={inputTokenLimitId}
                value={inputTokenLimit}
                onChange={(event) => setInputTokenLimit(event.target.value)}
                inputMode="numeric"
                placeholder={t("chat.modelOptionalTokenPlaceholder")}
                className={modelDialogControlClass}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={maxOutputTokensId}>{t("chat.modelMaxOutputTokens")}</Label>
              <Input
                id={maxOutputTokensId}
                value={maxOutputTokens}
                onChange={(event) => setMaxOutputTokens(event.target.value)}
                inputMode="numeric"
                placeholder={t("chat.modelOptionalTokenPlaceholder")}
                className={modelDialogControlClass}
              />
            </div>
          </div>
        </div>

        <div className="grid gap-2 rounded-md border border-border/70 px-3 py-2.5">
          <div className="grid gap-1">
            <span className="oo-text-label">{t("chat.modelReasoningVariants")}</span>
            <span className="oo-text-caption text-muted-foreground">{t("chat.modelReasoningVariantsDescription")}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {WANTA_REASONING_VARIANT_LEVELS.map((variant) => (
              <label key={variant} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={reasoningVariants.includes(variant)}
                  onChange={(event) => toggleReasoningVariant(variant, event.target.checked)}
                  className="size-4 shrink-0 accent-primary"
                />
                <span>{reasoningLevelLabel(variant, t)}</span>
              </label>
            ))}
          </div>
        </div>

        {error ? <ErrorNotice error={error} compact /> : null}
      </div>
    </Dialog>
  )
}
