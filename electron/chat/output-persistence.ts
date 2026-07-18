import type { ArtifactBundleStore, ArtifactBundles } from "./artifact-bundles.ts"
import type { AuthorizationOverlayStore, AuthorizationOverlays } from "./authorization.ts"
import type { ArtifactBundle, AuthorizationInfo } from "./common.ts"
import type { StoppedGenerationStore, StoppedGenerations } from "./stopped-generations.ts"
import type { StoredTurnOutputRecord, TurnOutputRecords, TurnOutputStore } from "./turn-outputs.ts"

import { logDiagnostic } from "../diagnostics-log.ts"
import { recordArtifactBundle } from "./artifact-bundles.ts"
import { recordAuthorizationOverlay } from "./authorization.ts"
import { recordStoppedGeneration } from "./stopped-generations.ts"
import { recordTurnOutput } from "./turn-outputs.ts"

export class OutputPersistence {
  private transientArtifactBundles: ArtifactBundles = new Map()
  private transientTurnOutputs: TurnOutputRecords = new Map()
  private authorizationOverlays: AuthorizationOverlays = new Map()
  private authorizationLoaded = false
  private authorizationLoad: Promise<void> | null = null
  private mutationQueue: Promise<void> = Promise.resolve()
  private revision = 0
  private stoppedGenerations: StoppedGenerations = new Map()
  private stoppedLoaded = false
  private stoppedLoad: Promise<void> | null = null
  private readonly stores: {
    artifactBundle?: ArtifactBundleStore
    authorization?: AuthorizationOverlayStore
    stoppedGeneration?: StoppedGenerationStore
    turnOutput?: TurnOutputStore
  }
  private readonly onOutputPathsChanged: () => void

  public constructor(
    stores: {
      artifactBundle?: ArtifactBundleStore
      authorization?: AuthorizationOverlayStore
      stoppedGeneration?: StoppedGenerationStore
      turnOutput?: TurnOutputStore
    },
    onOutputPathsChanged: () => void,
  ) {
    this.stores = stores
    this.onOutputPathsChanged = onOutputPathsChanged
  }

  public reset(): void {
    this.revision += 1
    this.transientArtifactBundles.clear()
    this.transientTurnOutputs.clear()
    this.authorizationOverlays.clear()
    this.authorizationLoaded = false
    this.authorizationLoad = null
    this.stoppedGenerations.clear()
    this.stoppedLoaded = false
    this.stoppedLoad = null
  }

  public readTurnOutputs(): Promise<TurnOutputRecords> {
    return this.stores.turnOutput?.read() ?? Promise.resolve(this.transientTurnOutputs)
  }

  public readArtifactBundles(): Promise<ArtifactBundles> {
    return this.stores.artifactBundle?.read() ?? Promise.resolve(this.transientArtifactBundles)
  }

  public async recordArtifactBundle(bundle: ArtifactBundle): Promise<void> {
    if (this.stores.artifactBundle) await this.stores.artifactBundle.record(bundle)
    else recordArtifactBundle(this.transientArtifactBundles, bundle)
    this.onOutputPathsChanged()
  }

  public async recordTurnOutput(record: StoredTurnOutputRecord): Promise<void> {
    if (this.stores.turnOutput) await this.stores.turnOutput.record(record)
    else recordTurnOutput(this.transientTurnOutputs, record)
    this.onOutputPathsChanged()
  }

  public async recordAuthorization(sessionId: string, messageId: string, partId: string, value: AuthorizationInfo) {
    await this.enqueueMutation(async (revision) => {
      await this.ensureAuthorizationLoaded()
      if (revision !== this.revision) return
      if (!recordAuthorizationOverlay(this.authorizationOverlays, sessionId, messageId, partId, value)) return
      await this.stores.authorization?.write(cloneAuthorizationOverlays(this.authorizationOverlays))
    })
  }

  public async recordStopped(sessionId: string, messageId: string, partIds: string[], stoppedAt = Date.now()) {
    await this.enqueueMutation(async (revision) => {
      await this.ensureStoppedLoaded()
      if (revision !== this.revision) return
      if (!recordStoppedGeneration(this.stoppedGenerations, sessionId, messageId, partIds, stoppedAt)) return
      await this.stores.stoppedGeneration?.write(cloneStoppedGenerations(this.stoppedGenerations))
    })
  }

  public async removeSession(sessionId: string): Promise<void> {
    await this.enqueueMutation(async (revision) => {
      await Promise.all([this.ensureAuthorizationLoaded(), this.ensureStoppedLoaded()])
      if (revision !== this.revision) return
      const authorizationChanged = this.authorizationOverlays.delete(sessionId)
      const stoppedChanged = this.stoppedGenerations.delete(sessionId)
      await Promise.all([
        authorizationChanged
          ? this.stores.authorization?.write(cloneAuthorizationOverlays(this.authorizationOverlays))
          : undefined,
        stoppedChanged
          ? this.stores.stoppedGeneration?.write(cloneStoppedGenerations(this.stoppedGenerations))
          : undefined,
      ])
    })
  }

  public async overlaysFor(sessionId: string) {
    await this.mutationQueue
    await this.ensureAuthorizationLoaded()
    return this.authorizationOverlays.get(sessionId)
  }

  public async stoppedFor(sessionId: string) {
    await this.mutationQueue
    await this.ensureStoppedLoaded()
    return this.stoppedGenerations.get(sessionId)
  }

  private async ensureAuthorizationLoaded(): Promise<void> {
    if (this.authorizationLoaded) return
    if (this.authorizationLoad) return this.authorizationLoad
    const revision = this.revision
    const load = (async () => {
      const overlays = (await this.stores.authorization?.read()) ?? new Map()
      if (revision !== this.revision) return
      this.authorizationOverlays = overlays
      this.authorizationLoaded = true
    })()
    this.authorizationLoad = load
    try {
      await load
    } finally {
      if (this.authorizationLoad === load) this.authorizationLoad = null
    }
  }

  private async ensureStoppedLoaded(): Promise<void> {
    if (this.stoppedLoaded) return
    if (this.stoppedLoad) return this.stoppedLoad
    const revision = this.revision
    const load = (async () => {
      const stopped = (await this.stores.stoppedGeneration?.read()) ?? new Map()
      if (revision !== this.revision) return
      this.stoppedGenerations = stopped
      this.stoppedLoaded = true
    })()
    this.stoppedLoad = load
    try {
      await load
    } finally {
      if (this.stoppedLoad === load) this.stoppedLoad = null
    }
  }

  private async enqueueMutation(mutation: (revision: number) => Promise<void>): Promise<void> {
    const revision = this.revision
    const queued = this.mutationQueue
      .catch((error: unknown) => {
        console.warn("[wanta] previous output persistence mutation failed:", error)
        logDiagnostic("chat-service", "previous queued write failed", { error, scope: "output persistence" }, "warn")
      })
      .then(async () => {
        if (revision === this.revision) await mutation(revision)
      })
    this.mutationQueue = queued.then(
      () => undefined,
      () => undefined,
    )
    await queued
  }
}

function cloneAuthorizationOverlays(records: AuthorizationOverlays): AuthorizationOverlays {
  return new Map(
    [...records].map(([sessionId, messages]) => [
      sessionId,
      new Map(
        [...messages].map(([messageId, parts]) => [
          messageId,
          new Map([...parts].map(([partId, value]) => [partId, { ...value }])),
        ]),
      ),
    ]),
  )
}

function cloneStoppedGenerations(records: StoppedGenerations): StoppedGenerations {
  return new Map(
    [...records].map(([sessionId, messages]) => [
      sessionId,
      new Map(
        [...messages].map(([messageId, record]) => [
          messageId,
          { partIds: new Set(record.partIds), stoppedAt: record.stoppedAt },
        ]),
      ),
    ]),
  )
}
