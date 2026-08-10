import type { AgentPermissionMode, ChatPermissionRequest } from "../../chat/common.ts"
import type {
  AgentSendOptions,
  CancelAgentInput,
  PermissionResponseAgentInput,
  PromptAgentInput,
} from "../contract/input.ts"
import type { ExternalAgentRuntimeStatus } from "../external/probe.ts"
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
import { logDiagnostic } from "../../diagnostics-log.ts"
import { AGENT_PROFILES } from "../contract/profile.ts"
import { ExternalAgentAdapter } from "../external/adapter-base.ts"
import { externalSessionUuid } from "../external/session-id.ts"
import { createClaudeTurnTranslator } from "./translator.ts"

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
const LOGIN_HINT = "Run `claude` in a terminal and sign in, then retry."

export interface ClaudeCodeAdapterOptions {
  /** Probe supplier (binary path + login state). Injected by main; cached by the adapter for 30s. */
  probe: () => Promise<ExternalAgentRuntimeStatus>
  /** Directory for per-session scratch cwd when a session has no project. Created on demand. */
  scratchRootDir: string
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
  abortController: AbortController
  /** Bounded ring buffer of recent subprocess stderr chunks for diagnostics. */
  stderrTail: string[]
  loop: Promise<void>
}

interface PendingSdkPermission {
  sessionId: string
  suggestions: PermissionUpdate[] | undefined
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

function sdkPermissionMode(mode: AgentPermissionMode): "bypassPermissions" | "default" {
  return mode === "full_access" ? "bypassPermissions" : "default"
}

function isAuthenticationFailureMessage(message: string): boolean {
  return /authentication/iu.test(message)
}

export class ClaudeCodeAgentAdapter extends ExternalAgentAdapter {
  public readonly kind = "claude-code" as const
  public readonly profile = AGENT_PROFILES["claude-code"]

  private readonly probe: () => Promise<ExternalAgentRuntimeStatus>
  private readonly scratchRootDir: string
  private readonly commandPath: () => Promise<string>
  private readonly queryFn: typeof query

  private readonly sessions = new Map<string, ClaudeSessionState>()
  private readonly sessionCreations = new Map<string, Promise<ClaudeSessionState>>()
  private readonly desiredPermissionModes = new Map<string, AgentPermissionMode>()
  private readonly pendingSdkPermissions = new Map<string, PendingSdkPermission>()
  private probeCache: { status: ExternalAgentRuntimeStatus; expiresAt: number } | undefined
  private probeInFlight: Promise<ExternalAgentRuntimeStatus> | undefined

  public constructor(options: ClaudeCodeAdapterOptions) {
    super()
    this.probe = options.probe
    this.scratchRootDir = options.scratchRootDir
    this.commandPath = options.commandPath ?? (() => resolveUserCommandPath())
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
    const session = await this.ensureSession(input)
    if (options?.signal?.aborted) {
      return
    }
    // Submission ack semantics: resolve once the message is enqueued for the
    // subprocess; turn progress flows back through the event channel.
    session.inputQueue.push({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: input.text }] },
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
        error: error instanceof Error ? error.message : String(error),
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
        pending.settle({ behavior: "allow" }, true)
        return
      case "always":
        pending.settle(
          {
            behavior: "allow",
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
        { sessionId, mode, error: error instanceof Error ? error.message : String(error) },
        "error",
      )
    }
  }

  public runtimeStatus(): Promise<ExternalAgentRuntimeStatus> {
    if (this.probeCache && this.probeCache.expiresAt > Date.now()) {
      return Promise.resolve(this.probeCache.status)
    }
    this.probeInFlight ??= this.probe()
      .then((status) => {
        this.probeCache = { status, expiresAt: Date.now() + PROBE_CACHE_TTL_MS }
        return status
      })
      .finally(() => {
        this.probeInFlight = undefined
      })
    return this.probeInFlight
  }

  protected override handleForgetSession(sessionId: string): void {
    this.desiredPermissionModes.delete(sessionId)
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
    let cwd = input.outputProjectRoot
    if (!cwd) {
      cwd = path.join(this.scratchRootDir, sessionUuid)
      await mkdir(cwd, { recursive: true })
    }
    const commandPathValue = await this.commandPath()
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
        permissionMode: sdkPermissionMode(this.desiredPermissionModes.get(sessionId) ?? "default"),
        // Required at creation time so a later switch to bypassPermissions
        // (full_access) via setPermissionMode is accepted by the CLI.
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        sessionId: sessionUuid,
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
      abortController,
      stderrTail,
      loop: Promise.resolve(),
    }
    this.sessions.set(sessionId, session)
    session.loop = this.runQueryLoop(session)
    return session
  }

  /** Consume the query generator, translating every SDK message into contract events. */
  private async runQueryLoop(session: ClaudeSessionState): Promise<void> {
    const translator = createClaudeTurnTranslator(session.sessionId)
    try {
      for await (const message of session.queryHandle) {
        for (const event of translator.translate(message)) {
          this.emit(event)
        }
      }
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error)
      const message = isAuthenticationFailureMessage(raw) ? `${raw} ${LOGIN_HINT}` : raw
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
    }
  }

  private closeQuery(session: ClaudeSessionState): void {
    try {
      session.queryHandle.close()
    } catch (error) {
      logDiagnostic("claude-code-adapter", "close failed", {
        sessionId: session.sessionId,
        error: error instanceof Error ? error.message : String(error),
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
      const requestId = opts.requestId ?? opts.toolUseID
      const request: ChatPermissionRequest = {
        id: requestId,
        sessionId,
        action: toolName,
        resources: salientResources(toolInput),
        metadata: {
          ...(opts.title !== undefined ? { title: opts.title } : {}),
          ...(opts.description !== undefined ? { description: opts.description } : {}),
          ...(opts.displayName !== undefined ? { displayName: opts.displayName } : {}),
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
        this.pendingSdkPermissions.set(requestId, { sessionId, suggestions: opts.suggestions, settle })
        opts.signal.addEventListener("abort", onAbort, { once: true })
        this.emit({ event: "permissionAsked", data: { sessionId, request } })
        if (opts.signal.aborted) {
          onAbort()
        }
      })
    }
  }
}
