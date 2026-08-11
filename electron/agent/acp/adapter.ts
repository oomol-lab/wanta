import type { AgentPermissionMode, ChatPermissionReply, ChatPermissionRequest } from "../../chat/common.ts"
import type {
  AgentSendOptions,
  CancelAgentInput,
  PermissionResponseAgentInput,
  PromptAgentInput,
  SetEffortAgentInput,
  SetModelAgentInput,
} from "../contract/input.ts"
import type { AgentProfile } from "../contract/profile.ts"
import type { ExternalAgentRuntimeStatus } from "../external/probe.ts"
import type { ExternalAgentCatalog, ExternalAgentCatalogOption } from "../external/status.ts"
import type { AcpAgentKind, AcpAgentRegistration } from "./registry.ts"
import type { AcpSessionTranslator } from "./translator.ts"
import type {
  ClientConnection,
  ContentBlock,
  InitializeResponse,
  PermissionOption,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  Stream,
} from "@agentclientprotocol/sdk"

import { client, ndJsonStream, PROTOCOL_VERSION, RequestError } from "@agentclientprotocol/sdk"
import { spawn } from "node:child_process"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Readable, Writable } from "node:stream"
import { pathToFileURL } from "node:url"
import { errorMessage, logDiagnostic } from "../../diagnostics-log.ts"
import { AGENT_PROFILES } from "../contract/profile.ts"
import { ExternalAgentAdapter } from "../external/adapter-base.ts"
import { externalSessionUuid } from "../external/session-id.ts"
import { createAcpSessionTranslator } from "./translator.ts"

// Generic ACP agent adapter (BYOA phase 2).
//
// ONE adapter instance per registered ACP agent kind; the registry entry is the
// only per-agent variation (no code branches per agent). One subprocess and one
// ACP connection per instance, spawned lazily on the first prompt; ACP
// multiplexes sessions over it. Wanta session ids map 1:1 to ACP session ids
// and every emitted event carries the Wanta id.
//
// Verified against @agentclientprotocol/sdk@1.3.0 (dist/acp.d.ts,
// dist/schema/types.gen.d.ts, dist/jsonrpc.js):
// - `ndJsonStream(output, input)` takes WHATWG web streams; Node child pipes
//   are wrapped with Writable.toWeb / Readable.toWeb.
// - The modern `client()` builder registers handlers by method literal and
//   `connect(stream)` returns a ClientConnection whose `.agent` context sends
//   agent-side requests. `initialize` is an explicit request, not automatic.
// - `mcpServers` is a REQUIRED field on session/new (pass []).
// - auth_required is RequestError code -32000; request cancellation is -32800.

const ACP_AUTH_REQUIRED_CODE = -32000
const ACP_REQUEST_CANCELLED_CODE = -32800
const PROBE_CACHE_TTL_MS = 30_000

/** Test seam: a connected ACP wire plus subprocess lifecycle hooks. */
export interface AcpTransport {
  stream: Stream
  dispose: () => void
  onExit?: (cb: (info: { code: number | null }) => void) => void
}

export interface AcpAdapterOptions {
  kind: AcpAgentKind
  registration: AcpAgentRegistration
  /** Binary path + login state probe; results are cached for 30 seconds. */
  probe: () => Promise<ExternalAgentRuntimeStatus>
  /** Per-session cwd fallback; <scratchRootDir>/<sessionUuid> is created on demand. */
  scratchRootDir: string
  /** Directory for persisted per-session transcripts; omitted = in-memory only. */
  transcriptDir?: string
  /**
   * Test seam: produce a connected ACP stream plus a dispose fn. The default
   * spawns the probed binary with registration.acpArgs over stdio.
   */
  connect?: () => Promise<AcpTransport>
}

interface AcpConnectionHandle {
  connection: ClientConnection
  dispose: () => void
  /** Set once the connection is torn down so loss handling runs exactly once. */
  lost: boolean
}

/** In-flight prompt marker; settled exactly once by resolve/reject/loss. */
interface AcpTurn {
  settled: boolean
}

interface AcpSessionState {
  wantaSessionId: string
  acpSessionId: string
  translator: AcpSessionTranslator
  /** Mode the session started in; restored on permission mode "default". */
  initialModeId?: string
  availableModeIds: readonly string[]
  /** Select-type config options by normalized axis (ACP v1.3 configOptions). */
  configSelects: AcpConfigSelects
  /** True between session/cancel and the turn settling; gates permission outcomes. */
  cancelling: boolean
  activeTurn?: AcpTurn
}

/** One select-type session config option (model or reasoning effort). */
interface AcpConfigSelect {
  configId: string
  /**
   * Wire channel for applying a choice: v1.3 session/set_config_option, or the
   * older unstable session/set_model (the shape codex-acp 1.1.14 and grok 1.0
   * actually ship, carried as `models` on session/new).
   */
  via: "config_option" | "set_model"
  options: ExternalAgentCatalogOption[]
  currentValue?: string
  /** Value observed at session creation; the reset target for "agent default". */
  initialValue?: string
}

interface AcpConfigSelects {
  model?: AcpConfigSelect
  effort?: AcpConfigSelect
}

/**
 * Structural parse of ACP session config options into the two axes Wanta
 * surfaces. Categories follow the v1.3 vocabulary ("model", "thought_level");
 * grouped select options are flattened.
 */
function parseConfigSelects(configOptions: unknown): AcpConfigSelects {
  const selects: AcpConfigSelects = {}
  if (!Array.isArray(configOptions)) {
    return selects
  }
  for (const raw of configOptions) {
    if (!raw || typeof raw !== "object") {
      continue
    }
    const option = raw as {
      type?: unknown
      id?: unknown
      category?: unknown
      currentValue?: unknown
      options?: unknown
    }
    if (option.type !== "select" || typeof option.id !== "string") {
      continue
    }
    const axis = option.category === "model" ? "model" : option.category === "thought_level" ? "effort" : undefined
    if (!axis || selects[axis]) {
      continue
    }
    const entries = Array.isArray(option.options) ? option.options : []
    const flat = entries.flatMap((entry: unknown) => {
      if (entry && typeof entry === "object" && Array.isArray((entry as { options?: unknown }).options)) {
        return (entry as { options: unknown[] }).options
      }
      return [entry]
    })
    const options: ExternalAgentCatalogOption[] = []
    const seenIds = new Set<string>()
    for (const entry of flat) {
      if (!entry || typeof entry !== "object") {
        continue
      }
      const item = entry as { value?: unknown; name?: unknown; description?: unknown }
      if (typeof item.value !== "string" || item.value.length === 0 || seenIds.has(item.value)) {
        continue
      }
      seenIds.add(item.value)
      options.push({
        id: item.value,
        label: typeof item.name === "string" && item.name ? item.name : item.value,
        ...(typeof item.description === "string" && item.description ? { description: item.description } : {}),
      })
    }
    // A select with zero usable options carries no catalog information; keep
    // whatever we knew instead of wiping the pickers (matches parseModelState).
    if (options.length === 0) {
      continue
    }
    const currentValue = typeof option.currentValue === "string" ? option.currentValue : undefined
    selects[axis] = {
      configId: option.id,
      via: "config_option",
      options,
      ...(currentValue !== undefined ? { currentValue, initialValue: currentValue } : {}),
    }
  }
  return selects
}

/**
 * Structural parse of the unstable `models` state ({availableModels, currentModelId})
 * that pre-configOptions ACP agents return on session/new.
 */
function parseModelState(models: unknown): AcpConfigSelect | undefined {
  if (!models || typeof models !== "object") {
    return undefined
  }
  const shape = models as { availableModels?: unknown; currentModelId?: unknown }
  if (!Array.isArray(shape.availableModels)) {
    return undefined
  }
  const options: ExternalAgentCatalogOption[] = []
  const seenIds = new Set<string>()
  for (const entry of shape.availableModels) {
    if (!entry || typeof entry !== "object") {
      continue
    }
    const model = entry as { modelId?: unknown; name?: unknown; description?: unknown }
    if (typeof model.modelId !== "string" || model.modelId.length === 0 || seenIds.has(model.modelId)) {
      continue
    }
    seenIds.add(model.modelId)
    options.push({
      id: model.modelId,
      label: typeof model.name === "string" && model.name ? model.name : model.modelId,
      ...(typeof model.description === "string" && model.description ? { description: model.description } : {}),
    })
  }
  if (options.length === 0) {
    return undefined
  }
  const currentValue = typeof shape.currentModelId === "string" ? shape.currentModelId : undefined
  return {
    configId: "model",
    via: "set_model",
    options,
    ...(currentValue !== undefined ? { currentValue, initialValue: currentValue } : {}),
  }
}

/** Selects reported by a session/new (or load) response: configOptions first, models shape as fallback. */
function parseSessionSelects(response: unknown): AcpConfigSelects {
  const body = response as { configOptions?: unknown; models?: unknown } | null
  const selects = parseConfigSelects(body?.configOptions)
  if (!selects.model) {
    const modelState = parseModelState(body?.models)
    if (modelState) {
      selects.model = modelState
    }
  }
  return selects
}

interface PendingAcpPermission {
  wantaSessionId: string
  options: readonly PermissionOption[]
  resolve: (response: RequestPermissionResponse) => void
}

function requestErrorCode(error: unknown): number | undefined {
  if (error instanceof RequestError) {
    return error.code
  }
  if (error !== null && typeof error === "object" && typeof (error as { code?: unknown }).code === "number") {
    return (error as { code: number }).code
  }
  return undefined
}

/**
 * Map a Wanta permission reply onto the agent-offered options. Falls back along
 * same-direction kinds only; when no option matches the direction the outcome
 * degrades to "cancelled" rather than picking an opposite-direction option.
 */
/**
 * The prompt as ACP content blocks: the user text plus one resource_link per
 * attachment. resource_link is baseline prompt capability (unlike image/audio,
 * which need a capability declaration), so the agent resolves the file with
 * its own tools regardless of what it advertised at initialize.
 */
function promptContentBlocks(input: PromptAgentInput): ContentBlock[] {
  const blocks: ContentBlock[] = [{ type: "text", text: input.text }]
  for (const attachment of input.attachments ?? []) {
    const target = attachment.agentPath?.trim() || attachment.path
    blocks.push({
      type: "resource_link",
      uri: pathToFileURL(target).href,
      name: attachment.agentName?.trim() || attachment.name,
      ...(attachment.agentMime || attachment.mime ? { mimeType: attachment.agentMime ?? attachment.mime } : {}),
    })
  }
  return blocks
}

function selectPermissionOptionId(
  options: readonly PermissionOption[],
  reply: ChatPermissionReply,
): string | undefined {
  const byKind = (kind: PermissionOption["kind"]): string | undefined =>
    options.find((option) => option.kind === kind)?.optionId
  switch (reply) {
    case "once":
      return byKind("allow_once") ?? byKind("allow_always")
    case "always":
      return byKind("allow_always") ?? byKind("allow_once")
    case "reject":
      return byKind("reject_once") ?? byKind("reject_always")
  }
}

export class AcpAgentAdapter extends ExternalAgentAdapter {
  private readonly options: AcpAdapterOptions
  private connectionHandle: AcpConnectionHandle | undefined
  private connectionPromise: Promise<AcpConnectionHandle> | undefined
  private readonly sessionsByWantaId = new Map<string, AcpSessionState>()
  private readonly wantaIdByAcpId = new Map<string, string>()
  private readonly sessionCreationByWantaId = new Map<string, Promise<AcpSessionState>>()
  private readonly pendingAcpPermissions = new Map<string, PendingAcpPermission>()
  /** Model/effort choices made before the ACP session exists; applied on creation. */
  private readonly desiredSelections = new Map<string, { model?: string; effort?: string }>()
  /** Last projected Wanta permission mode per session, applied at creation. */
  private readonly desiredPermissionModes = new Map<string, AgentPermissionMode>()
  private catalog: ExternalAgentCatalog | undefined
  private catalogWarmup: Promise<void> | undefined
  private permissionSeq = 0
  private probeCache: { at: number; promise: Promise<ExternalAgentRuntimeStatus> } | undefined

  constructor(options: AcpAdapterOptions) {
    super(options.transcriptDir ? { transcriptDir: options.transcriptDir } : {})
    this.options = options
  }

  public get kind(): AcpAgentKind {
    return this.options.kind
  }

  public get profile(): AgentProfile {
    return AGENT_PROFILES[this.options.kind]
  }

  public runtimeStatus(): Promise<ExternalAgentRuntimeStatus> {
    const now = Date.now()
    if (this.probeCache && now - this.probeCache.at < PROBE_CACHE_TTL_MS) {
      return this.probeCache.promise.then((status) => this.decorateStatus(status))
    }
    const promise = this.options.probe()
    const entry = { at: now, promise }
    this.probeCache = entry
    promise.catch(() => {
      // A failed probe must not be cached for 30 seconds.
      if (this.probeCache === entry) {
        this.probeCache = undefined
      }
    })
    return promise.then((status) => this.decorateStatus(status))
  }

  private decorateStatus(status: ExternalAgentRuntimeStatus): ExternalAgentRuntimeStatus {
    return this.catalog ? { ...status, catalog: this.catalog } : status
  }

  /** Merge freshly reported selects into a session, preserving the creation-time reset target. */
  private mergeConfigSelects(session: AcpSessionState, updated: AcpConfigSelects): void {
    if (!updated.model && !updated.effort) {
      return
    }
    const preserve = (
      next: AcpConfigSelect | undefined,
      previous: AcpConfigSelect | undefined,
    ): AcpConfigSelect | undefined => {
      if (!next) {
        return previous
      }
      const initialValue = previous?.initialValue ?? next.initialValue
      return { ...next, ...(initialValue !== undefined ? { initialValue } : {}) }
    }
    session.configSelects = {
      model: preserve(updated.model, session.configSelects.model),
      effort: preserve(updated.effort, session.configSelects.effort),
    }
    this.updateCatalogFromSelects(session.configSelects)
  }

  /** Fold a session's parsed config selects into the adapter-level catalog. */
  private updateCatalogFromSelects(selects: AcpConfigSelects): void {
    if (!selects.model && !selects.effort) {
      return
    }
    this.catalog = {
      models: selects.model?.options ?? this.catalog?.models ?? [],
      efforts: selects.effort?.options ?? this.catalog?.efforts ?? [],
      ...(selects.model?.initialValue !== undefined
        ? { defaultModelId: selects.model.initialValue }
        : this.catalog?.defaultModelId !== undefined
          ? { defaultModelId: this.catalog.defaultModelId }
          : {}),
      ...(selects.effort?.initialValue !== undefined
        ? { defaultEffortId: selects.effort.initialValue }
        : this.catalog?.defaultEffortId !== undefined
          ? { defaultEffortId: this.catalog.defaultEffortId }
          : {}),
    }
  }

  protected async handleStart(): Promise<void> {
    // The subprocess is spawned lazily on the first prompt.
  }

  protected async handleStop(): Promise<void> {
    // BaseAgentAdapter.teardown() already emitted permissionReplied for parked
    // requests; here we settle the protocol side with the cancelled outcome.
    const settled = this.settlePendingPermissions(() => true, false)
    if (settled > 0) {
      // Give the JSON-RPC responders one macrotask to flush the cancelled
      // outcomes onto the wire before the connection is torn down.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    // Closing the connection rejects in-flight session/prompt requests; mark
    // those turns settled first so trackTurn's rejection path stays silent
    // instead of broadcasting a spurious agentError for a deliberate stop.
    for (const session of this.sessionsByWantaId.values()) {
      if (session.activeTurn && !session.activeTurn.settled) {
        session.activeTurn.settled = true
        session.activeTurn = undefined
      }
    }
    this.disposeConnection()
  }

  protected override handleForgetSession(sessionId: string): void {
    this.desiredSelections.delete(sessionId)
    this.desiredPermissionModes.delete(sessionId)
    const session = this.sessionsByWantaId.get(sessionId)
    if (session) {
      this.wantaIdByAcpId.delete(session.acpSessionId)
      this.sessionsByWantaId.delete(sessionId)
    }
    // The session is gone; settle its parked resolvers without re-emitting.
    this.settlePendingPermissions((pending) => pending.wantaSessionId === sessionId, false)
  }

  protected async handlePrompt(input: PromptAgentInput, options?: AgentSendOptions): Promise<void> {
    if (options?.signal?.aborted) {
      return
    }
    // Draft-time choices ride the first prompt; createAcpSession applies them.
    if (input.agentModelId !== undefined || input.agentEffortId !== undefined) {
      const desired = this.desiredSelections.get(input.sessionId) ?? {}
      if (input.agentModelId !== undefined) {
        desired.model = input.agentModelId
      }
      if (input.agentEffortId !== undefined) {
        desired.effort = input.agentEffortId
      }
      this.desiredSelections.set(input.sessionId, desired)
    }
    const displayName = this.options.registration.displayName
    let handle: AcpConnectionHandle
    try {
      handle = await this.ensureConnection()
    } catch (error) {
      const message = errorMessage(error)
      this.emit({ event: "agentError", data: { sessionId: input.sessionId, message } })
      throw error instanceof Error ? error : new Error(message)
    }
    let session: AcpSessionState
    try {
      session = await this.ensureAcpSession(handle, input)
    } catch (error) {
      const message = this.isAuthRequiredError(error)
        ? this.signInRequiredMessage()
        : `${displayName} could not open a session: ${errorMessage(error)}`
      this.emit({ event: "agentError", data: { sessionId: input.sessionId, message } })
      throw new Error(message)
    }
    if (options?.signal?.aborted) {
      return
    }
    if (session.activeTurn && !session.activeTurn.settled) {
      throw new Error(`${this.kind}: a prompt is already in flight for this session`)
    }
    this.emitUserTurn(input)
    session.translator.noteTurnStarted()
    session.cancelling = false
    const turn: AcpTurn = { settled: false }
    session.activeTurn = turn
    const promptPromise = handle.connection.agent.request("session/prompt", {
      sessionId: session.acpSessionId,
      prompt: promptContentBlocks(input),
    })
    this.trackTurn(session, turn, promptPromise, options?.signal)
    // Resolve on dispatch (submission ack); completion arrives as messageCompleted.
  }

  protected async handleCancel(input: CancelAgentInput, options?: AgentSendOptions): Promise<void> {
    if (options?.signal?.aborted) {
      return
    }
    await this.cancelSession(input.sessionId)
  }

  protected override async handlePermissionResponse(
    input: PermissionResponseAgentInput,
    options?: AgentSendOptions,
  ): Promise<void> {
    if (options?.signal?.aborted) {
      return
    }
    const pending = this.pendingAcpPermissions.get(input.requestId)
    if (!pending) {
      throw new Error(`${this.kind}: unknown permission request ${input.requestId}`)
    }
    this.pendingAcpPermissions.delete(input.requestId)
    const optionId = selectPermissionOptionId(pending.options, input.reply)
    if (optionId === undefined) {
      pending.resolve({ outcome: { outcome: "cancelled" } })
    } else {
      pending.resolve({ outcome: { outcome: "selected", optionId } })
    }
    this.emit({
      event: "permissionReplied",
      data: { sessionId: pending.wantaSessionId, requestId: input.requestId },
    })
  }

  protected override async handleSetModel(input: SetModelAgentInput): Promise<void> {
    if (!this.profile.inputs.setModel) {
      return this.rejectUnsupportedInput("set-model")
    }
    await this.applyConfigSelection(input.sessionId, "model", input.modelId)
  }

  protected override async handleSetEffort(input: SetEffortAgentInput): Promise<void> {
    if (!this.profile.inputs.setEffort) {
      return this.rejectUnsupportedInput("set-effort")
    }
    await this.applyConfigSelection(input.sessionId, "effort", input.effortId)
  }

  /**
   * Stash the choice for pre-session application and switch the live session
   * when one exists. Absent value = reset to the creation-time default. A
   * failed live switch restores the previous stash so a future session
   * recreation never resurrects a value the agent rejected.
   */
  private async applyConfigSelection(
    sessionId: string,
    axis: keyof AcpConfigSelects,
    value: string | undefined,
  ): Promise<void> {
    const desired = this.desiredSelections.get(sessionId) ?? {}
    const previous = desired[axis]
    if (value === undefined) {
      delete desired[axis]
    } else {
      desired[axis] = value
    }
    this.desiredSelections.set(sessionId, desired)
    const session = this.sessionsByWantaId.get(sessionId)
    const handle = this.connectionHandle
    if (!session || !handle || handle.lost) {
      return
    }
    const target = value ?? session.configSelects[axis]?.initialValue
    if (target === undefined || session.configSelects[axis]?.currentValue === target) {
      return
    }
    try {
      await this.setConfigValue(handle, session, axis, target)
    } catch (error) {
      // Only roll back if the stash still holds THIS call's value; a slower
      // rejection must never clobber a newer accepted choice.
      const latest = this.desiredSelections.get(sessionId) ?? desired
      if (latest[axis] === value) {
        if (previous === undefined) {
          delete latest[axis]
        } else {
          latest[axis] = previous
        }
      }
      throw error
    }
  }

  /**
   * Pre-populate the model/effort catalog before any user session exists: open
   * a throwaway ACP session, read its selects, close it. The spawned agent
   * connection is app-lifetime and reused by real sessions afterwards.
   */
  public override async warmCatalog(): Promise<void> {
    if (!this.profile.inputs.setModel && !this.profile.inputs.setEffort) {
      return
    }
    if (this.catalog && (this.catalog.models.length > 0 || this.catalog.efforts.length > 0)) {
      return
    }
    this.catalogWarmup ??= this.runCatalogWarmup().finally(() => {
      this.catalogWarmup = undefined
    })
    await this.catalogWarmup
  }

  private async runCatalogWarmup(): Promise<void> {
    try {
      const handle = await this.ensureConnection()
      const cwd = await this.ensureScratchDir(`warmup-${this.kind}`)
      const response = await handle.connection.agent.request("session/new", { cwd, mcpServers: [] })
      this.updateCatalogFromSelects(parseSessionSelects(response))
      await handle.connection.agent
        .request("session/close" as never, { sessionId: response.sessionId } as never)
        .catch(() => undefined)
    } catch (error) {
      logDiagnostic("acp-adapter", "catalog warmup failed", { adapter: this.kind, error: errorMessage(error) }, "warn")
    }
  }

  /** Last user-chosen model/effort for a session (renderer read-back after reloads). */
  public override sessionSelection(sessionId: string): { modelId?: string; effortId?: string } {
    const desired = this.desiredSelections.get(sessionId)
    return {
      ...(desired?.model !== undefined ? { modelId: desired.model } : {}),
      ...(desired?.effort !== undefined ? { effortId: desired.effort } : {}),
    }
  }

  /**
   * Best-effort projection of Wanta's permission mode onto the agent's session
   * modes via the registry's mode map; entries the live session does not
   * advertise are skipped.
   */
  public override async applyPermissionMode(sessionId: string, mode: AgentPermissionMode): Promise<void> {
    const modeMap = this.options.registration.permissionModeMap
    if (!modeMap) {
      return
    }
    // The chat layer projects the mode BEFORE the first prompt creates the
    // session; stash it so createAcpSession can apply it, or the whole first
    // turn would run under the agent's own default mode.
    this.desiredPermissionModes.set(sessionId, mode)
    const session = this.sessionsByWantaId.get(sessionId)
    if (!session) {
      return
    }
    const mapped = modeMap[mode]
    const targetModeId = mapped ?? (mode === "default" ? session.initialModeId : undefined)
    if (!targetModeId || !session.availableModeIds.includes(targetModeId)) {
      return
    }
    const handle = this.connectionHandle
    if (!handle || handle.lost) {
      return
    }
    try {
      await handle.connection.agent.request("session/set_mode", {
        sessionId: session.acpSessionId,
        modeId: targetModeId,
      })
    } catch (error) {
      logDiagnostic(
        "acp-adapter",
        "session/set_mode failed",
        { adapter: this.kind, modeId: targetModeId, error: errorMessage(error) },
        "warn",
      )
    }
  }

  private signInRequiredMessage(): string {
    return `${this.options.registration.displayName} requires sign-in. ${this.options.registration.loginHint}`
  }

  private isAuthRequiredError(error: unknown): boolean {
    return requestErrorCode(error) === ACP_AUTH_REQUIRED_CODE
  }

  private async cancelSession(wantaSessionId: string): Promise<void> {
    const session = this.sessionsByWantaId.get(wantaSessionId)
    if (!session) {
      return
    }
    session.cancelling = true
    // Protocol rule: after session/cancel every pending permission request of
    // that turn must be answered with the cancelled outcome.
    this.settlePendingPermissions((pending) => pending.wantaSessionId === wantaSessionId, true)
    const handle = this.connectionHandle
    if (!handle || handle.lost) {
      return
    }
    try {
      await handle.connection.agent.notify("session/cancel", { sessionId: session.acpSessionId })
    } catch (error) {
      logDiagnostic(
        "acp-adapter",
        "session/cancel notification failed",
        { adapter: this.kind, error: errorMessage(error) },
        "warn",
      )
    }
  }

  private trackTurn(
    session: AcpSessionState,
    turn: AcpTurn,
    promptPromise: Promise<PromptResponse>,
    signal?: AbortSignal,
  ): void {
    const wantaSessionId = session.wantaSessionId
    const onAbort = (): void => {
      void this.cancelSession(wantaSessionId)
    }
    signal?.addEventListener("abort", onAbort, { once: true })
    const settle = (): boolean => {
      signal?.removeEventListener("abort", onAbort)
      if (turn.settled) {
        return false
      }
      turn.settled = true
      if (session.activeTurn === turn) {
        session.activeTurn = undefined
      }
      return true
    }
    promptPromise.then(
      () => {
        if (!settle()) {
          return
        }
        this.emit({ event: "messageCompleted", data: { sessionId: wantaSessionId } })
      },
      (error: unknown) => {
        if (!settle()) {
          return
        }
        if (session.cancelling || requestErrorCode(error) === ACP_REQUEST_CANCELLED_CODE) {
          // Cancelled turns still end; the UI must leave the streaming state.
          this.emit({ event: "messageCompleted", data: { sessionId: wantaSessionId } })
          return
        }
        const message = this.isAuthRequiredError(error)
          ? this.signInRequiredMessage()
          : `${this.options.registration.displayName} prompt failed: ${errorMessage(error)}`
        this.emit({ event: "agentError", data: { sessionId: wantaSessionId, message } })
      },
    )
  }

  private async ensureConnection(): Promise<AcpConnectionHandle> {
    if (this.connectionHandle) {
      return this.connectionHandle
    }
    this.connectionPromise ??= this.openConnection()
    const promise = this.connectionPromise
    try {
      return await promise
    } catch (error) {
      if (this.connectionPromise === promise) {
        this.connectionPromise = undefined
      }
      throw error
    }
  }

  private async openConnection(): Promise<AcpConnectionHandle> {
    const displayName = this.options.registration.displayName
    const transport = await (this.options.connect ? this.options.connect() : this.spawnTransport())
    const app = client({ name: "wanta" })
      .onRequest("session/request_permission", (context) => this.onAcpPermissionRequest(context.params))
      .onNotification("session/update", (context) => {
        this.onAcpSessionUpdate(context.params)
      })
    const connection = app.connect(transport.stream)
    const handle: AcpConnectionHandle = { connection, dispose: transport.dispose, lost: false }
    const markLost = (): void => {
      this.handleConnectionLost(handle)
    }
    transport.onExit?.(markLost)
    void connection.closed.then(markLost, markLost)
    let initialize: InitializeResponse
    try {
      initialize = await connection.agent.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      })
    } catch (error) {
      this.teardownHandle(handle)
      throw new Error(`${displayName} failed to initialize the ACP connection: ${errorMessage(error)}`)
    }
    if (initialize.protocolVersion !== PROTOCOL_VERSION) {
      this.teardownHandle(handle)
      throw new Error(
        `${displayName} negotiated ACP protocol version ${initialize.protocolVersion}, ` +
          `but Wanta requires version ${PROTOCOL_VERSION}. Update ${displayName} and retry.`,
      )
    }
    // Loss handling is wired before initialize completes, so a subprocess that
    // dies mid-handshake already ran handleConnectionLost against a handle this
    // method had not stored yet. Storing it now would park a dead connection
    // that never triggers loss handling again (no respawn until stop()).
    if (handle.lost) {
      throw new Error(`${displayName} exited before the ACP connection was ready.`)
    }
    if (!this.isStarted) {
      this.teardownHandle(handle)
      throw new Error(`${this.kind}: adapter stopped while connecting`)
    }
    this.connectionHandle = handle
    this.connectionPromise = undefined
    return handle
  }

  /** Spawn the probed CLI in ACP mode and wrap its stdio as web streams. */
  private async spawnTransport(): Promise<AcpTransport> {
    const registration = this.options.registration
    const status = await this.runtimeStatus()
    if (status.binary.status !== "detected") {
      const detail = status.binary.status === "error" ? ` (${status.binary.message})` : ""
      throw new Error(`${registration.displayName} CLI was not found on this machine${detail}.`)
    }
    const child = spawn(status.binary.path, [...registration.acpArgs], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    })
    if (!child.stdin || !child.stdout) {
      child.kill()
      throw new Error(`${registration.displayName} subprocess did not expose stdio pipes.`)
    }
    // ACP traffic is stdout-only; stderr must be drained so the CLI never
    // blocks on a full pipe.
    child.stderr?.resume()
    // Node web-stream declarations are structurally compatible with the DOM
    // globals the SDK types reference, but nominally distinct; cast once here.
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
    )
    const exitCallbacks: Array<(info: { code: number | null }) => void> = []
    let exited = false
    const fireExit = (code: number | null): void => {
      if (exited) {
        return
      }
      exited = true
      for (const callback of exitCallbacks) {
        callback({ code })
      }
    }
    child.once("exit", (code) => fireExit(code))
    child.once("error", (error) => {
      logDiagnostic("acp-adapter", "ACP subprocess error", { adapter: this.kind, error: errorMessage(error) }, "error")
      fireExit(null)
    })
    return {
      stream,
      dispose: () => {
        if (!exited) {
          child.kill()
        }
      },
      onExit: (callback) => {
        exitCallbacks.push(callback)
      },
    }
  }

  private teardownHandle(handle: AcpConnectionHandle): void {
    handle.lost = true
    try {
      handle.connection.close()
    } catch {
      // Already closed.
    }
    try {
      handle.dispose()
    } catch {
      // Transport already gone.
    }
  }

  private disposeConnection(): void {
    const handle = this.connectionHandle
    this.connectionHandle = undefined
    this.connectionPromise = undefined
    if (handle) {
      // Detached first, so loss handling below skips the error broadcast.
      this.handleConnectionLost(handle)
    }
  }

  /**
   * Subprocess exit or connection close: fail every in-flight turn loudly and
   * clear all connection-scoped state so the next prompt respawns cleanly.
   */
  private handleConnectionLost(handle: AcpConnectionHandle): void {
    if (handle.lost) {
      return
    }
    this.teardownHandle(handle)
    if (this.connectionHandle !== handle) {
      return
    }
    this.connectionHandle = undefined
    this.connectionPromise = undefined
    this.settlePendingPermissions(() => true, true)
    const displayName = this.options.registration.displayName
    for (const session of this.sessionsByWantaId.values()) {
      const turn = session.activeTurn
      if (turn && !turn.settled) {
        turn.settled = true
        session.activeTurn = undefined
        this.emit({
          event: "agentError",
          data: { sessionId: session.wantaSessionId, message: `${displayName} exited unexpectedly` },
        })
      }
    }
    // ACP session ids died with the subprocess; drop the mappings so the next
    // prompt opens fresh sessions on the respawned process.
    this.sessionsByWantaId.clear()
    this.wantaIdByAcpId.clear()
    logDiagnostic("acp-adapter", "ACP connection lost", { adapter: this.kind }, "warn")
  }

  private async ensureAcpSession(handle: AcpConnectionHandle, input: PromptAgentInput): Promise<AcpSessionState> {
    const existing = this.sessionsByWantaId.get(input.sessionId)
    if (existing) {
      return existing
    }
    const pending = this.sessionCreationByWantaId.get(input.sessionId)
    if (pending) {
      return pending
    }
    const creation = this.createAcpSession(handle, input)
    this.sessionCreationByWantaId.set(input.sessionId, creation)
    try {
      return await creation
    } finally {
      this.sessionCreationByWantaId.delete(input.sessionId)
    }
  }

  private async createAcpSession(handle: AcpConnectionHandle, input: PromptAgentInput): Promise<AcpSessionState> {
    const cwd = input.outputProjectRoot ?? (await this.ensureScratchDir(input.sessionId))
    const response = await handle.connection.agent.request("session/new", { cwd, mcpServers: [] })
    const modes = response.modes ?? undefined
    const configSelects = parseSessionSelects(response)
    this.updateCatalogFromSelects(configSelects)
    const session: AcpSessionState = {
      wantaSessionId: input.sessionId,
      acpSessionId: response.sessionId,
      translator: createAcpSessionTranslator(input.sessionId),
      initialModeId: modes?.currentModeId,
      availableModeIds: (modes?.availableModes ?? []).map((mode) => mode.id),
      configSelects,
      cancelling: false,
    }
    this.sessionsByWantaId.set(input.sessionId, session)
    this.wantaIdByAcpId.set(response.sessionId, input.sessionId)
    // Choices made before the session existed apply before the first prompt;
    // failures are logged inside and must not fail session creation.
    const desired = this.desiredSelections.get(input.sessionId)
    if (desired?.model !== undefined) {
      await this.setConfigValue(handle, session, "model", desired.model).catch(() => undefined)
    }
    if (desired?.effort !== undefined) {
      await this.setConfigValue(handle, session, "effort", desired.effort).catch(() => undefined)
    }
    const desiredMode = this.desiredPermissionModes.get(input.sessionId)
    if (desiredMode !== undefined) {
      await this.applyPermissionMode(input.sessionId, desiredMode).catch(() => undefined)
    }
    return session
  }

  /** Apply one axis over the select's wire channel; tolerates agents without that option. */
  private async setConfigValue(
    handle: AcpConnectionHandle,
    session: AcpSessionState,
    axis: keyof AcpConfigSelects,
    value: string,
  ): Promise<void> {
    const select = session.configSelects[axis]
    if (!select) {
      return
    }
    try {
      if (select.via === "set_model") {
        // Unstable pre-configOptions channel; not in the typed method map.
        await handle.connection.agent.request(
          "session/set_model" as never,
          { sessionId: session.acpSessionId, modelId: value } as never,
        )
        select.currentValue = value
        return
      }
      const response = await handle.connection.agent.request("session/set_config_option", {
        sessionId: session.acpSessionId,
        configId: select.configId,
        value,
      })
      select.currentValue = value
      const updated = parseConfigSelects((response as { configOptions?: unknown } | null)?.configOptions)
      this.mergeConfigSelects(session, updated)
    } catch (error) {
      logDiagnostic(
        "acp-adapter",
        "session/set_config_option failed",
        { adapter: this.kind, axis, value, error: errorMessage(error) },
        "warn",
      )
      throw error instanceof Error ? error : new Error(errorMessage(error))
    }
  }

  private async ensureScratchDir(wantaSessionId: string): Promise<string> {
    const uuid = externalSessionUuid(wantaSessionId) ?? wantaSessionId.replace(/[^\w-]/gu, "-")
    const dir = path.join(this.options.scratchRootDir, uuid)
    await mkdir(dir, { recursive: true })
    return dir
  }

  private onAcpSessionUpdate(notification: SessionNotification): void {
    const wantaSessionId = this.wantaIdByAcpId.get(notification.sessionId)
    const session = wantaSessionId !== undefined ? this.sessionsByWantaId.get(wantaSessionId) : undefined
    if (!session) {
      logDiagnostic(
        "acp-adapter",
        "session/update for unknown ACP session",
        { adapter: this.kind, acpSessionId: notification.sessionId, update: notification.update.sessionUpdate },
        "warn",
      )
      return
    }
    // Session-state updates are adapter concerns, not chat-timeline events.
    const update = notification.update as { sessionUpdate: string; [key: string]: unknown }
    if (update.sessionUpdate === "usage_update") {
      const used = typeof update["used"] === "number" && update["used"] > 0 ? update["used"] : 0
      const size = typeof update["size"] === "number" && update["size"] > 0 ? update["size"] : 0
      if (used > 0 || size > 0) {
        this.emit({
          event: "usageUpdated",
          data: {
            sessionId: session.wantaSessionId,
            tokenUsage: {
              total: used,
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
              ...(size > 0 ? { contextWindow: size } : {}),
            },
          },
        })
      }
      return
    }
    if (update.sessionUpdate === "config_option_update") {
      this.mergeConfigSelects(session, parseConfigSelects(update["configOptions"]))
      return
    }
    const events = session.translator.translate(notification.update)
    if (events.length === 0) {
      logDiagnostic(
        "acp-adapter",
        "session/update produced no contract events",
        { adapter: this.kind, update: notification.update.sessionUpdate },
        "trace",
      )
      return
    }
    for (const event of events) {
      this.emit(event)
    }
  }

  private onAcpPermissionRequest(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const wantaSessionId = this.wantaIdByAcpId.get(params.sessionId)
    const session = wantaSessionId !== undefined ? this.sessionsByWantaId.get(wantaSessionId) : undefined
    if (!session || wantaSessionId === undefined) {
      logDiagnostic(
        "acp-adapter",
        "permission request for unknown ACP session",
        { adapter: this.kind, acpSessionId: params.sessionId },
        "warn",
      )
      return Promise.resolve({ outcome: { outcome: "cancelled" } })
    }
    if (session.cancelling || !this.isStarted) {
      // Protocol rule: a cancelled turn answers permission requests with the
      // cancelled outcome. Nothing was surfaced, so no events are emitted.
      return Promise.resolve({ outcome: { outcome: "cancelled" } })
    }
    this.permissionSeq += 1
    const requestId = `acp-perm-${this.permissionSeq}`
    const metadata: Record<string, unknown> = {
      options: params.options,
      toolCallId: params.toolCall.toolCallId,
    }
    if (params.toolCall.rawInput !== undefined) {
      metadata["rawInput"] = params.toolCall.rawInput
    }
    const request: ChatPermissionRequest = {
      id: requestId,
      sessionId: wantaSessionId,
      action: params.toolCall.title ?? "permission",
      resources: (params.toolCall.locations ?? []).map((location) => location.path).slice(0, 3),
      metadata,
    }
    return new Promise<RequestPermissionResponse>((resolve) => {
      this.pendingAcpPermissions.set(requestId, {
        wantaSessionId,
        options: params.options,
        resolve,
      })
      this.emit({ event: "permissionAsked", data: { sessionId: wantaSessionId, request } })
    })
  }

  /** Resolve matching parked permission requests with the cancelled outcome. */
  private settlePendingPermissions(matches: (pending: PendingAcpPermission) => boolean, emitReplied: boolean): number {
    let settled = 0
    // Deleting the current entry while iterating a Map is well-defined.
    for (const [requestId, pending] of this.pendingAcpPermissions) {
      if (!matches(pending)) {
        continue
      }
      this.pendingAcpPermissions.delete(requestId)
      pending.resolve({ outcome: { outcome: "cancelled" } })
      settled += 1
      if (emitReplied) {
        this.emit({
          event: "permissionReplied",
          data: { sessionId: pending.wantaSessionId, requestId },
        })
      }
    }
    return settled
  }
}
