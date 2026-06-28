import type { ChatContextMention } from "../../../electron/chat/common.ts"
import type {
  ArtifactPaletteItem,
  AttachmentPaletteItem,
  ChatComposerPaletteItem,
  ConnectionPaletteItem,
  SkillPaletteItem,
  SlashCommandPaletteItem,
} from "./composer-palette-items.ts"
import type { PaletteMode } from "./composer-palette-state.ts"
import type { ComposerAction } from "./composer-state.ts"
import type { ComposerTrigger } from "./composer-triggers.ts"

import * as React from "react"
import { creatorSkillId, matchesComposerQuery } from "./composer-palette-items.ts"
import { resolveComposerPaletteKeyAction } from "./composer-palette-logic.ts"
import {
  initialComposerPaletteNavigation,
  resolveComposerPaletteNavigation,
  updateComposerPaletteNavigation,
} from "./composer-palette-state.ts"
import { detectComposerTrigger } from "./composer-triggers.ts"

interface UseComposerPaletteOptions {
  connectionItems: ConnectionPaletteItem[]
  contextItems: Array<ArtifactPaletteItem | AttachmentPaletteItem | ConnectionPaletteItem>
  disabled: boolean
  dismissedTriggerKey: string | null
  dispatch: React.Dispatch<ComposerAction>
  draft: string
  draftSelection: { end: number; start: number }
  focusDraftAt: (index: number) => void
  onAddArtifactAttachment: (item: ArtifactPaletteItem) => void
  onAddContextMention: (mention: ChatContextMention) => void
  onSelectAttachments: (kind: "file" | "directory") => void
  onViewBilling?: () => void
  skillItems: SkillPaletteItem[]
  slashItems: SlashCommandPaletteItem[]
}

export interface UseComposerPaletteResult {
  activeItem: ChatComposerPaletteItem | undefined
  activeTrigger: ComposerTrigger | null
  handleBack: (() => void) | undefined
  handleKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
  items: ChatComposerPaletteItem[]
  mode: PaletteMode
  onSelect: (item: ChatComposerPaletteItem | undefined) => void
  open: boolean
}

export function useComposerPalette({
  connectionItems,
  contextItems,
  disabled,
  dismissedTriggerKey,
  dispatch,
  draft,
  draftSelection,
  focusDraftAt,
  onAddArtifactAttachment,
  onAddContextMention,
  onSelectAttachments,
  onViewBilling,
  skillItems,
  slashItems,
}: UseComposerPaletteOptions): UseComposerPaletteResult {
  const [paletteNavigation, setPaletteNavigation] = React.useState(initialComposerPaletteNavigation)
  const trigger = React.useMemo(
    () => (disabled ? null : detectComposerTrigger(draft, draftSelection.start, draftSelection.end)),
    [disabled, draft, draftSelection.end, draftSelection.start],
  )
  const triggerKey = trigger ? `${trigger.kind}:${trigger.start}:${trigger.query}` : null
  const activeTrigger = triggerKey && triggerKey !== dismissedTriggerKey ? trigger : null
  const resolvedPaletteNavigation = React.useMemo(
    () => resolveComposerPaletteNavigation(paletteNavigation, activeTrigger),
    [activeTrigger, paletteNavigation],
  )
  const paletteMode = resolvedPaletteNavigation.mode
  const activePaletteIndex = resolvedPaletteNavigation.activeIndex
  const updatePaletteNavigation = React.useCallback(
    (updater: (current: typeof resolvedPaletteNavigation) => typeof resolvedPaletteNavigation) => {
      setPaletteNavigation((current) => updateComposerPaletteNavigation(current, activeTrigger, updater))
    },
    [activeTrigger],
  )
  const items = React.useMemo<ChatComposerPaletteItem[]>(() => {
    if (!activeTrigger) {
      return []
    }
    let sourceItems: ChatComposerPaletteItem[]
    if (activeTrigger.kind === "context") {
      sourceItems = contextItems
    } else if (activeTrigger.kind === "skill" || paletteMode === "skills") {
      sourceItems = skillItems
    } else if (paletteMode === "connections") {
      sourceItems = connectionItems
    } else {
      sourceItems = slashItems
    }
    return sourceItems.filter((item) => matchesComposerQuery(item, activeTrigger.query)).slice(0, 8)
  }, [activeTrigger, connectionItems, contextItems, paletteMode, skillItems, slashItems])
  const open = Boolean(activeTrigger)
  const activeItem = items[Math.min(activePaletteIndex, Math.max(0, items.length - 1))]

  const handleBack = React.useCallback(() => {
    const parentId = paletteMode === "connections" ? "connections" : "skills"
    const parentIndex = slashItems.findIndex((item) => item.id === parentId)
    updatePaletteNavigation((current) => ({
      ...current,
      activeIndex: parentIndex >= 0 ? parentIndex : 0,
      mode: "root",
    }))
  }, [paletteMode, slashItems, updatePaletteNavigation])

  const applySlashCommand = React.useCallback(
    (item: SlashCommandPaletteItem, currentTrigger: ComposerTrigger) => {
      if (item.disabled) {
        return
      }
      if (item.action === "skills") {
        dispatch({ type: "replace-trigger", trigger: currentTrigger, replacement: "/" })
        updatePaletteNavigation((current) => ({ ...current, activeIndex: 0, mode: "skills" }))
        focusDraftAt(currentTrigger.start + 1)
        return
      }
      if (item.action === "connections") {
        dispatch({ type: "replace-trigger", trigger: currentTrigger, replacement: "/" })
        updatePaletteNavigation((current) => ({ ...current, activeIndex: 0, mode: "connections" }))
        focusDraftAt(currentTrigger.start + 1)
        return
      }
      if (item.action === "billing") {
        dispatch({ type: "replace-trigger", trigger: currentTrigger, replacement: "" })
        onViewBilling?.()
        focusDraftAt(currentTrigger.start)
        return
      }
      if (item.action === "attach-file" || item.action === "attach-folder") {
        dispatch({ type: "replace-trigger", trigger: currentTrigger, replacement: "" })
        onSelectAttachments(item.action === "attach-file" ? "file" : "directory")
        focusDraftAt(currentTrigger.start)
        return
      }
      if (item.action === "creator-skill") {
        onAddContextMention({
          description: item.description,
          id: creatorSkillId,
          kind: "skill",
          name: item.title,
        })
        dispatch({ type: "replace-trigger", trigger: currentTrigger, replacement: "" })
        focusDraftAt(currentTrigger.start)
      }
    },
    [dispatch, focusDraftAt, onAddContextMention, onSelectAttachments, onViewBilling, updatePaletteNavigation],
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

  const applyAttachmentItem = React.useCallback(
    (item: AttachmentPaletteItem, currentTrigger: ComposerTrigger) => {
      dispatch({ type: "replace-trigger", trigger: currentTrigger, replacement: "" })
      onSelectAttachments(item.action === "attach-file" ? "file" : "directory")
      focusDraftAt(currentTrigger.start)
    },
    [dispatch, focusDraftAt, onSelectAttachments],
  )

  const applyArtifactItem = React.useCallback(
    (item: ArtifactPaletteItem, currentTrigger: ComposerTrigger) => {
      dispatch({ type: "replace-trigger", trigger: currentTrigger, replacement: "" })
      onAddArtifactAttachment(item)
      focusDraftAt(currentTrigger.start)
    },
    [dispatch, focusDraftAt, onAddArtifactAttachment],
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
        case "attachment":
          applyAttachmentItem(item, activeTrigger)
          return
        case "artifact":
          applyArtifactItem(item, activeTrigger)
          return
        case "skill":
          applySkillItem(item, activeTrigger)
      }
    },
    [
      activeTrigger,
      applyArtifactItem,
      applyAttachmentItem,
      applyConnectionItem,
      applySkillItem,
      applySlashCommand,
      paletteMode,
    ],
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
        updatePaletteNavigation((current) => ({ ...current, activeIndex: action.index }))
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
      updatePaletteNavigation,
    ],
  )

  return {
    activeItem,
    activeTrigger,
    handleBack: activeTrigger?.kind === "slash" && paletteMode !== "root" ? handleBack : undefined,
    handleKeyDown,
    items,
    mode: paletteMode,
    onSelect,
    open,
  }
}
