import type { ToolCallStartedEvent } from "../../chat/common.ts"
import type { AgentEvent } from "./event.ts"
import type {
  AgentInput,
  AgentSendOptions,
  AuthenticateAgentInput,
  CancelAgentInput,
  PermissionResponseAgentInput,
  PromptAgentInput,
  QuestionResponseAgentInput,
  SetEffortAgentInput,
  SetModelAgentInput,
} from "./input.ts"
import type { AgentKind, AgentProfile } from "./profile.ts"

import { logDiagnostic } from "../../diagnostics-log.ts"
import { agentEventIssues } from "./event.ts"
import { agentInputIssues } from "./input.ts"

// AgentAdapter contract (BYOA phase 0).
//
// The whole adapter surface is: two union channels (send in, onEvent out),
// lifecycle, and a static capability declaration. There are deliberately no
// per-feature methods — a new interaction is a new AgentInput/AgentEvent
// variant, added in the contract first and then honored by every adapter.

export interface AgentAdapter {
  readonly kind: AgentKind
  readonly profile: AgentProfile
  /** Bring the agent up. Idempotent while running; a stopped adapter cannot restart. */
  start(): Promise<void>
  /** Tear the agent down: sweep pending interactions, then release resources. Idempotent. */
  stop(): Promise<void>
  /** The single inbound channel. Rejects with a named error for undeclared capabilities. */
  send(input: AgentInput, options?: AgentSendOptions): Promise<void>
  /** The single outbound channel. Returns an unsubscribe function. */
  onEvent(listener: (event: AgentEvent) => void): () => void
}

function unreachableInput(input: never): never {
  throw new Error(`Unsupported agent input: ${JSON.stringify(input)}`)
}

type AdapterLifecycle = "idle" | "starting" | "started" | "stopping" | "stopped"

/**
 * Shared adapter skeleton enforcing the contract invariants:
 *
 * - `send` validates inputs against the zod schema and dispatches exhaustively;
 *   an unhandled variant is a compile-time error, never a silent drop.
 * - Optional capabilities default to a NAMED rejection
 *   (`<kind>: <feature> is not supported`); adapters override the handler to
 *   opt in. Silent degradation is forbidden.
 * - Every emitted event is asserted against the contract schema (logged on
 *   drift, always forwarded unmodified).
 * - `stop()` runs the teardown sweep: pending permission/question requests are
 *   resolved and non-terminal tool calls are failed, so no observer is left
 *   hanging regardless of how the underlying agent died.
 */
export abstract class BaseAgentAdapter implements AgentAdapter {
  public abstract readonly kind: AgentKind
  public abstract readonly profile: AgentProfile

  private readonly listeners = new Set<(event: AgentEvent) => void>()
  /** requestId -> sessionId of the unresolved permission request. */
  private readonly pendingPermissions = new Map<string, string>()
  /** requestId -> sessionId of the unresolved question request. */
  private readonly pendingQuestions = new Map<string, string>()
  /** `${sessionId}\0${partId}` -> last toolCallStarted payload without a terminal result. */
  private readonly openToolCalls = new Map<string, ToolCallStartedEvent>()
  private lifecycle: AdapterLifecycle = "idle"
  private startPromise: Promise<void> | null = null
  private stopPromise: Promise<void> | null = null

  public async start(): Promise<void> {
    if (this.lifecycle === "started") {
      return
    }
    if (this.lifecycle === "starting" && this.startPromise) {
      return this.startPromise
    }
    if (this.lifecycle === "stopping" || this.lifecycle === "stopped") {
      throw new Error(`${this.kind}: adapter cannot restart after stop`)
    }
    this.lifecycle = "starting"
    let startPromise!: Promise<void>
    startPromise = (async () => {
      try {
        await this.handleStart()
        if (this.lifecycle === "starting") this.lifecycle = "started"
      } catch (error) {
        if (this.lifecycle === "starting") this.lifecycle = "idle"
        throw error
      } finally {
        if (this.startPromise === startPromise) this.startPromise = null
      }
    })()
    this.startPromise = startPromise
    return startPromise
  }

  public async stop(): Promise<void> {
    if (this.lifecycle === "stopped") {
      return
    }
    if (this.lifecycle === "stopping" && this.stopPromise) {
      return this.stopPromise
    }
    this.lifecycle = "stopping"
    const inFlightStart = this.startPromise
    const stopPromise = (async () => {
      await inFlightStart?.catch(() => undefined)
      this.teardown()
      try {
        await this.handleStop()
      } finally {
        // Native runtimes may emit final frames while handleStop is awaiting
        // process shutdown. Sweep those interactions before observers detach.
        this.teardown()
        this.lifecycle = "stopped"
        this.listeners.clear()
      }
    })()
    this.stopPromise = stopPromise
    return stopPromise
  }

  public async send(input: AgentInput, options?: AgentSendOptions): Promise<void> {
    const issues = agentInputIssues(input)
    if (issues) {
      throw new Error(`${this.kind}: invalid agent input (${issues})`)
    }
    if (input.type === "prompt") {
      // A caller may race the app's eager start; wait for that one sanctioned
      // transition, then require a fully started adapter. Prompts during idle
      // or teardown could otherwise spawn a subprocess nobody owns.
      if (this.lifecycle === "starting" && this.startPromise) {
        await this.startPromise
      }
      if (this.lifecycle === "stopping" || this.lifecycle === "stopped") {
        throw new Error(`${this.kind}: adapter is stopped`)
      }
      if (this.lifecycle !== "started") {
        throw new Error(`${this.kind}: adapter is not started`)
      }
    }
    switch (input.type) {
      case "authenticate":
        return this.handleAuthenticate(input, options)
      case "prompt":
        return this.handlePrompt(input, options)
      case "cancel":
        return this.handleCancel(input, options)
      case "permission-response":
        return this.handlePermissionResponse(input, options)
      case "question-response":
        return this.handleQuestionResponse(input, options)
      case "set-model":
        return this.handleSetModel(input, options)
      case "set-effort":
        return this.handleSetEffort(input, options)
      default:
        return unreachableInput(input)
    }
  }

  public onEvent(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Whether the adapter has started and not yet stopped. */
  protected get isStarted(): boolean {
    return this.lifecycle === "started"
  }

  /** Whether an input variant is genuinely handled (used by contract tests for declaration honesty). */
  public supportsInput(type: AgentInput["type"]): boolean {
    switch (type) {
      case "authenticate":
        return (
          this.handleAuthenticate !== BaseAgentAdapter.prototype.handleAuthenticate && this.profile.inputs.authenticate
        )
      case "prompt":
      case "cancel":
        return true
      case "permission-response":
        return this.handlePermissionResponse !== BaseAgentAdapter.prototype.handlePermissionResponse
      case "question-response":
        return this.handleQuestionResponse !== BaseAgentAdapter.prototype.handleQuestionResponse
      // Model/effort handlers live on shared adapter bases (one generic ACP
      // adapter serves several agents), so the profile declaration is part of
      // the support answer; the handlers reject accordingly.
      case "set-model":
        return this.handleSetModel !== BaseAgentAdapter.prototype.handleSetModel && this.profile.inputs.setModel
      case "set-effort":
        return this.handleSetEffort !== BaseAgentAdapter.prototype.handleSetEffort && this.profile.inputs.setEffort
      default:
        return unreachableInput(type)
    }
  }

  /** Bring up the underlying agent and attach its native event stream. */
  protected abstract handleStart(): Promise<void>
  /** Release the underlying agent. Runs after the teardown sweep; must tolerate a never-started adapter. */
  protected abstract handleStop(): Promise<void>
  protected abstract handlePrompt(input: PromptAgentInput, options?: AgentSendOptions): Promise<void>
  protected abstract handleCancel(input: CancelAgentInput, options?: AgentSendOptions): Promise<void>

  protected handleAuthenticate(_input: AuthenticateAgentInput, _options?: AgentSendOptions): Promise<void> {
    return this.rejectUnsupportedInput("authenticate")
  }

  protected handlePermissionResponse(_input: PermissionResponseAgentInput, _options?: AgentSendOptions): Promise<void> {
    return this.rejectUnsupportedInput("permission-response")
  }

  protected handleQuestionResponse(_input: QuestionResponseAgentInput, _options?: AgentSendOptions): Promise<void> {
    return this.rejectUnsupportedInput("question-response")
  }

  protected handleSetModel(_input: SetModelAgentInput, _options?: AgentSendOptions): Promise<void> {
    return this.rejectUnsupportedInput("set-model")
  }

  protected handleSetEffort(_input: SetEffortAgentInput, _options?: AgentSendOptions): Promise<void> {
    return this.rejectUnsupportedInput("set-effort")
  }

  /** The one sanctioned way to refuse an optional capability: loud and named. */
  protected rejectUnsupportedInput(feature: string): Promise<never> {
    return Promise.reject(new Error(`${this.kind}: ${feature} is not supported`))
  }

  /**
   * Emit a contract event to every listener. Events failing schema validation
   * are logged (contract drift) but still forwarded unmodified — validation is
   * an assertion, never a filter that could swallow live data. Streaming delta
   * events are exempt: they fire dozens of times per second and their shape is
   * fixed by the same adapter code paths that already validated the opening
   * messageStarted, so re-parsing every chunk buys no signal.
   */
  protected emit(event: AgentEvent): void {
    if (event.event !== "messageDelta" && event.event !== "messageReasoningDelta") {
      const issues = agentEventIssues(event)
      if (issues) {
        logDiagnostic(
          "agent-adapter",
          "agent event failed contract validation",
          { adapter: this.kind, event: event.event, issues },
          "error",
        )
      }
    }
    this.trackEvent(event)
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (error) {
        logDiagnostic(
          "agent-adapter",
          "agent event listener failed",
          { adapter: this.kind, error, event: event.event },
          "error",
        )
      }
    }
  }

  /**
   * Resolve everything still in flight so no pending UI state can outlive the
   * adapter: unresolved permissions are replied, unresolved questions are
   * rejected, and non-terminal tool calls are failed. Idempotent.
   */
  protected teardown(): void {
    const permissions = [...this.pendingPermissions]
    this.pendingPermissions.clear()
    for (const [requestId, sessionId] of permissions) {
      this.emit({ event: "permissionReplied", data: { sessionId, requestId } })
    }
    const questions = [...this.pendingQuestions]
    this.pendingQuestions.clear()
    for (const [requestId, sessionId] of questions) {
      this.emit({ event: "questionRejected", data: { sessionId, requestId } })
    }
    const toolCalls = [...this.openToolCalls.values()]
    this.openToolCalls.clear()
    for (const started of toolCalls) {
      this.emit({
        event: "toolCallResult",
        data: {
          sessionId: started.sessionId,
          messageId: started.messageId,
          partId: started.partId,
          callId: started.callId,
          tool: started.tool,
          status: "error",
          input: started.input,
          error: "The agent stopped before this tool call completed.",
        },
      })
    }
  }

  private trackEvent(event: AgentEvent): void {
    switch (event.event) {
      case "permissionAsked":
        this.pendingPermissions.set(event.data.request.id, event.data.request.sessionId)
        return
      case "permissionReplied":
        this.pendingPermissions.delete(event.data.requestId)
        return
      case "questionAsked":
        this.pendingQuestions.set(event.data.request.id, event.data.request.sessionId)
        return
      case "questionReplied":
      case "questionRejected":
        this.pendingQuestions.delete(event.data.requestId)
        return
      case "toolCallStarted":
        this.openToolCalls.set(`${event.data.sessionId}\0${event.data.partId}`, event.data)
        return
      case "toolCallResult":
        this.openToolCalls.delete(`${event.data.sessionId}\0${event.data.partId}`)
        return
      default:
        return
    }
  }
}
