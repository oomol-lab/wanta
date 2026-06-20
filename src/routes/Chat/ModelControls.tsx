import type {
  CustomModelApiPlan,
  CustomModelProvider,
  ModelCatalog,
  ModelChoice,
  SaveCustomModelRequest,
} from "../../../electron/models/common.ts"
import type { UserFacingError } from "@/lib/user-facing-error"

import { Brain, ChevronDown, ExternalLink, ImageIcon, Settings2, Trash2 } from "lucide-react"
import * as React from "react"
import { createPortal } from "react-dom"
import { DEFAULT_BUILTIN_MODEL_ID, resolveBuiltinModel } from "../../../electron/models/builtin.ts"
import { ErrorNotice } from "@/components/ErrorNotice"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

function sameModelChoice(a: ModelChoice | undefined, b: ModelChoice | undefined): boolean {
  return Boolean(a && b && a.kind === b.kind && a.id === b.id)
}

function selectedModelSummary(catalog: ModelCatalog | null): { label: string; supportsImages: boolean } {
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

function providerInitial(name: string): string {
  return (name.trim()[0] ?? "M").toUpperCase()
}

function ProviderMark({ name }: { name: string }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-medium text-muted-foreground">
      {providerInitial(name)}
    </span>
  )
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function ModelRow({
  active,
  icon,
  title,
  supportsImages,
  visionLabel,
  deleteLabel,
  onSelect,
  onDelete,
}: {
  active: boolean
  icon: React.ReactNode
  title: string
  supportsImages?: boolean
  visionLabel: string
  deleteLabel?: string
  onSelect: () => void
  onDelete?: () => void
}) {
  return (
    <div className="group flex min-w-0 items-center gap-1">
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        className={cn(
          "flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground",
          active && "bg-accent font-medium text-accent-foreground",
        )}
        title={title}
        onClick={onSelect}
      >
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm leading-none">{title}</span>
        </span>
        <span className="flex shrink-0 justify-end">
          {supportsImages ? (
            <Badge
              variant="outline"
              className="h-5 rounded-md px-1.5 py-0 text-[10px] font-medium"
              title={visionLabel}
              aria-label={visionLabel}
            >
              <ImageIcon className="size-3" />
              <span>{visionLabel}</span>
            </Badge>
          ) : null}
        </span>
      </button>
      {onDelete ? (
        <button
          type="button"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100"
          aria-label={deleteLabel}
          onClick={(event) => {
            event.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}

export function ModelPicker({
  catalog,
  disabled,
  onSelect,
  onDelete,
  onAdd,
}: {
  catalog: ModelCatalog | null
  disabled: boolean
  onSelect: (choice: ModelChoice) => void
  onDelete: (id: string) => void
  onAdd: () => void
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties>({})
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const menuRef = React.useRef<HTMLDivElement | null>(null)
  const selected = selectedModelSummary(catalog)
  const selectedTitle = selected.supportsImages ? `${selected.label} · ${t("chat.modelVision")}` : selected.label

  const updateMenuPosition = React.useCallback(() => {
    const anchor = rootRef.current
    if (!anchor) {
      return
    }
    const rect = anchor.getBoundingClientRect()
    const margin = 16
    const gap = 8
    const width = Math.min(320, window.innerWidth - margin * 2)
    const left = clampNumber(rect.right - width, margin, window.innerWidth - width - margin)
    const bottom = Math.max(margin, window.innerHeight - rect.top + gap)
    const maxHeight = Math.max(180, rect.top - margin - gap)
    setMenuStyle({ left, bottom, width, maxHeight })
  }, [])

  React.useLayoutEffect(() => {
    if (open) {
      updateMenuPosition()
    }
  }, [open, updateMenuPosition])

  React.useEffect(() => {
    if (!open) {
      return
    }
    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false)
      }
    }
    const onReposition = (): void => updateMenuPosition()
    document.addEventListener("mousedown", onMouseDown)
    document.addEventListener("keydown", onKeyDown)
    window.addEventListener("resize", onReposition)
    window.addEventListener("scroll", onReposition, true)
    return () => {
      document.removeEventListener("mousedown", onMouseDown)
      document.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("resize", onReposition)
      window.removeEventListener("scroll", onReposition, true)
    }
  }, [open, updateMenuPosition])

  const menu = open
    ? createPortal(
        <div
          ref={menuRef}
          style={menuStyle}
          className="oo-border-divider fixed z-50 overflow-y-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl"
        >
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t("chat.modelBuiltIn")}</div>
          {catalog?.builtins.map((model) => {
            const choice: ModelChoice = { kind: "builtin", id: model.id }
            return (
              <ModelRow
                key={model.id}
                active={sameModelChoice(catalog.selected, choice)}
                icon={<Brain className="size-4 shrink-0 text-muted-foreground" />}
                title={model.displayName}
                supportsImages={model.supportsImages}
                visionLabel={t("chat.modelVision")}
                onSelect={() => {
                  onSelect(choice)
                  setOpen(false)
                }}
              />
            )
          }) ?? (
            <ModelRow
              active
              icon={<Brain className="size-4 shrink-0 text-muted-foreground" />}
              title="Auto"
              visionLabel={t("chat.modelVision")}
              onSelect={() => setOpen(false)}
            />
          )}

          {catalog && catalog.customModels.length > 0 ? (
            <div className="oo-border-divider mt-1 border-t pt-1">
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t("chat.modelCustom")}</div>
              {catalog.customModels.map((model) => {
                const choice: ModelChoice = { kind: "custom", id: model.id }
                return (
                  <ModelRow
                    key={model.id}
                    active={sameModelChoice(catalog.selected, choice)}
                    icon={<ProviderMark name={model.providerName} />}
                    title={model.displayName}
                    supportsImages={model.supportsImages}
                    visionLabel={t("chat.modelVision")}
                    deleteLabel={t("chat.modelDelete")}
                    onSelect={() => {
                      onSelect(choice)
                      setOpen(false)
                    }}
                    onDelete={() => onDelete(model.id)}
                  />
                )
              })}
            </div>
          ) : null}

          <div className="oo-border-divider mt-1 border-t pt-1">
            <button
              type="button"
              className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                setOpen(false)
                onAdd()
              }}
            >
              <Settings2 className="size-4 text-muted-foreground" />
              <span>{t("chat.modelAdd")}</span>
            </button>
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <div ref={rootRef}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        title={selectedTitle}
        aria-label={t("chat.modelPicker")}
        aria-expanded={open}
        disabled={disabled}
        className="h-8 max-w-44 rounded-full px-2"
        onClick={() => setOpen((value) => !value)}
      >
        <Brain className="size-4" />
        <span className="min-w-0 truncate">{selected.label}</span>
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </Button>
      {menu}
    </div>
  )
}

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
  const [saving, setSaving] = React.useState(false)
  const supportsImagesId = React.useId()
  const provider = providers.find((item) => item.id === providerId)
  const modelOptions = provider?.modelOptions ?? []
  const apiPlans = provider?.apiPlans ?? []
  const apiEndpoint = providerEndpoint(provider, apiPlanId)
  const apiRegions = apiEndpoint?.apiRegions ?? []

  React.useEffect(() => {
    if (open) {
      const initial = providers[0]
      setProviderId(initial?.id ?? "custom")
      setBaseUrl(providerBaseUrl(initial))
      const initialModelName = providerDefaultModelName(initial)
      setModelName(initialModelName)
      setApiPlanId(providerDefaultApiPlanId(initial))
      setApiRegionId(endpointDefaultApiRegionId(providerEndpoint(initial)))
      setSupportsImages(providerDefaultSupportsImages(initial, initialModelName))
      setApiKey("")
      setSaving(false)
    }
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
  }

  const handleModelChange = (nextModelName: string): void => {
    setModelName(nextModelName)
    setSupportsImages(providerDefaultSupportsImages(provider, nextModelName))
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
                className="inline-flex items-center gap-1 text-xs font-normal text-primary hover:underline"
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
              <span className="text-sm font-medium">{t("chat.modelSupportsImages")}</span>
              <span className="oo-text-caption text-muted-foreground">{t("chat.modelSupportsImagesDescription")}</span>
            </span>
          </label>
        </div>

        {error ? <ErrorNotice error={error} compact /> : null}
      </div>
    </Dialog>
  )
}
