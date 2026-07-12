import type { GitTurnBaseline } from "../git/turn-diff.ts"
import type { ArtifactSessionBaseline } from "./artifact-bundles.ts"

export interface ActiveTurnOutput {
  artifactBaseline?: ArtifactSessionBaseline
  artifactRoot: string
  createdAt: number
  generationId: string
  messageId?: string
  processRoot: string
  projectBaseline?: GitTurnBaseline
  projectRoot?: string
  requestText: string
}

export class TurnOutputRegistry {
  private pendingArtifactDirs = new Map<string, string[]>()
  private pendingProcessDirs = new Map<string, string[]>()
  // 按 generation id 索引，避免旧 generation 的 late cleanup 误删同 session 的新 turn output。
  private activeTurns = new Map<string, ActiveTurnOutput>()
  private readonly generationIdForSession: (sessionId: string) => string | undefined
  private readonly onRootsChanged: () => void

  public constructor(options: {
    generationIdForSession: (sessionId: string) => string | undefined
    onRootsChanged: () => void
  }) {
    this.generationIdForSession = options.generationIdForSession
    this.onRootsChanged = options.onRootsChanged
  }

  public clear(): void {
    this.pendingArtifactDirs.clear()
    this.pendingProcessDirs.clear()
    this.activeTurns.clear()
  }

  public get size(): number {
    return this.pendingArtifactDirs.size + this.pendingProcessDirs.size + this.activeTurns.size
  }

  public pendingSessionIds(): string[] {
    return [...new Set([...this.pendingArtifactDirs.keys(), ...this.pendingProcessDirs.keys()])]
  }

  public activeValues(): IterableIterator<ActiveTurnOutput> {
    return this.activeTurns.values()
  }

  public set(generationId: string, active: ActiveTurnOutput): void {
    this.activeTurns.set(generationId, active)
    this.onRootsChanged()
  }

  public get(generationId: string): ActiveTurnOutput | undefined {
    return this.activeTurns.get(generationId)
  }

  public forSession(sessionId: string): ActiveTurnOutput | undefined {
    const generationId = this.generationIdForSession(sessionId)
    return generationId ? this.activeTurns.get(generationId) : undefined
  }

  public delete(sessionId: string, generationId = this.generationIdForSession(sessionId)): boolean {
    if (!generationId || !this.activeTurns.delete(generationId)) return false
    this.onRootsChanged()
    return true
  }

  public enqueue(sessionId: string, artifactDir: string, processDir: string): void {
    this.enqueuePath(this.pendingArtifactDirs, sessionId, artifactDir)
    this.enqueuePath(this.pendingProcessDirs, sessionId, processDir)
  }

  public consume(sessionId: string): { artifactRoot?: string; processRoot?: string } {
    return {
      artifactRoot: this.consumePath(this.pendingArtifactDirs, sessionId),
      processRoot: this.consumePath(this.pendingProcessDirs, sessionId),
    }
  }

  public removePending(sessionId: string, artifactDir?: string, processDir?: string): void {
    if (artifactDir) this.removePath(this.pendingArtifactDirs, sessionId, artifactDir)
    if (processDir) this.removePath(this.pendingProcessDirs, sessionId, processDir)
  }

  public clearPending(sessionId: string): void {
    this.pendingArtifactDirs.delete(sessionId)
    this.pendingProcessDirs.delete(sessionId)
  }

  private enqueuePath(store: Map<string, string[]>, sessionId: string, path: string): void {
    const queue = store.get(sessionId) ?? []
    queue.push(path)
    store.set(sessionId, queue)
  }

  private consumePath(store: Map<string, string[]>, sessionId: string): string | undefined {
    const queue = store.get(sessionId)
    const path = queue?.shift()
    if (!queue || queue.length === 0) store.delete(sessionId)
    return path
  }

  private removePath(store: Map<string, string[]>, sessionId: string, path: string): void {
    const queue = store.get(sessionId)
    if (!queue) return
    const next = queue.filter((item) => item !== path)
    if (next.length === 0) store.delete(sessionId)
    else store.set(sessionId, next)
  }
}
