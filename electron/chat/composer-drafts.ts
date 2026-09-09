import type { ComposerDraftRecord, ComposerDraftRequest } from "./common.ts"

import { randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rename } from "node:fs/promises"
import path from "node:path"
import { isAgentKind } from "../agent/contract/profile.ts"
import { atomicWriteText } from "../atomic-file.ts"
import { AGENT_PERMISSION_MODES } from "./common.ts"

export function normalizeComposerDraft(input: unknown): ComposerDraftRecord {
  if (!input || typeof input !== "object") throw new Error("Invalid draft")
  const value = input as ComposerDraftRecord
  if (
    typeof value.draft !== "string" ||
    !Array.isArray(value.attachments) ||
    !Array.isArray(value.contextMentions) ||
    (value.command !== null && value.command !== "bug-report") ||
    !Number.isFinite(value.draftSelection?.start) ||
    !Number.isFinite(value.draftSelection?.end)
  )
    throw new Error("Invalid draft")
  const attachments = value.attachments.map((a) => {
    if (
      !a ||
      typeof a.path !== "string" ||
      !a.path.trim() ||
      typeof a.id !== "string" ||
      typeof a.name !== "string" ||
      typeof a.mime !== "string" ||
      !Number.isFinite(a.size) ||
      a.size < 0 ||
      (a.agentPath !== undefined && typeof a.agentPath !== "string")
    )
      throw new Error("Invalid draft attachment")
    return {
      id: a.id,
      path: a.path,
      name: a.name,
      mime: a.mime,
      size: a.size,
      kind: a.kind,
      agentPath: a.agentPath,
      agentMime: a.agentMime,
      agentName: a.agentName,
      agentSize: a.agentSize,
    }
  })
  for (const mention of value.contextMentions) {
    if (!mention || !["skill", "knowledge", "connection"].includes(mention.kind))
      throw new Error("Invalid draft reference")
  }
  if (
    value.preferences &&
    (!isAgentKind(value.preferences.agentKind) ||
      !AGENT_PERMISSION_MODES.includes(value.preferences.permissionMode) ||
      !Array.isArray(value.preferences.knowledgeBaseIds) ||
      !value.preferences.knowledgeBaseIds.every((id) => typeof id === "string"))
  )
    throw new Error("Invalid draft preferences")
  return {
    interruptedImport: value.interruptedImport || undefined,
    draft: value.draft,
    attachments,
    contextMentions: value.contextMentions,
    command: value.command,
    draftSelection: {
      start: Math.max(0, Math.min(value.draft.length, value.draftSelection.start)),
      end: Math.max(0, Math.min(value.draft.length, value.draftSelection.end)),
    },
    dismissedTriggerKey: null,
    ...(value.preferences
      ? {
          preferences: {
            agentKind: value.preferences.agentKind,
            knowledgeBaseIds: [...value.preferences.knowledgeBaseIds],
            ...(typeof value.preferences.modelId === "string" ? { modelId: value.preferences.modelId } : {}),
            ...(typeof value.preferences.effortId === "string" ? { effortId: value.preferences.effortId } : {}),
            permissionMode:
              value.preferences.permissionMode === "full_access" ? "default" : value.preferences.permissionMode,
          },
        }
      : {}),
  }
}

/** Durable metadata only. Preview URLs and renderer state never become file grants. */
export class ComposerDraftStore {
  private queue: Promise<void> = Promise.resolve()
  private readonly undoLeases = new Map<string, { owner: string; value: ComposerDraftRecord; expiresAt: number }>()
  private records: Record<string, Record<string, ComposerDraftRecord>> | undefined
  private readonly file: string
  private readonly recoveryDirectory: string
  private loading: Promise<void> | undefined
  private needsQuarantine = false
  private retentionBlocked = false
  constructor(directory: string) {
    this.file = path.join(directory, "composer-drafts.json")
    this.recoveryDirectory = path.join(directory, "composer-drafts-recovery")
  }
  private async load() {
    if (!this.records) {
      this.loading ??= this.loadFromDisk().finally(() => {
        this.loading = undefined
      })
      await this.loading
    }
    return this.records!
  }
  private async loadFromDisk(): Promise<void> {
    const recoveryFiles = await readdir(this.recoveryDirectory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return []
      throw error
    })
    // Unknown references in preserved stores must survive subsequent saves and process restarts.
    this.retentionBlocked = recoveryFiles.length > 0
    const contents = await readFile(this.file, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (contents === undefined) {
      this.records = {}
      return
    }
    try {
      const parsed = JSON.parse(contents)
      if (parsed?.version !== 1 || !parsed.owners || typeof parsed.owners !== "object" || Array.isArray(parsed.owners))
        throw new Error("Invalid composer draft store")
      Object.setPrototypeOf(parsed.owners, null)
      for (const drafts of Object.values(parsed.owners)) {
        if (!drafts || typeof drafts !== "object" || Array.isArray(drafts))
          throw new Error("Invalid composer draft store")
        Object.setPrototypeOf(drafts, null)
        for (const [key, draft] of Object.entries(drafts))
          Object.defineProperty(drafts, key, {
            value: normalizeComposerDraft(draft),
            enumerable: true,
            configurable: true,
            writable: true,
          })
      }
      this.records = parsed.owners
    } catch {
      // Never log parser errors: they can contain private draft text.
      console.warn("[wanta] unreadable composer draft store; attachment pruning disabled until recovery")
      this.needsQuarantine = true
      this.retentionBlocked = true
      this.records = {}
    }
  }
  private async quarantineUnreadableStore(): Promise<void> {
    if (!this.needsQuarantine) return
    await mkdir(this.recoveryDirectory, { recursive: true, mode: 0o700 })
    await rename(this.file, path.join(this.recoveryDirectory, `${randomUUID()}.json`))
    this.needsQuarantine = false
  }
  async retentionState(): Promise<{ paused: boolean; paths: string[] }> {
    await this.queue
    await this.load()
    return { paused: this.retentionBlocked, paths: await this.paths() }
  }
  async read(owner: string): Promise<Record<string, ComposerDraftRecord>> {
    await this.queue
    const records = await this.load()
    return structuredClone(Object.hasOwn(records, owner) ? records[owner]! : {})
  }
  async save({ owner, key, value }: ComposerDraftRequest): Promise<void> {
    const operation = this.queue.then(async () => {
      const records = Object.assign(Object.create(null), structuredClone(await this.load())) as Record<
        string,
        Record<string, ComposerDraftRecord>
      >
      const drafts: Record<string, ComposerDraftRecord> = Object.assign(
        Object.create(null),
        Object.hasOwn(records, owner) ? records[owner]! : {},
      )
      const previous = Object.hasOwn(drafts, key) ? drafts[key] : undefined
      const undoKey = JSON.stringify([owner, key])
      if (value)
        Object.defineProperty(drafts, key, {
          value: normalizeComposerDraft(value),
          enumerable: true,
          configurable: true,
          writable: true,
        })
      else delete drafts[key]
      Object.defineProperty(records, owner, { value: drafts, enumerable: true, writable: true, configurable: true })
      await this.quarantineUnreadableStore()
      await atomicWriteText(this.file, JSON.stringify({ version: 1, owners: records }), { mode: 0o600 })
      this.records = records
      if (!value && previous) this.undoLeases.set(undoKey, { owner, value: previous, expiresAt: Date.now() + 30_000 })
      if (value) this.undoLeases.delete(undoKey)
    })
    this.queue = operation.catch(() => undefined)
    await operation
  }
  async paths(owner?: string, options: { includeAgentPaths?: boolean } = {}): Promise<string[]> {
    await this.queue
    const records = await this.load()
    const owners = owner === undefined ? Object.values(records) : [Object.hasOwn(records, owner) ? records[owner]! : {}]
    for (const [key, lease] of this.undoLeases) {
      if (lease.expiresAt <= Date.now()) this.undoLeases.delete(key)
      else if (owner === undefined || lease.owner === owner) owners.push({ undo: lease.value })
    }
    return owners.flatMap((drafts) =>
      Object.values(drafts).flatMap((draft) =>
        draft.attachments.flatMap((a) => [
          a.path,
          ...(options.includeAgentPaths !== false && a.agentPath ? [a.agentPath] : []),
        ]),
      ),
    )
  }
}
