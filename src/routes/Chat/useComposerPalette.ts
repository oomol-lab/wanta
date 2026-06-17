import type { ChatContextMention } from "../../../electron/chat/common.ts"
import type {
  ChatComposerPaletteItem,
  ConnectionPaletteItem,
  SkillPaletteItem,
  SlashCommandPaletteItem,
} from "./composer-palette-items.ts"
import type { ComposerAction, PaletteMode } from "./composer-state.ts"
import type { ComposerTrigger } from "./composer-triggers.ts"

import * as React from "react"
import { matchesComposerQuery } from "./composer-palette-items.ts"
import { initialPaletteMode, resolveComposerPaletteKeyAction } from "./composer-palette-logic.ts"
import { detectComposerTrigger } from "./composer-triggers.ts"

interface UseComposerPaletteOptions {
  activePaletteIndex: number
  connectionItems: ConnectionPaletteItem[]
  disabled: boolean
  dismissedTriggerKey: string | null
  dispatch: React.Dispatch<ComposerAction>
  draft: string
  draftSelection: { end: number; start: number }
  focusDraftAt: (index: number) => void
  onAddContextMention: (mention: ChatContextMention) => void
  onViewBilling?: () => void
  paletteMode: PaletteMode
  skillItems: SkillPaletteItem[]
  slashItems: SlashCommandPaletteItem[]
}

export interface UseComposerPaletteResult {
  activeItem: ChatComposerPaletteItem | undefined
  activeTrigger: ComposerTrigger | null
  handleBack: (() => void) | undefined
  handleKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
  items: ChatComposerPaletteItem[]
  onSelect: (item: ChatComposerPaletteItem | undefined) => void
  open: boolean
}

export function useComposerPalette({
  activePaletteIndex,
  connectionItems,
  disabled,
  dismissedTriggerKey,
  dispatch,
  draft,
  draftSelection,
  focusDraftAt,
  onAddContextMention,
  onViewBilling,
  paletteMode,
  skillItems,
  slashItems,
}: UseComposerPaletteOptions): UseComposerPaletteResult {
  const trigger = React.useMemo(
    () => (disabled ? null : detectComposerTrigger(draft, draftSelection.start, draftSelection.end)),
    [disabled, draft, draftSelection.end, draftSelection.start],
  )
  const triggerKey = trigger ? `${trigger.kind}:${trigger.start}:${trigger.query}` : null
  const activeTrigger = triggerKey && triggerKey !== dismissedTriggerKey ? trigger : null
  const items = React.useMemo<ChatComposerPaletteItem[]>(() => {
    if (!activeTrigger) {
      return []
    }
    let sourceItems: ChatComposerPaletteItem[]
    if (activeTrigger.kind === "skill" || paletteMode === "skills") {
      sourceItems = skillItems
    } else if (paletteMode === "connections") {
      sourceItems = connectionItems
    } else {
      sourceItems = slashItems
    }
    return sourceItems.filter((item) => matchesComposerQuery(item, activeTrigger.query)).slice(0, 8)
  }, [activeTrigger, connectionItems, paletteMode, skillItems, slashItems])
  const open = Boolean(activeTrigger)
  const activeItem = items[Math.min(activePaletteIndex, Math.max(0, items.length - 1))]

  React.useEffect(() => {
    dispatch({ type: "set-active-palette-index", index: 0 })
  }, [activeTrigger?.kind, activeTrigger?.query, dispatch, paletteMode])

  React.useEffect(() => {
    if (!activeTrigger) {
      dispatch({ type: "set-palette-mode", mode: "root" })
      return
    }
    dispatch({ type: "set-palette-mode", mode: initialPaletteMode(activeTrigger.kind) })
  }, [activeTrigger?.kind, activeTrigger?.start, dispatch])

  const handleBack = React.useCallback(() => {
    const parentId = paletteMode === "connections" ? "connections" : "skills"
    const parentIndex = slashItems.findIndex((item) => item.id === parentId)
    dispatch({ type: "set-palette-mode", mode: "root" })
    dispatch({ type: "set-active-palette-index", index: parentIndex >= 0 ? parentIndex : 0 })
  }, [dispatch, paletteMode, slashItems])

  const applySlashCommand = React.useCallback(
    (item: SlashCommandPaletteItem, currentTrigger: ComposerTrigger) => {
      if (item.disabled) {
        return
      }
      if (item.action === "skills") {
        dispatch({ type: "replace-trigger", trigger: currentTrigger, replacement: "/" })
        dispatch({ type: "set-palette-mode", mode: "skills" })
        focusDraftAt(currentTrigger.start + 1)
        return
      }
      if (item.action === "connections") {
        dispatch({ type: "replace-trigger", trigger: currentTrigger, replacement: "/" })
        dispatch({ type: "set-palette-mode", mode: "connections" })
        focusDraftAt(currentTrigger.start + 1)
        return
      }
      if (item.action === "billing") {
        dispatch({ type: "replace-trigger", trigger: currentTrigger, replacement: "" })
        onViewBilling?.()
        focusDraftAt(currentTrigger.start)
        return
      }

      const replacement = `${item.prompt ?? ""} `
      dispatch({ type: "replace-trigger", trigger: currentTrigger, replacement })
      focusDraftAt(currentTrigger.start + replacement.length)
    },
    [dispatch, focusDraftAt, onViewBilling],
  )

  const applySkillItem = React.useCallback(
    (item: SkillPaletteItem, currentTrigger: ComposerTrigger) => {
      onAddContextMention({
        description: item.descriptionText,
        id: item.skillId,
        kind: "skill",
        name: item.skillName,
      })
      dispatch({ type: "replace-trigger", trigger: currentTrigger, replacement: "" })
      focusDraftAt(currentTrigger.start)
    },
    [dispatch, focusDraftAt, onAddContextMention],
  )

  const applyConnectionItem = React.useCallback(
    (item: ConnectionPaletteItem, currentTrigger: ComposerTrigger) => {
      onAddContextMention({
        ...(item.accountLabel ? { accountLabel: item.accountLabel } : {}),
        ...(item.appId ? { appId: item.appId } : {}),
        displayName: item.displayName,
        kind: "connection",
        service: item.service,
      })
      dispatch({ type: "replace-trigger", trigger: currentTrigger, replacement: "" })
      focusDraftAt(currentTrigger.start)
    },
    [dispatch, focusDraftAt, onAddContextMention],
  )

  const onSelect = React.useCallback(
    (item: ChatComposerPaletteItem | undefined) => {
      if (!item || !activeTrigger) {
        return
      }
      switch (item.kind) {
        case "slash":
          if (activeTrigger.kind === "slash" && paletteMode === "root") {
            applySlashCommand(item, activeTrigger)
          }
          return
        case "connection":
          applyConnectionItem(item, activeTrigger)
          return
        case "skill":
          applySkillItem(item, activeTrigger)
      }
    },
    [activeTrigger, applyConnectionItem, applySkillItem, applySlashCommand, paletteMode],
  )

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.nativeEvent.isComposing) {
        return
      }
      if (!open) {
        return
      }
      const action = resolveComposerPaletteKeyAction({
        activeIndex: activePaletteIndex,
        activeRootAction:
          activeTrigger?.kind === "slash" && paletteMode === "root" && activeItem?.kind === "slash"
            ? activeItem.action
            : undefined,
        itemCount: items.length,
        key: event.key,
        paletteMode,
        triggerKind: activeTrigger?.kind,
      })
      if (action.type === "none") {
        return
      }
      event.preventDefault()
      if (action.type === "move") {
        dispatch({ type: "set-active-palette-index", index: action.index })
      } else if (action.type === "back") {
        handleBack()
      } else if (action.type === "open-root-item" && activeTrigger && activeItem?.kind === "slash") {
        applySlashCommand(activeItem, activeTrigger)
      } else if (action.type === "select") {
        onSelect(activeItem)
      } else if (action.type === "dismiss") {
        dispatch({ type: "set-dismissed-trigger-key", key: triggerKey })
      }
    },
    [
      activeItem,
      activePaletteIndex,
      activeTrigger,
      applySlashCommand,
      dispatch,
      handleBack,
      items.length,
      onSelect,
      open,
      paletteMode,
      triggerKey,
    ],
  )

  return {
    activeItem,
    activeTrigger,
    handleBack: activeTrigger?.kind === "slash" && paletteMode !== "root" ? handleBack : undefined,
    handleKeyDown,
    items,
    onSelect,
    open,
  }
}
