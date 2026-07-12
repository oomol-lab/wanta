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
  private authorizationWrite: Promise<void> = Promise.resolve()
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
    await this.ensureAuthorizationLoaded()
    if (!recordAuthorizationOverlay(this.authorizationOverlays, sessionId, messageId, partId, value)) return
    const write = this.authorizationWrite
      .catch((error: unknown) => {
        console.warn("[wanta] previous authorization overlay write failed:", error)
        logDiagnostic("chat-service", "previous queued write failed", { error, scope: "authorization overlay" }, "warn")
      })
      .then(() => this.stores.authorization?.write(this.authorizationOverlays))
    this.authorizationWrite = write.then(
      () => undefined,
      () => undefined,
    )
    await write
  }

  public async recordStopped(sessionId: string, messageId: string, partIds: string[], stoppedAt = Date.now()) {
    await this.ensureStoppedLoaded()
    if (!recordStoppedGeneration(this.stoppedGenerations, sessionId, messageId, partIds, stoppedAt)) return
    await this.stores.stoppedGeneration?.write(this.stoppedGenerations)
  }

  public async overlaysFor(sessionId: string) {
    await this.ensureAuthorizationLoaded()
    return this.authorizationOverlays.get(sessionId)
  }

  public async stoppedFor(sessionId: string) {
    await this.ensureStoppedLoaded()
    return this.stoppedGenerations.get(sessionId)
  }

  private async ensureAuthorizationLoaded(): Promise<void> {
    if (this.authorizationLoaded) return
    if (this.authorizationLoad) return this.authorizationLoad
    this.authorizationLoad = (async () => {
      this.authorizationOverlays = (await this.stores.authorization?.read()) ?? new Map()
      this.authorizationLoaded = true
      this.authorizationLoad = null
    })()
    return this.authorizationLoad
  }

  private async ensureStoppedLoaded(): Promise<void> {
    if (this.stoppedLoaded) return
    if (this.stoppedLoad) return this.stoppedLoad
    this.stoppedLoad = (async () => {
      this.stoppedGenerations = (await this.stores.stoppedGeneration?.read()) ?? new Map()
      this.stoppedLoaded = true
      this.stoppedLoad = null
    })()
    return this.stoppedLoad
  }
}
