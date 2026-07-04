import type { AttachmentPickerKind } from "../../../electron/attachment-picker.ts"
import type { ChatContextMention } from "../../../electron/chat/common.ts"
import type {
  ArtifactPaletteItem,
  AttachmentPaletteAction,
  AttachmentPaletteItem,
  ChatComposerPaletteItem,
  ConnectionAccountPaletteItem,
  ConnectionPaletteItem,
  ConnectionProviderPaletteItem,
  SkillPaletteItem,
  SlashCommandPaletteItem,
} from "./composer-palette-items.ts"
import type { PaletteMode } from "./composer-palette-state.ts"
import type { ComposerAction } from "./composer-state.ts"
import type { ComposerTrigger } from "./composer-triggers.ts"

import * as React from "react"
import {
  buildConnectionAccountPaletteItems,
  buildSlashRootPaletteItems,
  creatorSkillId,
  filterComposerPaletteItems,
} from "./composer-palette-items.ts"
import { resolveComposerPaletteKeyAction } from "./composer-palette-logic.ts"
import {
  initialComposerPaletteNavigation,
  resolveComposerPaletteNavigation,
  updateComposerPaletteNavigation,
} from "./composer-palette-state.ts"
import { detectComposerTrigger } from "./composer-triggers.ts"

interface UseComposerPaletteOptions {
  connectionItems: ConnectionProviderPaletteItem[]
  contextItems: Array<ArtifactPaletteItem | AttachmentPaletteItem | ConnectionProviderPaletteItem>
  disabled: boolean
  dismissedTriggerKey: string | null
  dispatch: React.Dispatch<ComposerAction>
  draft: string
  draftSelection: { end: number; start: number }
  focusDraftAt: (index: number) => void
  onAddArtifactAttachment: (item: ArtifactPaletteItem) => void
  onAddContextMention: (mention: ChatContextMention) => void
  onOpenConnectionProvider?: (service: string, displayName: string) => void
  onRequestSetDefaultConnection?: (item: ConnectionAccountPaletteItem, selectConnection: () => void) => void
  onSelectAttachments: (kind: AttachmentPickerKind) => void
  onViewBilling?: () => void
  skillItems: SkillPaletteItem[]
  slashItems: SlashCommandPaletteItem[]
}

function attachmentPickerKind(action: AttachmentPaletteAction): AttachmentPickerKind {
  if (action === "attach-folder") {
    return "directory"
  }
  return action === "attach-file-or-folder" ? "file-or-directory" : "file"
}

export interface UseComposerPaletteResult {
  activeItem: ChatComposerPaletteItem | undefined
  activeTrigger: ComposerTrigger | null
  handleBack: (() => void) | undefined
  handleKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
  items: ChatComposerPaletteItem[]
  mode: PaletteMode
  onSelect: (item: ChatComposerPaletteItem | undefined) => void
  onSecondarySelect: (item: ChatComposerPaletteItem | undefined) => void
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
  onOpenConnectionProvider,
  onRequestSetDefaultConnection,
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
  const selectedConnectionProvider = React.useMemo(
    () => connectionItems.find((item) => item.service === resolvedPaletteNavigation.connectionService),
    [connectionItems, resolvedPaletteNavigation.connectionService],
  )
  const selectedConnectionAccountItems = React.useMemo(
    () => buildConnectionAccountPaletteItems(selectedConnectionProvider?.provider, selectedConnectionProvider?.copy),
    [selectedConnectionProvider],
  )
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
      sourceItems = paletteMode === "connection-accounts" ? selectedConnectionAccountItems : contextItems
    } else if (activeTrigger.kind === "skill" || paletteMode === "skills") {
      sourceItems = skillItems
    } else if (paletteMode === "connection-accounts") {
      sourceItems = selectedConnectionAccountItems
    } else if (paletteMode === "connections") {
      sourceItems = connectionItems
    } else {
      sourceItems = buildSlashRootPaletteItems({ connectionItems, skillItems, slashItems })
    }
    return filterComposerPaletteItems(sourceItems, activeTrigger.query)
  }, [
    activeTrigger,
    connectionItems,
    contextItems,
    paletteMode,
    selectedConnectionAccountItems,
    skillItems,
    slashItems,
  ])
  const open = Boolean(activeTrigger)
  const activeItem = items[Math.min(activePaletteIndex, Math.max(0, items.length - 1))]

  const handleBack = React.useCallback(() => {
    if (paletteMode === "connection-accounts") {
      const parentIndex =
        activeTrigger?.kind === "context"
          ? contextItems.findIndex(
              (item) =>
                item.kind === "connection-provider" && item.service === resolvedPaletteNavigation.connectionService,
            )
          : connectionItems.findIndex((item) => item.service === resolvedPaletteNavigation.connectionService)
      updatePaletteNavigation((current) => ({
        ...current,
        activeIndex: Math.max(0, parentIndex),
        connectionService: null,
        mode: activeTrigger?.kind === "context" ? "root" : "connections",
      }))
      return
    }
    const parentId = paletteMode === "connections" ? "connections" : "skills"
    const parentIndex = slashItems.findIndex((item) => item.id === parentId)
    updatePaletteNavigation((current) => ({
      ...current,
      activeIndex: parentIndex >= 0 ? parentIndex : 0,
      connectionService: null,
      mode: "root",
    }))
  }, [
    activeTrigger?.kind,
    connectionItems,
    contextItems,
    paletteMode,
    resolvedPaletteNavigation.connectionService,
    slashItems,
    updatePaletteNavigation,
  ])

  const openConnectionAccounts = React.useCallback(
    (item: ConnectionProviderPaletteItem) => {
      if (!item.canOpenAccounts) {
        return
      }
      updatePaletteNavigation((current) => ({
        ...current,
        activeIndex: 0,
        connectionService: item.service,
        mode: "connection-accounts",
      }))
    },
    [updatePaletteNavigation],
  )

  const applySlashCommand = React.useCallback(
    (item: SlashCommandPaletteItem, currentTrigger: ComposerTrigger) => {
      if (item.disabled) {
        return
      }
      if (item.action === "skills") {
        dispatch({ type: "replace-trigger", trigger: currentTrigger, replacement: "/" })
        updatePaletteNavigation((current) => ({ ...current, activeIndex: 0, connectionService: null, mode: "skills" }))
        focusDraftAt(currentTrigger.start + 1)
        return
      }
      if (item.action === "connections") {
        dispatch({ type: "replace-trigger", trigger: currentTrigger, replacement: "/" })
        updatePaletteNavigation((current) => ({
          ...current,
          activeIndex: 0,
          connectionService: null,
          mode: "connections",
        }))
        focusDraftAt(currentTrigger.start + 1)
        return
      }
      if (item.action === "billing") {
        dispatch({ type: "replace-trigger", trigger: currentTrigger, replacement: "" })
        onViewBilling?.()
        focusDraftAt(currentTrigger.start)
        return
      }
      if (item.action === "attach-file" || item.action === "attach-folder" || item.action === "attach-file-or-folder") {
        dispatch({ type: "replace-trigger", trigger: currentTrigger, replacement: "" })
        onSelectAttachments(attachmentPickerKind(item.action))
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
        ...(item.iconSource ? { icon: item.iconSource } : {}),
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
      if (item.disabled) {
        return
      }
      if (item.connectionAction !== "use") {
        onOpenConnectionProvider?.(item.service, item.displayName)
        dispatch({ type: "replace-trigger", trigger: currentTrigger, replacement: "" })
        focusDraftAt(currentTrigger.start)
        return
      }
      if (!item.appId) {
        return
      }
      onAddContextMention({
        appId: item.appId,
        displayName: item.displayName,
        kind: "connection",
        service: item.service,
      })
      dispatch({ type: "replace-trigger", trigger: currentTrigger, replacement: "" })
      focusDraftAt(currentTrigger.start)
    },
    [dispatch, focusDraftAt, onAddContextMention, onOpenConnectionProvider],
  )

  const requestSetDefaultConnection = React.useCallback(
    (item: ConnectionAccountPaletteItem, currentTrigger: ComposerTrigger) => {
      if (item.disabled || !onRequestSetDefaultConnection) {
        return
      }
      onRequestSetDefaultConnection(item, () => applyConnectionItem(item, currentTrigger))
    },
    [applyConnectionItem, onRequestSetDefaultConnection],
  )

  const applyAttachmentItem = React.useCallback(
    (item: AttachmentPaletteItem, currentTrigger: ComposerTrigger) => {
      dispatch({ type: "replace-trigger", trigger: currentTrigger, replacement: "" })
      onSelectAttachments(attachmentPickerKind(item.action))
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
      if (!item || item.disabled || !activeTrigger) {
        return
      }
      switch (item.kind) {
        case "slash":
          if (activeTrigger.kind === "slash" && paletteMode === "root") {
            applySlashCommand(item, activeTrigger)
          }
          return
        case "connection-account":
          applyConnectionItem(item, activeTrigger)
          return
        case "connection-provider":
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

  const onSecondarySelect = React.useCallback(
    (item: ChatComposerPaletteItem | undefined) => {
      if (!item || item.disabled || !activeTrigger) {
        return
      }
      if (item.kind === "connection-provider") {
        openConnectionAccounts(item)
        return
      }
      if (item.kind === "connection-account" && item.secondaryActionLabel && !item.secondaryActionDisabled) {
        requestSetDefaultConnection(item, activeTrigger)
      }
    },
    [activeTrigger, openConnectionAccounts, requestSetDefaultConnection],
  )

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.nativeEvent.isComposing) {
        return
      }
      if (!open) {
        return
      }
      if (
        event.key === "ArrowRight" &&
        activeItem?.kind === "connection-provider" &&
        !activeItem.disabled &&
        activeItem.canOpenAccounts
      ) {
        event.preventDefault()
        openConnectionAccounts(activeItem)
        return
      }
      if (
        event.key === "ArrowRight" &&
        activeItem?.kind === "connection-account" &&
        !activeItem.disabled &&
        activeItem.secondaryActionLabel &&
        !activeItem.secondaryActionDisabled &&
        activeTrigger
      ) {
        event.preventDefault()
        requestSetDefaultConnection(activeItem, activeTrigger)
        return
      }
      if (
        event.key === "Enter" &&
        (event.metaKey || event.altKey) &&
        activeItem?.kind === "connection-account" &&
        !activeItem.disabled &&
        activeItem.secondaryActionLabel &&
        !activeItem.secondaryActionDisabled &&
        activeTrigger
      ) {
        event.preventDefault()
        requestSetDefaultConnection(activeItem, activeTrigger)
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
      openConnectionAccounts,
      paletteMode,
      requestSetDefaultConnection,
      triggerKey,
      updatePaletteNavigation,
    ],
  )

  return {
    activeItem,
    activeTrigger,
    handleBack:
      (activeTrigger?.kind === "slash" && paletteMode !== "root") || paletteMode === "connection-accounts"
        ? handleBack
        : undefined,
    handleKeyDown,
    items,
    mode: paletteMode,
    onSelect,
    onSecondarySelect,
    open,
  }
}
