import type { AgentPermissionMode, ChatAttachment, ChatMessage, ChatPermissionRequest } from "../../chat/common.ts"
import type {
  AgentSendOptions,
  CancelAgentInput,
  PermissionResponseAgentInput,
  PromptAgentInput,
  SetEffortAgentInput,
  SetModelAgentInput,
} from "../contract/input.ts"
import type { HostMcpServerProvider } from "../external/host-mcp.ts"
import type { ExternalAgentRuntimeStatus } from "../external/probe.ts"
import type { ExternalAgentCatalog } from "../external/status.ts"
import type {
  CanUseTool,
  PermissionResult,
  PermissionUpdate,
  Query,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk"

import { query } from "@anthropic-ai/claude-agent-sdk"
import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { resolveUserCommandPath } from "../../command-path.ts"
import { errorMessage, logDiagnostic } from "../../diagnostics-log.ts"
import { AGENT_PROFILES, agentLoginHint } from "../contract/profile.ts"
import { ExternalAgentAdapter } from "../external/adapter-base.ts"
import { externalAgentPromptText } from "../external/prompt.ts"
import { externalSessionUuid } from "../external/session-id.ts"
import { createClaudeTurnTranslator, isLocalCommandText } from "./translator.ts"

// Claude Code native adapter (BYOA phase 1).
//
// One live SDK query per Wanta session, created lazily on the first prompt and
// kept in streaming-input mode so later prompts, interrupts, and permission
// mode changes ride the same subprocess. SDK behavior verified against
// @anthropic-ai/claude-agent-sdk@0.3.226 (CLI 2.1.226): control requests
// (interrupt/setPermissionMode) require streaming input, `options.env`
// REPLACES the subprocess env entirely, and `bypassPermissions` requires
// `allowDangerouslySkipPermissions: true` at query creation.

const PROBE_CACHE_TTL_MS = 30_000
const MAX_STDERR_CHUNKS = 40
const LOGIN_HINT = agentLoginHint("claude-code")

export interface ClaudeCodeAdapterOptions {
  /** Probe supplier (binary path + login state). Injected by main; cached by the adapter for 30s. */
  probe: () => Promise<ExternalAgentRuntimeStatus>
  /** Directory for per-session scratch cwd when a session has no project. Created on demand. */
  scratchRootDir: string
  /** Directory for persisted per-session transcripts; omitted = in-memory only. */
  transcriptDir?: string
  /** Host-owned MCP capabilities resolved for the concrete Wanta session. */
  hostMcpServers?: HostMcpServerProvider
  /** Resolves the merged user PATH for the subprocess env (electron/command-path.ts resolveUserCommandPath by default). */
  commandPath?: () => Promise<string>
  /** Test seam: the SDK query function. Defaults to the real `query` from @anthropic-ai/claude-agent-sdk. */
  queryFn?: typeof query
}

/**
 * Minimal push-based AsyncIterable used as the SDK's streaming prompt input:
 * `push` enqueues an SDKUserMessage for the subprocess, `end` finishes the
 * stream so the query can wind down. Single consumer (the SDK transport).
 */
class AsyncInputQueue<T> implements AsyncIterable<T> {
  private readonly buffered: T[] = []
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = []
  private ended = false

  public push(value: T): void {
    if (this.ended) {
      return
    }
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter({ value, done: false })
      return
    }
    this.buffered.push(value)
  }

  public end(): void {
    if (this.ended) {
      return
    }
    this.ended = true
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true })
    }
  }

  public [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.buffered.length > 0) {
          return Promise.resolve({ value: this.buffered.shift() as T, done: false })
        }
        if (this.ended) {
          return Promise.resolve({ value: undefined, done: true })
        }
        return new Promise((resolve) => {
          this.waiters.push(resolve)
        })
      },
    }
  }
}

interface ClaudeSessionState {
  sessionId: string
  sessionUuid: string
  inputQueue: AsyncInputQueue<SDKUserMessage>
  queryHandle: Query
  /** Bounded ring buffer of recent subprocess stderr chunks for diagnostics. */
  stderrTail: string[]
  loop: Promise<void>
  /** How the native CLI session was started; drives the retry fallback. */
  startMode: "fresh" | "resume"
}

interface PendingSdkPermission {
  sessionId: string
  suggestions: PermissionUpdate[] | undefined
  toolInput: Record<string, unknown>
  settle: (result: PermissionResult, emitReplied: boolean) => void
}

/** Keys whose string values are surfaced as the salient resources of a permission request. */
const SALIENT_INPUT_KEYS = ["file_path", "path", "command", "url", "pattern"] as const
const MAX_SALIENT_RESOURCES = 3

function salientResources(toolInput: Record<string, unknown>): string[] {
  const resources: string[] = []
  for (const key of SALIENT_INPUT_KEYS) {
    const value = toolInput[key]
    if (typeof value === "string" && value.length > 0) {
      resources.push(value)
      if (resources.length >= MAX_SALIENT_RESOURCES) {
        break
      }
    }
  }
  return resources
}

/**
 * Claude exposes Wanta MCP calls as `mcp__<server>__<tool>`. Keep this
 * deliberately narrow so only tools from Wanta's generated host servers can
 * skip the redundant external-agent transport prompt.
 */
function wantaHostToolName(toolName: string): string | undefined {
  const match = /^mcp__wanta_[a-z0-9_-]+__([a-z0-9_-]+)$/u.exec(toolName)
  return match?.[1]
}

function sdkPermissionMode(
  mode: AgentPermissionMode,
): "acceptEdits" | "auto" | "bypassPermissions" | "default" | "plan" {
  switch (mode) {
    case "full_access":
      return "bypassPermissions"
    case "accept_edits":
      return "acceptEdits"
    case "plan":
      return "plan"
    case "auto":
      // The CLI's classifier mode: routine actions are approved by the agent
      // itself, risky ones still surface a permission ask.
      return "auto"
    default:
      // read_only is not declared in the claude-code profile; map defensively.
      return "default"
  }
}

/** Effort levels safe to switch live via flag settings (SDK 0.3.226; "max" needs a respawn). */
const CLAUDE_EFFORT_IDS = ["low", "medium", "high", "xhigh"] as const
type ClaudeEffortId = (typeof CLAUDE_EFFORT_IDS)[number]

function isClaudeEffortId(value: string): value is ClaudeEffortId {
  return (CLAUDE_EFFORT_IDS as readonly string[]).includes(value)
}

/**
 * Static baseline catalog, replaced by the live list (supportedModels) once a
 * query is available. Ids and labels verified against CLI 2.1.226
 * `supportedModels()` output; subscriptions may differ, which the live refresh
 * absorbs. Labels are agent-native vocabulary and rendered verbatim.
 */
function staticClaudeCatalog(): ExternalAgentCatalog {
  return {
    models: [
      { id: "default", label: "Default (recommended)" },
      { id: "opus[1m]", label: "Opus (1M context)", description: "Opus 5 with 1M context" },
      { id: "claude-fable-5[1m]", label: "Fable", description: "Fable 5" },
      { id: "sonnet", label: "Sonnet", description: "Sonnet 5" },
      { id: "haiku", label: "Haiku", description: "Haiku 4.5" },
    ],
    // Sending no model keeps the CLI's own policy, which is this same
    // "Default (recommended)" entry; surface it as the picker's default.
    defaultModelId: "default",
    efforts: [
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium" },
      { id: "high", label: "High" },
      { id: "xhigh", label: "Extra High" },
    ],
  }
}

function isAuthenticationFailureMessage(message: string): boolean {
  return /authentication/iu.test(message)
}

/** Attachment paths as a prompt note the CLI resolves with its own file tools. */
function attachmentPathNote(attachments: readonly ChatAttachment[]): string {
  const lines = attachments.map((attachment) => {
    const target = attachment.agentPath?.trim() || attachment.path
    return `- ${target}${attachment.kind === "directory" ? " (directory)" : ""}`
  })
  return `The user attached the following files for this message. Read them as needed:\n${lines.join("\n")}`
}

export class ClaudeCodeAgentAdapter extends ExternalAgentAdapter {
  public readonly kind = "claude-code" as const
  public readonly profile = AGENT_PROFILES["claude-code"]

  private readonly probe: () => Promise<ExternalAgentRuntimeStatus>
  private readonly scratchRootDir: string
  private readonly commandPath: () => Promise<string>
  private readonly hostMcpServers?: HostMcpServerProvider
  private readonly queryFn: typeof query

  private readonly sessions = new Map<string, ClaudeSessionState>()
  private readonly sessionCreations = new Map<string, Promise<ClaudeSessionState>>()
  private readonly desiredPermissionModes = new Map<string, AgentPermissionMode>()
  private readonly desiredModels = new Map<string, string>()
  private readonly desiredEfforts = new Map<string, ClaudeEffortId>()
  private catalog: ExternalAgentCatalog = staticClaudeCatalog()
  private catalogRefreshed = false
  /**
   * Per-session override of how the native CLI session is started. Default is
   * derived from persisted history (resume when history exists); a failed
   * resume flips to "fresh" and a fresh start rejected as "already in use"
   * flips back to "resume", so a retry always takes the other path.
   */
  private readonly nativeStartOverride = new Map<string, "fresh" | "resume">()
  private catalogWarmup: Promise<void> | undefined
  private readonly pendingSdkPermissions = new Map<string, PendingSdkPermission>()
  private probeCache: { status: ExternalAgentRuntimeStatus; expiresAt: number } | undefined
  private probeInFlight: Promise<ExternalAgentRuntimeStatus> | undefined

  public constructor(options: ClaudeCodeAdapterOptions) {
    super(options.transcriptDir ? { transcriptDir: options.transcriptDir } : {})
    this.probe = options.probe
    this.scratchRootDir = options.scratchRootDir
    this.commandPath = options.commandPath ?? (() => resolveUserCommandPath())
    this.hostMcpServers = options.hostMcpServers
    this.queryFn = options.queryFn ?? query
  }

  protected async handleStart(): Promise<void> {
    // Sessions are lazy: the subprocess spawns on the first prompt of each
    // session, so bringing the adapter up has no side effects.
  }

  protected async handleStop(): Promise<void> {
    const sessions = [...this.sessions.values()]
    this.sessions.clear()
    this.sessionCreations.clear()
    // The contract teardown sweep already emitted permissionReplied for every
    // pending request; here we only unblock the parked SDK promises.
    for (const pending of this.pendingSdkPermissions.values()) {
      pending.settle({ behavior: "deny", message: "The agent was stopped." }, false)
    }
    this.pendingSdkPermissions.clear()
    for (const session of sessions) {
      session.inputQueue.end()
      this.closeQuery(session)
    }
    await Promise.allSettled(sessions.map((session) => session.loop))
  }

  protected async handlePrompt(input: PromptAgentInput, options?: AgentSendOptions): Promise<void> {
    if (options?.signal?.aborted) {
      return
    }
    // Draft-time model/effort choices ride the first prompt; failures to apply
    // them must never fail the turn itself.
    if (input.agentModelId !== undefined) {
      await this.applyModel(input.sessionId, input.agentModelId).catch((error: unknown) => {
        logDiagnostic("claude-code-adapter", "prompt-borne model apply failed", {
          sessionId: input.sessionId,
          error: errorMessage(error),
        })
      })
    }
    if (input.agentEffortId !== undefined && isClaudeEffortId(input.agentEffortId)) {
      await this.applyEffort(input.sessionId, input.agentEffortId).catch((error: unknown) => {
        logDiagnostic("claude-code-adapter", "prompt-borne effort apply failed", {
          sessionId: input.sessionId,
          error: errorMessage(error),
        })
      })
    }
    if (this.sessions.has(input.sessionId)) await this.hostMcpServers?.(input)
    const session = await this.ensureSession(input)
    if (options?.signal?.aborted) {
      return
    }
    this.emitUserTurn(input)
    // Attachments ride as a separate text block of path references: the CLI's
    // own file tools resolve them (Read handles images too), which keeps large
    // files out of the prompt payload and inside the agent's permission model.
    const content: Array<{ type: "text"; text: string }> = [{ type: "text", text: externalAgentPromptText(input) }]
    if (input.attachments?.length) {
      content.push({ type: "text", text: attachmentPathNote(input.attachments) })
    }
    // Submission ack semantics: resolve once the message is enqueued for the
    // subprocess; turn progress flows back through the event channel.
    session.inputQueue.push({
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      session_id: session.sessionUuid,
    })
  }

  protected async handleCancel(input: CancelAgentInput): Promise<void> {
    const session = this.sessions.get(input.sessionId)
    if (!session) {
      return
    }
    try {
      await session.queryHandle.interrupt()
    } catch (error) {
      // The query may already be gone; cancel must never throw at the caller.
      logDiagnostic("claude-code-adapter", "interrupt failed", {
        sessionId: input.sessionId,
        error: errorMessage(error),
      })
    }
  }

  protected override async handlePermissionResponse(input: PermissionResponseAgentInput): Promise<void> {
    const pending = this.pendingSdkPermissions.get(input.requestId)
    if (!pending) {
      throw new Error(`claude-code: unknown permission request "${input.requestId}"`)
    }
    switch (input.reply) {
      case "once":
        pending.settle({ behavior: "allow", updatedInput: pending.toolInput }, true)
        return
      case "always":
        pending.settle(
          {
            behavior: "allow",
            updatedInput: pending.toolInput,
            ...(pending.suggestions !== undefined ? { updatedPermissions: pending.suggestions } : {}),
          },
          true,
        )
        return
      case "reject":
        pending.settle({ behavior: "deny", message: "The user declined this action in Wanta." }, true)
        return
    }
  }

  protected override async handleSetModel(input: SetModelAgentInput): Promise<void> {
    await this.applyModel(input.sessionId, input.modelId)
  }

  protected override async handleSetEffort(input: SetEffortAgentInput): Promise<void> {
    if (input.effortId !== undefined && !isClaudeEffortId(input.effortId)) {
      throw new Error(`claude-code: unknown effort "${input.effortId}"`)
    }
    await this.applyEffort(input.sessionId, input.effortId as ClaudeEffortId | undefined)
  }

  /**
   * Stash the choice for session creation and switch the live query when one
   * exists. A failed live switch restores the previous stash so a future
   * session recreation never resurrects a value the agent rejected.
   */
  private async applyModel(sessionId: string, modelId: string | undefined): Promise<void> {
    const previous = this.desiredModels.get(sessionId)
    if (modelId === undefined) {
      this.desiredModels.delete(sessionId)
    } else {
      this.desiredModels.set(sessionId, modelId)
    }
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }
    const handle = session.queryHandle as unknown as { setModel?: (model?: string) => Promise<void> }
    if (typeof handle.setModel !== "function") {
      return
    }
    try {
      await handle.setModel(modelId)
    } catch (error) {
      this.restoreDesired(this.desiredModels, sessionId, previous, modelId)
      throw error
    }
  }

  private async applyEffort(sessionId: string, effortId: ClaudeEffortId | undefined): Promise<void> {
    const previous = this.desiredEfforts.get(sessionId)
    if (effortId === undefined) {
      this.desiredEfforts.delete(sessionId)
    } else {
      this.desiredEfforts.set(sessionId, effortId)
    }
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }
    const handle = session.queryHandle as unknown as {
      applyFlagSettings?: (settings: { effortLevel?: string | null }) => Promise<unknown>
    }
    if (typeof handle.applyFlagSettings !== "function") {
      return
    }
    try {
      // applyFlagSettings is a shallow MERGE; clearing a key requires an
      // explicit null ({} would silently keep the previous effort in force).
      await handle.applyFlagSettings({ effortLevel: effortId ?? null })
    } catch (error) {
      this.restoreDesired(this.desiredEfforts, sessionId, previous, effortId)
      throw error
    }
  }

  /**
   * Roll back a failed live switch, but only while the stash still holds the
   * value THIS attempt wrote — a slow rejection must never clobber a newer
   * accepted choice.
   */
  private restoreDesired<T>(
    map: Map<string, T>,
    sessionId: string,
    previous: T | undefined,
    attempted: T | undefined,
  ): void {
    if (map.get(sessionId) !== attempted) {
      return
    }
    if (previous === undefined) {
      map.delete(sessionId)
    } else {
      map.set(sessionId, previous)
    }
  }

  /** Last user-chosen model/effort for a session (renderer read-back after reloads). */
  public override sessionSelection(sessionId: string): { modelId?: string; effortId?: string } {
    const modelId = this.desiredModels.get(sessionId)
    const effortId = this.desiredEfforts.get(sessionId)
    return { ...(modelId !== undefined ? { modelId } : {}), ...(effortId !== undefined ? { effortId } : {}) }
  }

  /** Drop CLI slash-command bookkeeping that older builds persisted as user text. */
  protected override sanitizeRestoredMessages(messages: ChatMessage[]): ChatMessage[] {
    return messages
      .map((message) => {
        if (message.role !== "user") {
          return message
        }
        const parts = message.parts.filter((part) => part.kind !== "text" || !isLocalCommandText(part.text ?? ""))
        return parts.length === message.parts.length ? message : { ...message, parts }
      })
      .filter((message) => message.role !== "user" || message.parts.length > 0)
  }

  public override async applyPermissionMode(sessionId: string, mode: AgentPermissionMode): Promise<void> {
    this.desiredPermissionModes.set(sessionId, mode)
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }
    try {
      await session.queryHandle.setPermissionMode(sdkPermissionMode(mode))
    } catch (error) {
      logDiagnostic(
        "claude-code-adapter",
        "setPermissionMode failed",
        { sessionId, mode, error: errorMessage(error) },
        "error",
      )
    }
  }

  public runtimeStatus(): Promise<ExternalAgentRuntimeStatus> {
    if (this.probeCache && this.probeCache.expiresAt > Date.now()) {
      return Promise.resolve(this.decorateStatus(this.probeCache.status))
    }
    this.probeInFlight ??= this.probe()
      .then((status) => {
        this.probeCache = { status, expiresAt: Date.now() + PROBE_CACHE_TTL_MS }
        return status
      })
      .finally(() => {
        this.probeInFlight = undefined
      })
    return this.probeInFlight.then((status) => this.decorateStatus(status))
  }

  private decorateStatus(status: ExternalAgentRuntimeStatus): ExternalAgentRuntimeStatus {
    return { ...status, catalog: this.catalog }
  }

  /** Replace the static model aliases with the live model list, once per adapter run. */
  private refreshCatalog(session: ClaudeSessionState): void {
    if (this.catalogRefreshed) {
      return
    }
    const handle = session.queryHandle as unknown as { supportedModels?: () => Promise<unknown> }
    if (typeof handle.supportedModels !== "function") {
      return
    }
    this.catalogRefreshed = true
    void handle
      .supportedModels()
      .then((models) => {
        this.adoptSupportedModels(models)
      })
      .catch((error: unknown) => {
        // Keep the static baseline and allow a later session to retry.
        this.catalogRefreshed = false
        logDiagnostic("claude-code-adapter", "supportedModels failed", {
          error: errorMessage(error),
        })
      })
  }

  private adoptSupportedModels(models: unknown): void {
    const options = (Array.isArray(models) ? models : [])
      .map((model) => model as { value?: unknown; displayName?: unknown; description?: unknown })
      .filter((model) => typeof model.value === "string" && model.value.length > 0)
      .map((model) => ({
        id: model.value as string,
        label: typeof model.displayName === "string" && model.displayName ? model.displayName : (model.value as string),
        ...(typeof model.description === "string" && model.description ? { description: model.description } : {}),
      }))
    if (options.length > 0) {
      const next: ExternalAgentCatalog = { ...this.catalog, models: options }
      // The CLI's "default" entry IS its no-model-flag behavior; a live list
      // without it means we no longer know what Auto resolves to.
      if (options.some((option) => option.id === "default")) {
        next.defaultModelId = "default"
      } else {
        delete next.defaultModelId
      }
      this.catalog = next
    }
  }

  /**
   * Pre-populate the live model list before any user session exists by
   * spawning a short-lived idle query (no prompt is ever sent). The static
   * baseline stays in place when warming fails.
   */
  public override async warmCatalog(): Promise<void> {
    if (this.catalogRefreshed) {
      return
    }
    this.catalogWarmup ??= this.runCatalogWarmup()
      .catch((error: unknown) => {
        // Warm failures (probe, spawn, fs) keep the static baseline; they must
        // never reject into the composer's warm-on-focus call.
        logDiagnostic("claude-code-adapter", "catalog warmup failed", {
          error: errorMessage(error),
        })
      })
      .finally(() => {
        this.catalogWarmup = undefined
      })
    await this.catalogWarmup
  }

  private async runCatalogWarmup(): Promise<void> {
    const status = await this.runtimeStatus()
    if (status.binary.status !== "detected") {
      return
    }
    const cwd = path.join(this.scratchRootDir, "warmup")
    await mkdir(cwd, { recursive: true })
    const commandPathValue = await this.commandPath()
    const inputQueue = new AsyncInputQueue<SDKUserMessage>()
    const handle = this.queryFn({
      prompt: inputQueue,
      options: {
        cwd,
        pathToClaudeCodeExecutable: status.binary.path,
        env: { ...process.env, PATH: commandPathValue },
      },
    })
    try {
      const probe = handle as unknown as { supportedModels?: () => Promise<unknown> }
      if (typeof probe.supportedModels !== "function") {
        return
      }
      this.adoptSupportedModels(await probe.supportedModels())
      this.catalogRefreshed = true
    } catch (error) {
      logDiagnostic("claude-code-adapter", "catalog warmup failed", {
        error: errorMessage(error),
      })
    } finally {
      inputQueue.end()
      try {
        handle.close()
      } catch {
        // Already gone.
      }
    }
  }

  protected override handleForgetSession(sessionId: string): void {
    this.desiredPermissionModes.delete(sessionId)
    this.desiredModels.delete(sessionId)
    this.desiredEfforts.delete(sessionId)
    this.nativeStartOverride.delete(sessionId)
    for (const [requestId, pending] of this.pendingSdkPermissions) {
      if (pending.sessionId === sessionId) {
        this.pendingSdkPermissions.delete(requestId)
        pending.settle({ behavior: "deny", message: "The session was deleted." }, true)
      }
    }
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }
    this.sessions.delete(sessionId)
    session.inputQueue.end()
    this.closeQuery(session)
  }

  private ensureSession(input: PromptAgentInput): Promise<ClaudeSessionState> {
    const existing = this.sessions.get(input.sessionId)
    if (existing) {
      return Promise.resolve(existing)
    }
    const inFlight = this.sessionCreations.get(input.sessionId)
    if (inFlight) {
      return inFlight
    }
    const creation = this.createSession(input).finally(() => {
      this.sessionCreations.delete(input.sessionId)
    })
    this.sessionCreations.set(input.sessionId, creation)
    return creation
  }

  private async createSession(input: PromptAgentInput): Promise<ClaudeSessionState> {
    const sessionId = input.sessionId
    const status = await this.runtimeStatus()
    if (status.binary.status !== "detected") {
      throw new Error(
        `claude-code: the Claude Code binary was not found on this machine. Install the \`claude\` CLI, then retry.`,
      )
    }
    // Deterministic native identity: the SDK session UUID is the uuid embedded
    // in the external session id (fresh uuid only for non-external test ids).
    const sessionUuid = externalSessionUuid(sessionId) ?? randomUUID()
    // A session with persisted history already owns this uuid on the CLI side;
    // creating it again fails with "Session ID already in use", so resume it
    // (verified against 2.1.226: resume replays nothing and keeps the same id).
    const startMode =
      this.nativeStartOverride.get(sessionId) ?? (this.hasPersistedHistory(sessionId) ? "resume" : "fresh")
    let cwd = input.outputProjectRoot
    if (!cwd) {
      cwd = path.join(this.scratchRootDir, sessionUuid)
      await mkdir(cwd, { recursive: true })
    }
    const commandPathValue = await this.commandPath()
    const hostMcpServers = await this.hostMcpServers?.(input)
    const inputQueue = new AsyncInputQueue<SDKUserMessage>()
    const abortController = new AbortController()
    const stderrTail: string[] = []
    const queryHandle = this.queryFn({
      prompt: inputQueue,
      options: {
        cwd,
        pathToClaudeCodeExecutable: status.binary.path,
        // Options.env REPLACES the subprocess env entirely (verified against
        // sdk.d.ts 0.3.226), so the current env is spread in explicitly.
        env: { ...process.env, PATH: commandPathValue },
        ...(hostMcpServers?.length
          ? {
              mcpServers: Object.fromEntries(
                hostMcpServers.map((server) => [
                  server.name,
                  { type: "http" as const, url: server.url, headers: server.headers, alwaysLoad: true },
                ]),
              ),
            }
          : {}),
        permissionMode: sdkPermissionMode(this.desiredPermissionModes.get(sessionId) ?? "default"),
        ...(this.desiredModels.has(sessionId) ? { model: this.desiredModels.get(sessionId) } : {}),
        ...(this.desiredEfforts.has(sessionId) ? { effort: this.desiredEfforts.get(sessionId) } : {}),
        // Required at creation time so a later switch to bypassPermissions
        // (full_access) via setPermissionMode is accepted by the CLI.
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        ...(startMode === "resume" ? { resume: sessionUuid } : { sessionId: sessionUuid }),
        canUseTool: this.createCanUseTool(sessionId),
        stderr: (data: string) => {
          stderrTail.push(data)
          if (stderrTail.length > MAX_STDERR_CHUNKS) {
            stderrTail.shift()
          }
        },
        abortController,
      },
    })
    const session: ClaudeSessionState = {
      sessionId,
      sessionUuid,
      inputQueue,
      queryHandle,
      stderrTail,
      loop: Promise.resolve(),
      startMode,
    }
    // handleStop copies and clears `sessions` before tearing them down, so a
    // stop that landed during the awaits above would never see this session:
    // close it here instead of leaving an orphaned subprocess behind.
    if (!this.isStarted || this.isSessionForgotten(sessionId)) {
      inputQueue.end()
      this.closeQuery(session)
      throw new Error(
        this.isSessionForgotten(sessionId)
          ? `${this.kind}: session was deleted while being created`
          : `${this.kind}: adapter stopped while creating the session`,
      )
    }
    this.sessions.set(sessionId, session)
    session.loop = this.runQueryLoop(session)
    this.refreshCatalog(session)
    return session
  }

  /** Consume the query generator, translating every SDK message into contract events. */
  private async runQueryLoop(session: ClaudeSessionState): Promise<void> {
    const translator = createClaudeTurnTranslator(session.sessionId)
    let receivedAnyMessage = false
    let turnOpen = false
    try {
      for await (const message of session.queryHandle) {
        if (!receivedAnyMessage) {
          receivedAnyMessage = true
          // The chosen start mode worked; later decisions re-derive fresh.
          this.nativeStartOverride.delete(session.sessionId)
        }
        for (const event of translator.translate(message)) {
          if (event.event === "messageStarted" && event.data.role === "assistant") {
            turnOpen = true
          } else if (event.event === "messageCompleted") {
            turnOpen = false
          }
          this.emit(event)
        }
      }
      // A subprocess that exits without a result frame must still settle the
      // turn; deliberate shutdown (stop) is exempt via the isReady guard.
      if (turnOpen && this.isReady()) {
        this.emit({
          event: "agentError",
          data: { sessionId: session.sessionId, message: "Claude Code exited before completing the turn." },
        })
      }
    } catch (error) {
      const raw = errorMessage(error)
      const message = isAuthenticationFailureMessage(raw) ? `${raw} ${LOGIN_HINT}` : raw
      // A startup failure means the start mode itself was wrong (resume of a
      // vanished CLI session, or a fresh start rejected as duplicate); flip it
      // so the user's retry takes the other path instead of dead-ending.
      if (!receivedAnyMessage) {
        const failureText = raw + session.stderrTail.join("")
        if (session.startMode === "resume") {
          this.nativeStartOverride.set(session.sessionId, "fresh")
        } else if (/already in use/iu.test(failureText)) {
          this.nativeStartOverride.set(session.sessionId, "resume")
        }
      }
      this.emit({ event: "agentError", data: { sessionId: session.sessionId, message } })
      logDiagnostic(
        "claude-code-adapter",
        "query loop failed",
        { sessionId: session.sessionId, error: raw, stderrTail: session.stderrTail.join("") },
        "error",
      )
    } finally {
      if (this.sessions.get(session.sessionId) === session) {
        this.sessions.delete(session.sessionId)
      }
      session.inputQueue.end()
      // A dead query can never answer its parked permission prompts; sweep
      // them so the UI does not hang zombie permission cards forever.
      for (const [requestId, pending] of this.pendingSdkPermissions) {
        if (pending.sessionId === session.sessionId) {
          this.pendingSdkPermissions.delete(requestId)
          pending.settle({ behavior: "deny", message: "The agent process ended before this was answered." }, true)
        }
      }
    }
  }

  private closeQuery(session: ClaudeSessionState): void {
    try {
      session.queryHandle.close()
    } catch (error) {
      logDiagnostic("claude-code-adapter", "close failed", {
        sessionId: session.sessionId,
        error: errorMessage(error),
      })
    }
  }

  /**
   * Bridge the SDK permission prompt to the contract's permissionAsked /
   * permission-response round trip. The returned promise stays parked until
   * the user replies, the prompt is aborted by the SDK, or the adapter stops.
   */
  private createCanUseTool(sessionId: string): CanUseTool {
    return (toolName, toolInput, opts) => {
      // `Skill` only loads Claude's local Skill instructions. It is a
      // read-only discovery operation, not a shell/file mutation, and should
      // not interrupt a turn with an approval card. The runtime validator in
      // the shipping SDK requires the original input on every allow result.
      if (toolName === "Skill") {
        return Promise.resolve({ behavior: "allow", updatedInput: toolInput })
      }
      const requestId = opts.requestId ?? opts.toolUseID
      const wantaHostTool = wantaHostToolName(toolName)
      const request: ChatPermissionRequest = {
        id: requestId,
        sessionId,
        action: toolName,
        resources: salientResources(toolInput),
        metadata: {
          ...(opts.title !== undefined ? { title: opts.title } : {}),
          ...(opts.description !== undefined ? { description: opts.description } : {}),
          ...(opts.displayName !== undefined ? { displayName: opts.displayName } : {}),
          ...(wantaHostTool !== undefined ? { wantaHostTool } : {}),
          toolInput,
        },
      }
      return new Promise<PermissionResult>((resolve) => {
        const onAbort = (): void => {
          // The SDK voids the request on abort; deny defensively and release
          // the UI state so nothing hangs.
          settle({ behavior: "deny", message: "Cancelled." }, true)
        }
        const settle = (result: PermissionResult, emitReplied: boolean): void => {
          if (this.pendingSdkPermissions.get(requestId)?.settle === settle) {
            this.pendingSdkPermissions.delete(requestId)
          }
          opts.signal.removeEventListener("abort", onAbort)
          if (emitReplied) {
            this.emit({ event: "permissionReplied", data: { sessionId, requestId } })
          }
          resolve(result)
        }
        this.pendingSdkPermissions.set(requestId, {
          sessionId,
          suggestions: opts.suggestions,
          toolInput,
          settle,
        })
        opts.signal.addEventListener("abort", onAbort, { once: true })
        this.emit({ event: "permissionAsked", data: { sessionId, request } })
        if (opts.signal.aborted) {
          onAbort()
        }
      })
    }
  }
}
