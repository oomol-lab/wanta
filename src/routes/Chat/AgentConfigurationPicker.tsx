import type { AgentKind } from "../../../electron/agent/contract/profile.ts"
import type { ExternalAgentCatalog, ExternalAgentRuntimeStatus } from "../../../electron/agent/external/status.ts"
import type { ReasoningLevel } from "../../../electron/chat/common.ts"
import type { ModelCatalog, ModelChoice } from "../../../electron/models/common.ts"

import { Brain, Check, ChevronDown, ChevronRight, Settings2, Trash2 } from "lucide-react"
import * as React from "react"
import { createPortal } from "react-dom"
import {
  AGENT_OPTION_DEFAULT_ROW_ID,
  agentPickerTriggerLabel,
  buildAgentOptionRows,
  buildAgentPickerRows,
  normalizeAgentOptionValue,
} from "./agent-control-options.ts"
import { buildModelMenuItems, selectedModelSummary } from "./model-control-options.ts"
import { reasoningLevelLabel } from "./model-control-utils.ts"
import { selectedModelReasoningLevels } from "./model-reasoning-levels.ts"
import { useComposerMenu } from "./useComposerMenu.ts"
import { AgentIcon } from "@/components/AgentIcon"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

type ConfigurationPage = "root" | "agent" | "model" | "effort"

function ConfigurationRow({
  disabled = false,
  expanded = false,
  label,
  value,
  onClick,
  onFocus,
  onMouseEnter,
}: {
  disabled?: boolean
  expanded?: boolean
  label: string
  value: string
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
  onFocus?: (event: React.FocusEvent<HTMLButtonElement>) => void
  onMouseEnter?: (event: React.MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-expanded={expanded}
      aria-haspopup="menu"
      disabled={disabled || !onClick}
      className="flex min-h-10 w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-accent hover:text-accent-foreground disabled:cursor-default disabled:opacity-70 disabled:hover:bg-transparent"
      onClick={onClick}
      onFocus={onFocus}
      onMouseEnter={onMouseEnter}
    >
      <span className="oo-text-label shrink-0 text-muted-foreground">{label}</span>
      <span className="oo-text-label min-w-0 flex-1 truncate text-right text-foreground">{value}</span>
      {onClick && !disabled ? <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" /> : null}
    </button>
  )
}

function SelectionRow({
  active,
  description,
  disabled = false,
  icon,
  inlineMeta,
  label,
  onClick,
  title,
  trailingAction,
}: {
  active: boolean
  description?: string
  disabled?: boolean
  icon: React.ReactNode
  inlineMeta?: string
  label: string
  onClick: () => void
  title?: string
  trailingAction?: {
    label: string
    onClick: () => void
  }
}) {
  return (
    <div
      className={cn(
        "flex min-h-10 w-full min-w-0 items-stretch rounded-md hover:bg-accent hover:text-accent-foreground",
        disabled && "opacity-50 hover:bg-transparent",
      )}
    >
      <button
        type="button"
        role="menuitemradio"
        aria-checked={active}
        disabled={disabled}
        title={title}
        className={cn(
          "flex min-w-0 flex-1 gap-2 px-2 py-2 text-left",
          inlineMeta ? "items-center" : "items-start",
          active && "font-medium",
        )}
        onClick={onClick}
      >
        {icon}
        {inlineMeta ? (
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="oo-text-label shrink-0 truncate">{label}</span>
            <span className="oo-text-caption min-w-0 truncate text-muted-foreground">{inlineMeta}</span>
          </span>
        ) : (
          <span className="min-w-0 flex-1">
            <span className="oo-text-label block truncate">{label}</span>
            {description ? (
              <span className="oo-text-caption mt-0.5 block truncate text-muted-foreground">{description}</span>
            ) : null}
          </span>
        )}
        {active ? (
          <Check className={cn("size-4 shrink-0", !inlineMeta && "mt-0.5")} />
        ) : (
          <span className="size-4 shrink-0" />
        )}
      </button>
      {trailingAction ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="my-1 mr-1 size-8 shrink-0"
          aria-label={trailingAction.label}
          onClick={trailingAction.onClick}
        >
          <Trash2 className="size-3.5" />
        </Button>
      ) : null}
    </div>
  )
}

function agentOptionSelection(
  options: ExternalAgentCatalog["models"],
  defaultOptionId: string | undefined,
  value: string | undefined,
  defaultLabel: string,
  defaultDescription: string,
) {
  const rows = buildAgentOptionRows(options, defaultOptionId, { defaultDescription, defaultLabel })
  const normalizedValue = normalizeAgentOptionValue(value, defaultOptionId)
  const selectedId = normalizedValue ?? AGENT_OPTION_DEFAULT_ROW_ID
  return {
    rows,
    selectedId,
    selectedLabel: rows.find((row) => row.id === selectedId)?.label ?? defaultLabel,
  }
}

export function AgentConfigurationPicker({
  agentCatalog,
  agentEffortId,
  agentEffortSelectionEnabled,
  agentKind,
  agentModelId,
  agentModelSelectionEnabled,
  composerDisabled,
  externalAgents,
  modelCatalog,
  modelRequired,
  modelRoutingEnabled,
  reasoningLevel,
  onAddModel,
  onAgentPickerOpen,
  onDeleteModel,
  onSelectAgentEffort,
  onSelectAgentKind,
  onSelectAgentModel,
  onSelectModel,
  onSelectReasoningLevel,
}: {
  agentCatalog?: ExternalAgentCatalog
  agentEffortId?: string
  agentEffortSelectionEnabled: boolean
  agentKind: AgentKind
  agentModelId?: string
  agentModelSelectionEnabled: boolean
  composerDisabled: boolean
  externalAgents: ExternalAgentRuntimeStatus[]
  modelCatalog: ModelCatalog | null
  modelRequired: boolean
  modelRoutingEnabled: boolean
  reasoningLevel: ReasoningLevel
  onAddModel: () => void
  onAgentPickerOpen?: () => void
  onDeleteModel: (id: string) => void
  onSelectAgentEffort?: (effortId?: string) => void
  onSelectAgentKind?: (kind: AgentKind) => void
  onSelectAgentModel?: (modelId?: string) => void
  onSelectModel: (choice: ModelChoice) => void
  onSelectReasoningLevel: (level: ReasoningLevel) => void
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [page, setPage] = React.useState<ConfigurationPage>("root")
  const [submenuStyle, setSubmenuStyle] = React.useState<React.CSSProperties>({})
  const submenuRef = React.useRef<HTMLDivElement | null>(null)
  const submenuAnchorRef = React.useRef<HTMLButtonElement | null>(null)
  const additionalMenuRefs = React.useMemo(() => [submenuRef], [])
  const { closeMenu, handleTriggerKeyDown, menuRef, menuStyle, rootRef, toggleMenu, triggerRef } = useComposerMenu({
    additionalOutsideRefs: additionalMenuRefs,
    align: "right",
    disabled: composerDisabled,
    minHeight: 180,
    onClose: () => setPage("root"),
    open,
    setOpen,
    width: 320,
  })

  const positionSubmenu = React.useCallback((anchor: HTMLButtonElement): void => {
    const rect = anchor.getBoundingClientRect()
    const width = 320
    const gap = 8
    const margin = 16
    const menuWidth = Math.min(width, window.innerWidth - margin * 2)
    const submenuHeight = submenuRef.current?.getBoundingClientRect().height ?? 0
    const maxTop = Math.max(margin, window.innerHeight - margin - submenuHeight)
    const opensRight = rect.right + gap + menuWidth <= window.innerWidth - margin
    setSubmenuStyle({
      left: opensRight ? rect.right + gap : Math.max(margin, rect.left - gap - menuWidth),
      top: Math.min(Math.max(margin, rect.top), maxTop),
      width: menuWidth,
      maxHeight: window.innerHeight - margin * 2,
    })
  }, [])

  const openSubmenu = React.useCallback(
    (nextPage: Exclude<ConfigurationPage, "root">, anchor: HTMLButtonElement): void => {
      submenuAnchorRef.current = anchor
      positionSubmenu(anchor)
      setPage(nextPage)
    },
    [positionSubmenu],
  )

  React.useLayoutEffect(() => {
    if (page !== "root" && submenuAnchorRef.current) {
      positionSubmenu(submenuAnchorRef.current)
    }
  }, [page, positionSubmenu])

  React.useEffect(() => {
    if (page === "root") {
      return
    }
    const reposition = (): void => {
      if (submenuAnchorRef.current) {
        positionSubmenu(submenuAnchorRef.current)
      }
    }
    window.addEventListener("resize", reposition)
    window.addEventListener("scroll", reposition, true)
    return () => {
      window.removeEventListener("resize", reposition)
      window.removeEventListener("scroll", reposition, true)
    }
  }, [page, positionSubmenu])

  const agentRows = React.useMemo(
    () =>
      buildAgentPickerRows(externalAgents, {
        builtIn: t("chat.agentOpenCode"),
        builtInVersion: __OPENCODE_VERSION__,
        loginRequired: (hint) => t("chat.agentLoginRequired", { hint }),
        notDetected: t("chat.agentNotDetected"),
      }),
    [externalAgents, t],
  )
  const selectedAgentLabel = agentPickerTriggerLabel(agentKind, t("chat.agentOpenCode"))
  const wantaModelItems = React.useMemo(() => buildModelMenuItems(modelCatalog, t("chat.modelAdd")), [modelCatalog, t])
  const wantaModel = selectedModelSummary(modelCatalog)
  const wantaReasoningLevels = React.useMemo(() => selectedModelReasoningLevels(modelCatalog), [modelCatalog])
  const effectiveReasoningLevel = wantaReasoningLevels.includes(reasoningLevel) ? reasoningLevel : "default"
  const wantaReasoningLabel = reasoningLevelLabel(effectiveReasoningLevel, t)
  const externalModels = agentOptionSelection(
    agentCatalog?.models ?? [],
    agentCatalog?.defaultModelId,
    agentModelId,
    t("chat.agentOptionDefault"),
    t("chat.agentOptionDefaultDescription"),
  )
  const externalEfforts = agentOptionSelection(
    agentCatalog?.efforts ?? [],
    agentCatalog?.defaultEffortId,
    agentEffortId,
    t("chat.agentOptionDefault"),
    t("chat.agentOptionDefaultDescription"),
  )
  const modelLabel = modelRoutingEnabled
    ? modelRequired
      ? t("chat.modelSelectOrConfigure")
      : wantaModel.label
    : externalModels.selectedLabel
  const effortLabel = modelRoutingEnabled ? wantaReasoningLabel : externalEfforts.selectedLabel
  const modelVisible = modelRoutingEnabled || agentModelSelectionEnabled
  const effortVisible = modelRoutingEnabled ? wantaReasoningLevels.length > 0 : agentEffortSelectionEnabled
  const triggerParts = modelRoutingEnabled
    ? [modelLabel, effortLabel]
    : agentModelSelectionEnabled
      ? [modelLabel, effortVisible && agentEffortId ? effortLabel : null, selectedAgentLabel]
      : [selectedAgentLabel, effortVisible && agentEffortId ? effortLabel : null]
  const triggerLabel = triggerParts.filter(Boolean).join(" · ") || selectedAgentLabel

  const onOpenRef = React.useRef(onAgentPickerOpen)
  React.useEffect(() => {
    onOpenRef.current = onAgentPickerOpen
  }, [onAgentPickerOpen])
  React.useEffect(() => {
    if (open) {
      onOpenRef.current?.()
    }
  }, [open])

  const selectWantaModel = React.useCallback(
    (choice: ModelChoice): void => {
      const nextLevels = selectedModelReasoningLevels(
        modelCatalog ? { ...modelCatalog, selected: choice } : modelCatalog,
      )
      if (!nextLevels.includes(reasoningLevel)) {
        onSelectReasoningLevel("default")
      }
      onSelectModel(choice)
      closeMenu(false)
    },
    [closeMenu, modelCatalog, onSelectModel, onSelectReasoningLevel, reasoningLevel],
  )

  const submenuContent = (() => {
    if (page === "agent") {
      return (
        <>
          {agentRows.map((row) => (
            <SelectionRow
              key={row.kind}
              active={row.kind === agentKind}
              disabled={!row.selectable}
              icon={
                <AgentIcon
                  host={row.kind}
                  className="size-5 border-0 bg-transparent [&_.oo-entity-icon-image]:size-5"
                />
              }
              inlineMeta={[row.sublabel, row.hint].filter(Boolean).join(" · ")}
              label={row.label}
              title={[row.label, row.sublabel, row.hint, row.title].filter(Boolean).join(" · ")}
              onClick={() => {
                if (row.kind !== agentKind) {
                  onSelectAgentKind?.(row.kind)
                }
                closeMenu(false)
              }}
            />
          ))}
        </>
      )
    }
    if (page === "model") {
      return (
        <>
          {modelRoutingEnabled
            ? wantaModelItems.map((item) =>
                item.kind === "add" ? (
                  <SelectionRow
                    key={item.id}
                    active={false}
                    icon={<Settings2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                    label={item.title}
                    onClick={() => {
                      closeMenu(false)
                      onAddModel()
                    }}
                  />
                ) : (
                  <SelectionRow
                    key={item.id}
                    active={item.active}
                    icon={<Brain className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                    label={item.title}
                    onClick={() => selectWantaModel(item.choice)}
                    trailingAction={
                      item.kind === "custom"
                        ? { label: t("chat.modelDelete"), onClick: () => onDeleteModel(item.modelId) }
                        : undefined
                    }
                  />
                ),
              )
            : externalModels.rows.map((row) => (
                <SelectionRow
                  key={row.id}
                  active={row.id === externalModels.selectedId}
                  description={row.description}
                  icon={<Brain className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                  label={row.label}
                  onClick={() => {
                    onSelectAgentModel?.(row.id === AGENT_OPTION_DEFAULT_ROW_ID ? undefined : row.id)
                    closeMenu(false)
                  }}
                />
              ))}
        </>
      )
    }
    if (page === "effort") {
      return (
        <>
          {modelRoutingEnabled
            ? wantaReasoningLevels.map((level) => (
                <SelectionRow
                  key={level}
                  active={level === effectiveReasoningLevel}
                  icon={<Brain className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                  label={reasoningLevelLabel(level, t)}
                  onClick={() => {
                    onSelectReasoningLevel(level)
                    closeMenu(false)
                  }}
                />
              ))
            : externalEfforts.rows.map((row) => (
                <SelectionRow
                  key={row.id}
                  active={row.id === externalEfforts.selectedId}
                  description={row.description}
                  icon={<Brain className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                  label={row.label}
                  onClick={() => {
                    onSelectAgentEffort?.(row.id === AGENT_OPTION_DEFAULT_ROW_ID ? undefined : row.id)
                    closeMenu(false)
                  }}
                />
              ))}
        </>
      )
    }
    return null
  })()

  const menuContent = (
    <>
      <div className="oo-text-caption-compact px-2 py-1.5 font-medium text-muted-foreground">
        {t("chat.agentConfiguration")}
      </div>
      {modelVisible ? (
        <ConfigurationRow
          expanded={page === "model"}
          label={t("chat.modelSection")}
          value={modelLabel}
          onClick={(event) => openSubmenu("model", event.currentTarget)}
          onFocus={(event) => openSubmenu("model", event.currentTarget)}
          onMouseEnter={(event) => openSubmenu("model", event.currentTarget)}
        />
      ) : null}
      {effortVisible ? (
        <ConfigurationRow
          expanded={page === "effort"}
          label={modelRoutingEnabled ? t("chat.reasoningSection") : t("chat.agentEffortPicker")}
          value={effortLabel}
          onClick={(event) => openSubmenu("effort", event.currentTarget)}
          onFocus={(event) => openSubmenu("effort", event.currentTarget)}
          onMouseEnter={(event) => openSubmenu("effort", event.currentTarget)}
        />
      ) : null}
      <div className="oo-border-divider mt-1 border-t pt-1">
        <ConfigurationRow
          expanded={page === "agent"}
          label={t("chat.agentPickerLabel")}
          value={selectedAgentLabel}
          onClick={(event) => openSubmenu("agent", event.currentTarget)}
          onFocus={(event) => openSubmenu("agent", event.currentTarget)}
          onMouseEnter={(event) => openSubmenu("agent", event.currentTarget)}
        />
      </div>
    </>
  )

  const menu = open
    ? createPortal(
        <>
          <div
            ref={menuRef}
            style={menuStyle}
            role="menu"
            aria-label={t("chat.agentConfiguration")}
            className="oo-border-divider fixed z-50 overflow-y-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl"
          >
            {menuContent}
          </div>
          {page !== "root" ? (
            <div
              ref={submenuRef}
              style={submenuStyle}
              role="menu"
              aria-label={
                page === "agent"
                  ? t("chat.agentPickerLabel")
                  : page === "model"
                    ? t("chat.modelSection")
                    : modelRoutingEnabled
                      ? t("chat.reasoningSection")
                      : t("chat.agentEffortPicker")
              }
              className="oo-border-divider fixed z-50 overflow-y-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl"
            >
              {submenuContent}
            </div>
          ) : null}
        </>,
        document.body,
      )
    : null

  return (
    <div ref={rootRef} className="max-w-full min-w-0 shrink">
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="sm"
        title={`${t("chat.agentConfiguration")} · ${triggerLabel}`}
        aria-label={t("chat.agentConfiguration")}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={composerDisabled}
        className="oo-composer-model-button h-8 max-w-[15rem] min-w-0 shrink rounded-full px-2"
        onClick={toggleMenu}
        onKeyDown={handleTriggerKeyDown}
      >
        <Brain className="size-4 shrink-0" />
        <span className="oo-composer-model-text min-w-0 flex-1 truncate text-left">{triggerLabel}</span>
        <ChevronDown
          className={cn("oo-composer-control-chevron size-3.5 shrink-0 transition-transform", open && "rotate-180")}
        />
      </Button>
      {menu}
    </div>
  )
}
