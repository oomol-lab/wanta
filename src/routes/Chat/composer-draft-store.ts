import type { ComposerDraftPreferences, ComposerDraftRecord } from "../../../electron/chat/common.ts"
import type { ComposerAction, ComposerState, DraftAttachment } from "./composer-state.ts"

import { releaseAttachmentSnapshots } from "./chat-attachment-utils.ts"
import {
  composerReducer,
  hasComposerDraftContent,
  initialComposerState,
  toCachedComposerState,
} from "./composer-state.ts"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"

export interface ComposerDraftBinding {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => ComposerState
  dispatch: (action: ComposerAction) => void
  beginImport: () => (attachments: DraftAttachment[], error?: string) => void
  clear: () => () => void
  isReady: () => boolean
  retrySave: () => void
  saveError: () => boolean
}

/** Drafts own edits and asynchronous imports independently of mounted input components. */
export class ComposerDrafts {
  readonly entries = new Map<string, ComposerState>()
  private listeners = new Set<() => void>()
  private epochs = new Map<string, number>()
  private queue: Promise<void> = Promise.resolve()
  private ready = false
  private loadFailed = false
  private failedKeys = new Set<string>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private bindings = new Map<string, ComposerDraftBinding>()
  private contentVersions = new WeakMap<ComposerState, symbol>()
  constructor(
    privateLoad: () => Promise<Record<string, ComposerDraftRecord>>,
    privateSave: (key: string, value: ComposerDraftRecord | null) => Promise<void>,
  ) {
    this.load = privateLoad
    this.save = privateSave
  }
  private load: () => Promise<Record<string, ComposerDraftRecord>>
  private save: (key: string, value: ComposerDraftRecord | null) => Promise<void>
  async initialize() {
    try {
      const records = await this.load()
      for (const [key, value] of Object.entries(records)) {
        const current = this.entries.get(key)
        if (
          !hasComposerDraftContent({
            ...(current ?? initialComposerState()),
            pendingImports: 0,
            interruptedImport: undefined,
          })
        ) {
          this.entries.set(key, {
            ...value,
            ...(current
              ? {
                  pendingImports: current.pendingImports,
                  importError: current.importError,
                  interruptedImport: current.interruptedImport ?? value.interruptedImport,
                }
              : {}),
          })
        }
      }
      this.ready = true
      this.loadFailed = false
    } catch (error) {
      reportRendererHandledError("chat.draft.load", "Failed to load composer drafts", error)
      this.loadFailed = true
    }
    this.emit()
  }
  private emit() {
    for (const listener of this.listeners) listener()
  }
  private persist(key: string, immediate = false) {
    clearTimeout(this.timers.get(key))
    const write = () => {
      this.timers.delete(key)
      const state = this.entries.get(key)
      const value =
        state && hasComposerDraftContent(state) ? { ...toCachedComposerState(state), dismissedTriggerKey: null } : null
      this.queue = this.queue
        .then(() => this.save(key, value))
        .then(
          () => {
            this.failedKeys.delete(key)
            this.emit()
          },
          (error: unknown) => {
            reportRendererHandledError("chat.draft.save", "Failed to save composer draft", error)
            this.failedKeys.add(key)
            this.emit()
          },
        )
    }
    if (immediate) write()
    else this.timers.set(key, setTimeout(write, 250))
  }
  flush() {
    for (const key of this.timers.keys()) this.persist(key, true)
    return this.queue
  }
  private contentVersion(state: ComposerState): symbol {
    let version = this.contentVersions.get(state)
    if (!version) {
      version = Symbol()
      this.contentVersions.set(state, version)
    }
    return version
  }
  preferences(key: string, preferences: ComposerDraftPreferences) {
    const current = this.entries.get(key)
    if (!current || JSON.stringify(current.preferences) === JSON.stringify(preferences)) return
    const next = { ...current, preferences }
    this.contentVersions.set(next, this.contentVersion(current))
    this.entries.set(key, next)
    this.persist(key)
    this.emit()
  }
  move(from: string, to: string): boolean {
    const source = this.entries.get(from)
    const target = this.entries.get(to)
    if (target && (hasComposerDraftContent(target) || target.pendingImports)) return false
    if (!source || source.pendingImports) return false
    this.entries.set(to, source)
    this.entries.set(from, initialComposerState())
    this.epochs.set(from, (this.epochs.get(from) ?? 0) + 1)
    this.persist(to, true)
    this.persist(from, true)
    this.emit()
    return true
  }
  consume(key: string, submitted: ComposerState | undefined) {
    const current = this.entries.get(key)
    if (current && submitted && this.contentVersion(current) === this.contentVersion(submitted)) this.clear(key)
  }
  clear(key: string) {
    const previous = this.entries.get(key)
    const epoch = (this.epochs.get(key) ?? 0) + 1
    this.epochs.set(key, epoch)
    this.entries.set(key, { ...initialComposerState(), preferences: previous?.preferences })
    this.persist(key, true)
    this.emit()
    return () => {
      const current = this.entries.get(key)
      if (
        previous &&
        this.epochs.get(key) === epoch &&
        current &&
        !hasComposerDraftContent(current) &&
        !current.pendingImports
      ) {
        this.entries.set(key, {
          ...previous,
          pendingImports: 0,
          interruptedImport: Boolean(previous.pendingImports) || previous.interruptedImport || undefined,
        })
        this.persist(key, true)
        this.emit()
      }
    }
  }
  binding(key: string): ComposerDraftBinding {
    const existing = this.bindings.get(key)
    if (existing) return existing
    if (!this.entries.has(key)) this.entries.set(key, initialComposerState())
    const binding: ComposerDraftBinding = {
      subscribe: (listener) => {
        this.listeners.add(listener)
        return () => {
          this.listeners.delete(listener)
        }
      },
      getSnapshot: () => this.entries.get(key)!,
      isReady: () => this.ready,
      saveError: () => this.loadFailed || this.failedKeys.size > 0,
      retrySave: () => {
        if (!this.ready) void this.initialize()
        for (const failedKey of this.failedKeys) this.persist(failedKey, true)
      },
      dispatch: (action) => {
        const current = this.entries.get(key)!
        const next = composerReducer(current, action)
        // Cursor and palette updates do not create a new unsent message. Keep a
        // version per content edit so editing away and back still protects it.
        if (
          action.type === "set-draft-selection" ||
          action.type === "set-dismissed-trigger-key" ||
          (action.type === "set-draft" && action.draft === current.draft)
        ) {
          this.contentVersions.set(next, this.contentVersion(current))
        }
        this.entries.set(key, next)
        this.persist(key, action.type !== "set-draft" && action.type !== "set-draft-selection")
        this.emit()
      },
      clear: () => this.clear(key),
      beginImport: () => {
        const epoch = this.epochs.get(key) ?? 0
        const state = this.entries.get(key)!
        this.entries.set(key, {
          ...state,
          pendingImports: (state.pendingImports ?? 0) + 1,
          interruptedImport: undefined,
          importError: undefined,
        })
        this.persist(key, true)
        this.emit()
        let finished = false
        return (attachments, error) => {
          if (finished) return
          finished = true
          if ((this.epochs.get(key) ?? 0) !== epoch) {
            releaseAttachmentSnapshots(attachments)
            return
          }
          const current = this.entries.get(key)!
          const paths = new Set(current.attachments.map((a) => a.path))
          const unique = attachments.filter((a) => {
            if (paths.has(a.path)) return false
            paths.add(a.path)
            return true
          })
          this.entries.set(key, {
            ...current,
            attachments: [...current.attachments, ...unique],
            pendingImports: Math.max(0, (current.pendingImports ?? 1) - 1),
            importError: error,
          })
          this.persist(key, true)
          this.emit()
        }
      },
    }
    this.bindings.set(key, binding)
    return binding
  }
}
