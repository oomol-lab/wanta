import type {
  CustomModelProvider,
  ModelCatalog,
  ModelChoice,
  SaveCustomModelRequest,
} from "../../../electron/models/common.ts"

import { BrainCircuit, CheckCircle2, ChevronDown, ExternalLink, Settings2, Trash2 } from "lucide-react"
import * as React from "react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

function sameModelChoice(a: ModelChoice | undefined, b: ModelChoice | undefined): boolean {
  return Boolean(a && b && a.kind === b.kind && a.id === b.id)
}

function selectedModelSummary(catalog: ModelCatalog | null): { label: string } {
  if (!catalog) {
    return { label: "Auto" }
  }
  const selected = catalog.selected
  if (selected.kind === "custom") {
    const custom = catalog.customModels.find((model) => model.id === selected.id)
    if (custom) {
      return { label: custom.modelName }
    }
  }
  const builtin =
    (selected.kind === "builtin" ? catalog.builtins.find((model) => model.id === selected.id) : undefined) ??
    catalog.builtins.find((model) => model.id === "oopilot") ??
    catalog.builtins[0]
  return { label: builtin?.displayName ?? "Auto" }
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
  subtitle,
  deleteLabel,
  onSelect,
  onDelete,
}: {
  active: boolean
  icon: React.ReactNode
  title: string
  subtitle?: string
  deleteLabel?: string
  onSelect: () => void
  onDelete?: () => void
}) {
  return (
    <div className="group flex min-w-0 items-center gap-1">
      <button
        type="button"
        className={cn(
          "flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left hover:bg-accent hover:text-accent-foreground",
          active && "bg-accent text-accent-foreground",
        )}
        onClick={onSelect}
      >
        {icon}
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-sm", subtitle ? "leading-5" : "leading-none")}>{title}</span>
          {subtitle ? <span className="block truncate text-xs leading-4 text-muted-foreground">{subtitle}</span> : null}
        </span>
        {active ? <CheckCircle2 className="size-3.5 shrink-0 text-green-600" /> : null}
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
                icon={<BrainCircuit className="size-4 shrink-0 text-muted-foreground" />}
                title={model.displayName}
                onSelect={() => {
                  onSelect(choice)
                  setOpen(false)
                }}
              />
            )
          }) ?? (
            <ModelRow
              active
              icon={<BrainCircuit className="size-4 shrink-0 text-muted-foreground" />}
              title="Auto"
              onSelect={() => setOpen(false)}
            />
          )}

          {catalog && catalog.customModels.length > 0 ? (
            <>
              <div className="mt-1 px-2 py-1.5 text-xs font-medium text-muted-foreground">{t("chat.modelCustom")}</div>
              {catalog.customModels.map((model) => {
                const choice: ModelChoice = { kind: "custom", id: model.id }
                return (
                  <ModelRow
                    key={model.id}
                    active={sameModelChoice(catalog.selected, choice)}
                    icon={<ProviderMark name={model.providerName} />}
                    title={model.modelName}
                    subtitle={
                      model.supportsImages ? `${model.providerName} / ${t("chat.modelVision")}` : model.providerName
                    }
                    deleteLabel={t("chat.modelDelete")}
                    onSelect={() => {
                      onSelect(choice)
                      setOpen(false)
                    }}
                    onDelete={() => onDelete(model.id)}
                  />
                )
              })}
            </>
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
        title={t("chat.modelPicker")}
        aria-label={t("chat.modelPicker")}
        aria-expanded={open}
        disabled={disabled}
        className="h-8 max-w-40 rounded-full px-2"
        onClick={() => setOpen((value) => !value)}
      >
        <BrainCircuit className="size-4" />
        <span className="min-w-0 truncate">{selected.label}</span>
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </Button>
      {menu}
    </div>
  )
}

function providerBaseUrl(provider: CustomModelProvider | undefined): string {
  return provider?.baseUrl ?? ""
}

export function AddCustomModelDialog({
  open,
  providers,
  error,
  onClose,
  onSave,
}: {
  open: boolean
  providers: CustomModelProvider[]
  error: string | null
  onClose: () => void
  onSave: (req: SaveCustomModelRequest) => Promise<void>
}) {
  const t = useT()
  const firstProvider = providers[0]
  const [providerId, setProviderId] = React.useState(firstProvider?.id ?? "custom")
  const [baseUrl, setBaseUrl] = React.useState(providerBaseUrl(firstProvider))
  const [apiKey, setApiKey] = React.useState("")
  const [modelName, setModelName] = React.useState("")
  const [supportsImages, setSupportsImages] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const supportsImagesId = React.useId()
  const provider = providers.find((item) => item.id === providerId)

  React.useEffect(() => {
    if (open) {
      const initial = providers[0]
      setProviderId(initial?.id ?? "custom")
      setBaseUrl(providerBaseUrl(initial))
      setApiKey("")
      setModelName("")
      setSupportsImages(false)
      setSaving(false)
    }
  }, [open, providers])

  const handleProviderChange = (nextId: string): void => {
    const next = providers.find((item) => item.id === nextId)
    setProviderId(nextId)
    setBaseUrl(providerBaseUrl(next))
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
                providerName: provider?.displayName,
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
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {providers.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

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
            placeholder="https://api.example.com/v1"
            readOnly={!provider?.requiresBaseUrl}
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
          />
        </div>

        <div className="grid gap-1.5">
          <Label>{t("chat.modelName")}</Label>
          <Input value={modelName} onChange={(event) => setModelName(event.target.value)} placeholder="deepseek-chat" />
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

        {error ? <div className="oo-error flex items-center gap-2">{error}</div> : null}
      </div>
    </Dialog>
  )
}
