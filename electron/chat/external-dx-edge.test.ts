import type { AgentEvent } from "../agent/contract/event.ts"
import type {
  AgentSendOptions,
  AuthenticateAgentInput,
  CancelAgentInput,
  PermissionResponseAgentInput,
  PromptAgentInput,
  SetEffortAgentInput,
  SetModelAgentInput,
} from "../agent/contract/input.ts"
import type { AgentProfile, ExternalAgentKind } from "../agent/contract/profile.ts"
import type { ExternalAgentRuntimeStatus } from "../agent/external/probe.ts"
import type { OpencodeAgentAdapter } from "../agent/opencode-adapter.ts"
import type { ExternalSessionRecord, ExternalSessionStore } from "../session/external-store.ts"
import type { SessionMetadata, SessionMetadataStore } from "../session/metadata-store.ts"
import type { AgentPermissionMode, ChatAttachment, ChatPermissionRequest, SendMessageRequest } from "./common.ts"
import type { UserAttachmentStore } from "./user-attachments.ts"

import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test, vi } from "vitest"
import { AGENT_PROFILES } from "../agent/contract/profile.ts"
import { ExternalAgentAdapter } from "../agent/external/adapter-base.ts"
import { externalAgentKindForSessionId, mintExternalSessionId } from "../agent/external/session-id.ts"
import { ManagedTurnDirectories } from "../agent/managed-turn-directories.ts"
import { SessionServiceImpl } from "../session/node.ts"
import { ChatServiceImpl } from "./node.ts"

// Adversarial DX edge tests for the CHAT SERVICE external (BYOA) paths:
// electron/chat/node.ts sendExternalMessage / permission routing / backend
// resolution, plus the session-removal composition wired in electron/main.ts
// (SessionServiceImpl.remove -> adapter.forgetSession + chatService.forgetSession).
//
// The adapter layer itself (ACP adapters and transcript store) is covered by
// the earlier *-edge.test.ts campaign; these tests deliberately sit one layer up
// and drive ChatServiceImpl through a scripted ExternalAgentAdapter that mimics
// the observable behavior of the real adapters (user-turn echo, transcript-backed
// getMessages, named unknown-permission errors, profile-gated set-effort).

const localScope = {
  kind: "local" as const,
  workspaceId: "local",
  workspaceName: "Local",
}

/**
 * Scripted external adapter. Mirrors the real adapters where the chat service
 * can observe the difference:
 * - handlePrompt echoes the user turn (messageStarted + messageDelta), like the
 *   external adapter base does, and records the input.
 * - handlePermissionResponse resolves known ids and throws a named error for unknown ids.
 * - handleSetModel/handleSetEffort are gated on the profile flags exactly like
 *   the generic ACP adapter (acp/adapter.ts:529-541).
 * Assistant progress is driven explicitly by each test via emit helpers.
 */
class FakeExternalAdapter extends ExternalAgentAdapter {
  public override readonly kind: ExternalAgentKind
  public override readonly profile: AgentProfile
  public readonly prompts: PromptAgentInput[] = []
  public readonly authentications: AuthenticateAgentInput[] = []
  public readonly cancels: CancelAgentInput[] = []
  public readonly permissionResponses: PermissionResponseAgentInput[] = []
  public readonly setModels: SetModelAgentInput[] = []
  public readonly setEfforts: SetEffortAgentInput[] = []
  public readonly permissionModes: Array<{ sessionId: string; mode: AgentPermissionMode }> = []
  /** When set, the next prompt throws this error instead of dispatching. */
  public failNextPrompt: Error | undefined
  /** Optional fence used to race a rejected prompt against a newer selection. */
  public promptFailureBarrier: Promise<void> | undefined
  /** Optional fence used to pause a turn before prompt selections persist. */
  public permissionModeBarrier: Promise<void> | undefined
  public permissionModeBarrierEntries = 0
  /** When set, the next native permission-mode projection rejects. */
  public failNextPermissionMode: Error | undefined
  public runtimeStatusError: Error | undefined
  private readonly modelSelections = new Map<string, string>()
  private readonly effortSelections = new Map<string, string>()
  private readonly nativePendingPermissionIds = new Set<string>()

  public constructor(kind: ExternalAgentKind) {
    super()
    this.kind = kind
    this.profile = AGENT_PROFILES[kind]
  }

  protected async handleStart(): Promise<void> {}
  protected async handleStop(): Promise<void> {}

  protected async handlePrompt(input: PromptAgentInput, options?: AgentSendOptions): Promise<void> {
    if (options?.signal?.aborted) {
      return
    }
    if (this.failNextPrompt) {
      const error = this.failNextPrompt
      this.failNextPrompt = undefined
      await this.promptFailureBarrier
      this.promptFailureBarrier = undefined
      throw error
    }
    this.prompts.push(input)
    const userMessageId = input.messageId ?? `user-${this.prompts.length}`
    this.emit({
      event: "messageStarted",
      data: { sessionId: input.sessionId, messageId: userMessageId, role: "user" },
    })
    this.emit({
      event: "messageDelta",
      data: {
        sessionId: input.sessionId,
        messageId: userMessageId,
        partId: `${userMessageId}:text`,
        text: input.text,
        delta: input.text,
      },
    })
  }

  protected async handleCancel(input: CancelAgentInput): Promise<void> {
    this.cancels.push(input)
  }

  protected override async handleAuthenticate(input: AuthenticateAgentInput): Promise<void> {
    this.authentications.push(input)
  }

  protected override async handlePermissionResponse(input: PermissionResponseAgentInput): Promise<void> {
    if (!this.nativePendingPermissionIds.has(input.requestId)) {
      throw new Error(`${this.kind}: unknown permission request "${input.requestId}"`)
    }
    this.nativePendingPermissionIds.delete(input.requestId)
    this.permissionResponses.push(input)
    this.emit({
      event: "permissionReplied",
      data: { sessionId: input.sessionId, requestId: input.requestId },
    })
  }

  protected override async handleSetModel(input: SetModelAgentInput): Promise<void> {
    if (!this.profile.inputs.setModel) {
      return this.rejectUnsupportedInput("set-model")
    }
    this.setModels.push(input)
    if (input.modelId) {
      this.modelSelections.set(input.sessionId, input.modelId)
    } else {
      this.modelSelections.delete(input.sessionId)
    }
  }

  protected override async handleSetEffort(input: SetEffortAgentInput): Promise<void> {
    if (!this.profile.inputs.setEffort) {
      return this.rejectUnsupportedInput("set-effort")
    }
    this.setEfforts.push(input)
    if (input.effortId) {
      this.effortSelections.set(input.sessionId, input.effortId)
    } else {
      this.effortSelections.delete(input.sessionId)
    }
  }

  public override sessionSelection(sessionId: string): { modelId?: string; effortId?: string } {
    const modelId = this.modelSelections.get(sessionId)
    const effortId = this.effortSelections.get(sessionId)
    return {
      ...(modelId ? { modelId } : {}),
      ...(effortId ? { effortId } : {}),
    }
  }

  public override async applyPermissionMode(sessionId: string, mode: AgentPermissionMode): Promise<void> {
    this.permissionModeBarrierEntries += 1
    await this.permissionModeBarrier
    this.permissionModeBarrier = undefined
    if (this.failNextPermissionMode) {
      const error = this.failNextPermissionMode
      this.failNextPermissionMode = undefined
      throw error
    }
    this.permissionModes.push({ sessionId, mode })
  }

  public runtimeStatus(): Promise<ExternalAgentRuntimeStatus> {
    if (this.runtimeStatusError) return Promise.reject(this.runtimeStatusError)
    return Promise.resolve({
      kind: this.kind,
      displayName: this.profile.displayName,
      binary: { status: "detected", path: `/fake/bin/${this.kind}` },
      login: { status: "unknown" },
      loginHint: "",
    })
  }

  /** Raw event injection, as if the native process produced it. */
  public emitEvent(event: AgentEvent): void {
    this.emit(event)
  }

  /** Start streaming an assistant reply without finishing the turn. */
  public startAssistantReply(sessionId: string, replyId: string, text: string): void {
    this.emit({ event: "messageStarted", data: { sessionId, messageId: replyId, role: "assistant" } })
    this.emit({
      event: "messageDelta",
      data: { sessionId, messageId: replyId, partId: `${replyId}:text`, text, delta: text },
    })
  }

  /** Finish the turn: completion materializes finishReason/completedAt in the transcript. */
  public completeAssistantTurn(sessionId: string, replyId: string, text: string): void {
    this.startAssistantReply(sessionId, replyId, text)
    this.emit({ event: "messageCompleted", data: { sessionId } })
  }

  /** Surface a native permission request through the contract event channel. */
  public askPermission(sessionId: string, requestId: string): ChatPermissionRequest {
    const request: ChatPermissionRequest = {
      id: requestId,
      sessionId,
      action: "read_file",
      resources: [`/Users/example/.ssh/${requestId}`],
    }
    this.nativePendingPermissionIds.add(requestId)
    this.emit({ event: "permissionAsked", data: { sessionId, request } })
    return request
  }
}

interface CapturedEvent {
  event: string
  data: unknown
}

function captureServiceEvents(service: ChatServiceImpl): CapturedEvent[] {
  const events: CapturedEvent[] = []
  ;(service as unknown as { send: (event: string, data: unknown) => Promise<void> }).send = async (event, data) => {
    events.push({ event, data })
  }
  return events
}

function createHarness(
  kinds: ExternalAgentKind[] = ["claude-code"],
  deps: ConstructorParameters<typeof ChatServiceImpl>[1] = {},
): {
  service: ChatServiceImpl
  events: CapturedEvent[]
  adapters: Map<ExternalAgentKind, FakeExternalAdapter>
} {
  const service = new ChatServiceImpl(null, {
    managedTurnDirectories: new ManagedTurnDirectories(path.join(os.tmpdir(), `wanta-external-dx-${randomUUID()}`)),
    ...deps,
  })
  // Override the transport before setExternalAgents: the bridge captures
  // this.send once when the adapters are registered.
  const events = captureServiceEvents(service)
  const adapters = new Map<ExternalAgentKind, FakeExternalAdapter>()
  for (const kind of kinds) {
    const adapter = new FakeExternalAdapter(kind)
    void adapter.start()
    adapters.set(kind, adapter)
  }
  service.setExternalAgents(adapters)
  return { service, events, adapters }
}

function sendRequest(sessionId: string, text: string, extra: Partial<SendMessageRequest> = {}): SendMessageRequest {
  return { scope: localScope, sessionId, text, ...extra }
}

function sessionEvents(events: CapturedEvent[], sessionId: string): CapturedEvent[] {
  return events.filter((entry) => (entry.data as { sessionId?: string } | undefined)?.sessionId === sessionId)
}

async function waitForCondition(condition: () => boolean, label = "condition"): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (condition()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(`Timed out waiting for ${label}`)
}

async function waitForTurnCompletion(service: ChatServiceImpl): Promise<void> {
  await waitForCondition(() => !service.hasActiveGeneration(), "generation completion")
}

test("external agent probe failures remain visible as disabled error rows", async () => {
  const { service, adapters } = createHarness(["claude-code", "codex"])
  const failed = adapters.get("codex")
  if (!failed) assert.fail("codex adapter missing")
  failed.runtimeStatusError = new Error("probe exploded")

  const statuses = await service.getExternalAgents()

  assert.deepEqual(
    statuses.map((status) => ({ kind: status.kind, binary: status.binary })),
    [
      { kind: "claude-code", binary: { status: "detected", path: "/fake/bin/claude-code" } },
      { kind: "codex", binary: { status: "error", message: "probe exploded" } },
    ],
  )
})

// ---------------------------------------------------------------------------
// Edge 1: attachments into an external session
// ---------------------------------------------------------------------------

/** A real on-disk attachment: the trust boundary realpath()s every candidate. */
async function createProbeAttachment(): Promise<ChatAttachment> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-dx-attach-"))
  const filePath = path.join(dir, "notes.md")
  await writeFile(filePath, "probe", "utf8")
  return { id: "att-1", name: "notes.md", mime: "text/markdown", size: 5, path: filePath }
}

test("external turns receive managed output directories and finalize against their own transcript", async () => {
  const { service, adapters } = createHarness()
  const adapter = adapters.get("claude-code")
  assert.ok(adapter)
  const getMessages = vi.spyOn(adapter, "getMessages")
  const sessionId = mintExternalSessionId("claude-code")

  await service.sendMessage(
    sendRequest(sessionId, "create an output", {
      model: { kind: "builtin", id: "gpt-5.6-sol" },
      reasoningLevel: "high",
    }),
  )
  const prompt = adapter.prompts[0]
  assert.ok(prompt?.artifactDir)
  assert.ok(prompt.processDir)
  assert.equal(prompt.model, undefined)
  assert.equal(prompt.reasoningLevel, undefined)
  assert.equal(prompt.additionalDirectories?.length, 2)
  assert.equal(
    prompt.additionalDirectories?.every((root) => path.isAbsolute(root)),
    true,
  )

  adapter.completeAssistantTurn(sessionId, "reply-managed", "done")
  await waitForTurnCompletion(service)
  assert.equal(
    getMessages.mock.calls.some(([id]) => id === sessionId),
    true,
  )
})

test("external turns publish and clear their guarded OOCLI workspace scope", async () => {
  const scopeChanges = vi.fn(
    async (_input: { active: boolean; cwdRoots?: readonly string[]; sessionId: string; teamName?: string }) =>
      undefined,
  )
  const { service, adapters } = createHarness(["claude-code"], {
    onExternalTurnScopeChanged: scopeChanges,
  })
  const adapter = adapters.get("claude-code")
  assert.ok(adapter)
  const sessionId = mintExternalSessionId("claude-code")

  await service.sendMessage({
    scope: { kind: "team", teamId: "team-id", teamName: "OOMOL-Internal" },
    sessionId,
    text: "query PostHog",
  })
  await waitForCondition(() => adapter.prompts.length === 1, "external prompt")
  const prompt = adapter.prompts[0]
  assert.deepEqual(scopeChanges.mock.calls[0]?.[0], {
    active: true,
    cwdRoots: [prompt?.artifactDir, prompt?.processDir].filter((root): root is string => Boolean(root)),
    sessionId,
    teamName: "OOMOL-Internal",
  })

  adapter.completeAssistantTurn(sessionId, "reply-scope", "done")
  await waitForTurnCompletion(service)
  assert.deepEqual(scopeChanges.mock.calls.at(-1)?.[0], { active: false, sessionId })
})

test("an accepted external turn is not interrupted while the model has a slow first response", async () => {
  vi.useFakeTimers()
  try {
    const { service, events, adapters } = createHarness()
    const adapter = adapters.get("claude-code")
    assert.ok(adapter)
    const sessionId = mintExternalSessionId("claude-code")

    await service.sendMessage(sendRequest(sessionId, "take time to think"))
    await Promise.resolve()
    assert.equal(adapter.prompts.length, 1)
    assert.equal(service.hasActiveGeneration(), true)

    await vi.advanceTimersByTimeAsync(45_000)
    assert.equal(service.hasActiveGeneration(), true)
    assert.equal(adapter.cancels.length, 0)
    assert.equal(
      sessionEvents(events, sessionId).some((event) => event.event === "messageError"),
      false,
    )

    adapter.completeAssistantTurn(sessionId, "slow-reply", "done")
  } finally {
    vi.useRealTimers()
  }
})

test("external plan turns keep the registered project read-only and use managed output directories", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "wanta-external-plan-project-"))
  const { service, adapters } = createHarness(["claude-code"], {
    projectStore: {
      read: async () =>
        new Map([
          [
            "project-1",
            {
              id: "project-1",
              name: "Project",
              path: projectRoot,
              createdAt: 1,
              updatedAt: 1,
              scope: localScope,
            },
          ],
        ]),
    },
  })
  const adapter = adapters.get("claude-code")
  assert.ok(adapter)
  const sessionId = mintExternalSessionId("claude-code")

  await service.sendMessage(
    sendRequest(sessionId, "inspect the project", {
      mode: "plan",
      projectContext: { id: "project-1", name: "Project", path: projectRoot },
    }),
  )
  await waitForCondition(() => adapter.prompts.length === 1, "external plan prompt")

  const prompt = adapter.prompts[0]
  assert.equal(prompt?.outputProjectRoot, undefined)
  assert.equal(prompt?.workingDirectory, undefined)
  assert.ok(prompt?.artifactDir)
  assert.equal(prompt.artifactDir.startsWith(projectRoot), false)

  adapter.completeAssistantTurn(sessionId, "assistant-plan", "done")
  await waitForTurnCompletion(service)
})

test("edge1: attachment send into an external session records the attachment and forwards it to the adapter", async () => {
  const record = vi.fn(async () => undefined)
  const removeMessage = vi.fn(async () => undefined)
  const attachmentStore = {
    read: async () => new Map(),
    record,
    removeMessage,
  } as unknown as UserAttachmentStore
  const attachment = await createProbeAttachment()
  const { service, events, adapters } = createHarness(["claude-code"], {
    userAttachmentStore: attachmentStore,
    // Picker authorization: attachment paths are trusted only when the user
    // selected them, mirrored here the way main.ts wires the shared set.
    trustedAttachmentPaths: new Set([attachment.path]),
  })
  const adapter = adapters.get("claude-code")
  assert.ok(adapter)
  const sessionId = mintExternalSessionId("claude-code")

  await service.sendMessage(sendRequest(sessionId, "please read this", { attachments: [attachment] }))

  // The adapter receives the attachments on the prompt, and the display
  // record ties them to the same user message id the adapter echoes back.
  assert.equal(adapter.prompts.length, 1)
  assert.deepEqual(adapter.prompts[0]?.attachments, [attachment])
  assert.equal(record.mock.calls.length, 1)
  const [recordedSessionId, recordedMessageId] = record.mock.calls[0] as unknown as [string, string]
  assert.equal(recordedSessionId, sessionId)
  assert.equal(recordedMessageId, adapter.prompts[0]?.messageId)
  assert.equal(removeMessage.mock.calls.length, 0)

  adapter.completeAssistantTurn(sessionId, "reply-1", "read it")
  await waitForTurnCompletion(service)
  const messages = await service.getMessages(sessionId)
  assert.equal(messages.length, 2)
  assert.equal(messages[0]?.role, "user")
  assert.equal(messages[1]?.role, "assistant")
  assert.deepEqual(
    events.filter((entry) => entry.event === "messageError"),
    [],
  )
})

test("edge1b: a failed attachment send rolls the display record back", async () => {
  const record = vi.fn(async () => undefined)
  const removeMessage = vi.fn(async () => undefined)
  const attachmentStore = {
    read: async () => new Map(),
    record,
    removeMessage,
  } as unknown as UserAttachmentStore
  const attachment = await createProbeAttachment()
  const { service, adapters, events } = createHarness(["claude-code"], {
    userAttachmentStore: attachmentStore,
    trustedAttachmentPaths: new Set([attachment.path]),
  })
  const adapter = adapters.get("claude-code")
  assert.ok(adapter)
  adapter.failNextPrompt = new Error("agent exploded")
  const sessionId = mintExternalSessionId("claude-code")

  await service.sendMessage(sendRequest(sessionId, "please read this", { attachments: [attachment] }))
  await waitForCondition(() => removeMessage.mock.calls.length === 1, "attachment record rollback")
  assert.equal(record.mock.calls.length, 1)
  assert.equal(service.hasActiveGeneration(), false)
  assert.ok(
    sessionEvents(events, sessionId).some(
      (event) =>
        event.event === "turnOutcome" &&
        (event.data as { kind?: string; reason?: string }).kind === "failed" &&
        (event.data as { kind?: string; reason?: string }).reason === "prompt_dispatch_failed",
    ),
  )
})

test("edge1c: an attachment path the user never authorized is rejected at the IPC boundary", async () => {
  // Attachment paths are renderer-supplied; without picker authorization a
  // compromised renderer could hand the agent any local file. The external
  // path must enforce the same trust boundary as the kernel path.
  const record = vi.fn(async () => undefined)
  const attachmentStore = {
    read: async () => new Map(),
    record,
    removeMessage: vi.fn(async () => undefined),
  } as unknown as UserAttachmentStore
  const { service, adapters } = createHarness(["claude-code"], {
    userAttachmentStore: attachmentStore,
    trustedAttachmentPaths: new Set<string>(),
  })
  const adapter = adapters.get("claude-code")
  assert.ok(adapter)
  const sessionId = mintExternalSessionId("claude-code")
  const attachment: ChatAttachment = {
    id: "att-evil",
    name: "id_rsa",
    mime: "application/octet-stream",
    size: 1,
    path: "/Users/someone/.ssh/id_rsa",
  }

  await assert.rejects(
    service.sendMessage(sendRequest(sessionId, "leak this", { attachments: [attachment] })),
    /not selected or previously authorized/,
  )
  assert.equal(adapter.prompts.length, 0)
  assert.equal(record.mock.calls.length, 0)
  assert.equal(service.hasActiveGeneration(), false)
})

// ---------------------------------------------------------------------------
// Edge 2: empty / whitespace-only prompt text
// ---------------------------------------------------------------------------

test("edge2 BUG: a whitespace-only prompt must not spawn a real external agent turn", async () => {
  // Root cause: sendExternalMessage (electron/chat/node.ts:1807) has no text
  // guard, and the prompt contract (electron/agent/contract/input.ts:124,
  // `text: z.string()`) accepts empty strings. The renderer composer blocks
  // empty submits (src/routes/Chat/ChatComposer.tsx:571,589,695), but the main
  // process is the IPC boundary: any non-composer caller (or renderer bug)
  // burns a real agent turn on blank content and leaves an active run stuck in
  // "submitted" until the 45s watchdog interrupts it.
  const { service, adapters } = createHarness(["claude-code"])
  const adapter = adapters.get("claude-code")
  assert.ok(adapter)
  const sessionId = mintExternalSessionId("claude-code")

  // Either a rejection or a resolved no-op is acceptable; a dispatched turn is not.
  await service.sendMessage(sendRequest(sessionId, "   \n\t ")).catch(() => undefined)
  await new Promise((resolve) => setTimeout(resolve, 20))

  // Desired behavior (fails today): the adapter never sees a blank prompt...
  assert.equal(adapter.prompts.length, 0)
  // ...and no generation/run is left behind for a turn that should not exist.
  assert.equal(service.hasActiveGeneration(), false)
  assert.equal(await service.getActiveRun(sessionId), null)
})

// ---------------------------------------------------------------------------
// Edge 3: very long unicode prompt round-trip
// ---------------------------------------------------------------------------

test("edge3: a 500KB unicode prompt round-trips through send -> adapter -> transcript unmodified", async () => {
  const { service, adapters } = createHarness(["claude-code"])
  const adapter = adapters.get("claude-code")
  assert.ok(adapter)
  const sessionId = mintExternalSessionId("claude-code")

  // Mixed scripts, combining marks, and surrogate pairs; sized in UTF-8 bytes.
  const seed = "深度思考🧠 exposé ünïçødé ¡ϩϫ! ザ・エッジ 🚀🌍 é̂\n"
  const repeats = Math.ceil((500 * 1024) / Buffer.byteLength(seed, "utf8"))
  const bigText = seed.repeat(repeats)
  assert.ok(Buffer.byteLength(bigText, "utf8") >= 500 * 1024)

  await service.sendMessage(sendRequest(sessionId, bigText))

  assert.equal(adapter.prompts.length, 1)
  const promptInput = adapter.prompts[0]
  assert.ok(promptInput)
  // Adapter receives the exact text (no truncation, no normalization).
  assert.equal(promptInput.text, bigText)
  assert.ok(promptInput.messageId)

  adapter.completeAssistantTurn(sessionId, "reply-big", "done")
  await waitForTurnCompletion(service)

  const messages = await service.getMessages(sessionId)
  const userMessage = messages.find((message) => message.id === promptInput.messageId)
  assert.ok(userMessage, "user turn present in the transcript")
  const textPart = userMessage.parts.find((part) => part.kind === "text")
  assert.ok(textPart && textPart.kind === "text" && textPart.text !== undefined)
  assert.equal(textPart.text.length, bigText.length)
  assert.equal(textPart.text, bigText)
})

// ---------------------------------------------------------------------------
// Edge 4: double-send race on one external session
// ---------------------------------------------------------------------------

test("edge4: a second send during an active external turn rejects; the first turn and a later third send are unaffected", async () => {
  const { service, events, adapters } = createHarness(["claude-code"])
  const adapter = adapters.get("claude-code")
  assert.ok(adapter)
  const sessionId = mintExternalSessionId("claude-code")

  // Same-tick race: fire both before either invoke settles.
  const first = service.sendMessage(sendRequest(sessionId, "first turn"))
  const second = service.sendMessage(sendRequest(sessionId, "second turn"))
  await assert.rejects(second, /A generation is already active for this session\./)
  await first

  // The first turn is untouched by the rejected racer.
  assert.equal(adapter.prompts.length, 1)
  assert.equal(adapter.prompts[0]?.text, "first turn")
  const activeRun = await service.getActiveRun(sessionId)
  assert.ok(activeRun, "first run still active")
  assert.deepEqual(
    events.filter((entry) => entry.event === "messageError" || entry.event === "generationInterrupted"),
    [],
  )

  // Completing the first turn frees the session for a third send.
  adapter.completeAssistantTurn(sessionId, "reply-first", "first answer")
  await waitForTurnCompletion(service)
  assert.equal(await service.getActiveRun(sessionId), null)

  await service.sendMessage(sendRequest(sessionId, "third turn"))
  assert.equal(adapter.prompts.length, 2)
  assert.equal(adapter.prompts[1]?.text, "third turn")
  adapter.completeAssistantTurn(sessionId, "reply-third", "third answer")
  await waitForTurnCompletion(service)
  assert.equal((await service.getMessages(sessionId)).filter((message) => message.role === "assistant").length, 2)
})

// ---------------------------------------------------------------------------
// Edge 5: permission reply routing across adapters and duplicate/unknown replies
// ---------------------------------------------------------------------------

test("edge5: answerPermission routes to the owning adapter, keeps 'always' verbatim, and tolerates duplicate and unknown ids", async () => {
  const { service, events, adapters } = createHarness(["claude-code", "codex"])
  const claude = adapters.get("claude-code")
  const codex = adapters.get("codex")
  assert.ok(claude && codex)
  const claudeSession = mintExternalSessionId("claude-code")
  const codexSession = mintExternalSessionId("codex")

  await service.sendMessage(sendRequest(claudeSession, "claude turn"))
  await service.sendMessage(sendRequest(codexSession, "codex turn"))
  claude.askPermission(claudeSession, "perm-claude")
  codex.askPermission(codexSession, "perm-codex")
  await waitForCondition(
    () => events.filter((entry) => entry.event === "permissionAsked").length >= 2,
    "permissionAsked broadcasts",
  )

  // Pending queries stay per-session.
  assert.deepEqual(
    (await service.getPendingPermissions(claudeSession)).map((request) => request.id),
    ["perm-claude"],
  )
  assert.deepEqual(
    (await service.getPendingPermissions(codexSession)).map((request) => request.id),
    ["perm-codex"],
  )

  // Reply routes only to the owning adapter; external sessions receive
  // "always" verbatim (chat/node.ts:2368-2369).
  await service.answerPermission({ sessionId: claudeSession, requestId: "perm-claude", reply: "always" })
  assert.equal(claude.permissionResponses.length, 1)
  assert.equal(claude.permissionResponses[0]?.reply, "always")
  assert.equal(claude.permissionResponses[0]?.sessionId, claudeSession)
  assert.equal(codex.permissionResponses.length, 0)
  assert.deepEqual(await service.getPendingPermissions(claudeSession), [])
  assert.deepEqual(
    (await service.getPendingPermissions(codexSession)).map((request) => request.id),
    ["perm-codex"],
  )

  // A sequential duplicate reply is a silent no-op (reconciled against the
  // adapter's pending list), not a crash and not a second adapter call.
  await service.answerPermission({ sessionId: claudeSession, requestId: "perm-claude", reply: "always" })
  assert.equal(claude.permissionResponses.length, 1)

  // An unknown request id resolves gracefully as well. Note: this is a silent
  // tolerance, not a named error; the adapter is never called.
  await service.answerPermission({ sessionId: claudeSession, requestId: "perm-that-never-existed", reply: "once" })
  assert.equal(claude.permissionResponses.length, 1)

  // Two concurrent replies to the same request: exactly one reaches the
  // adapter; the loser either reconciles silently or surfaces the adapter's
  // named unknown-request error. Neither crashes nor double-replies.
  const race = await Promise.allSettled([
    service.answerPermission({ sessionId: codexSession, requestId: "perm-codex", reply: "once" }),
    service.answerPermission({ sessionId: codexSession, requestId: "perm-codex", reply: "once" }),
  ])
  assert.equal(codex.permissionResponses.length, 1)
  assert.ok(race.some((entry) => entry.status === "fulfilled"))
  for (const entry of race) {
    if (entry.status === "rejected") {
      assert.match(String(entry.reason), /unknown permission request/)
    }
  }
  assert.deepEqual(await service.getPendingPermissions(codexSession), [])
})

// ---------------------------------------------------------------------------
// Edge 6: deleting an external session while its turn is running
// ---------------------------------------------------------------------------

test("edge6: removing an external session mid-turn cleans the run and blocks zombie events; sibling sessions are untouched", async () => {
  const { service: chatService, events, adapters } = createHarness(["claude-code"])
  const adapter = adapters.get("claude-code")
  assert.ok(adapter)

  // Session-store side, wired like electron/main.ts:274-283.
  let externalRecords = new Map<string, ExternalSessionRecord>()
  const externalSessionStore = {
    read: async () => externalRecords,
    write: async (next: Map<string, ExternalSessionRecord>) => {
      externalRecords = new Map(next)
    },
  } as ExternalSessionStore
  let metadata = new Map<string, SessionMetadata>()
  const metadataStore = {
    read: async () => metadata,
    write: async (next: Map<string, SessionMetadata>) => {
      metadata = new Map(next)
    },
  } as SessionMetadataStore
  const kernelStub = {
    listSessions: async () => [],
    deleteSession: async () => undefined,
  } as unknown as OpencodeAgentAdapter
  const sessionService = new SessionServiceImpl(kernelStub, {
    externalSessionStore,
    metadataStore,
    onSessionRemoved: async (sessionId) => {
      const kind = externalAgentKindForSessionId(sessionId)
      if (kind) {
        adapters.get(kind)?.forgetSession(sessionId)
      }
      await chatService.forgetSession(sessionId)
    },
  })
  ;(sessionService as unknown as { send: () => Promise<void> }).send = async () => undefined

  const doomed = await sessionService.create({ agentKind: "claude-code", scope: localScope, title: "doomed" })
  const survivor = await sessionService.create({ agentKind: "claude-code", scope: localScope, title: "survivor" })

  // Both sessions mid-turn on the same adapter; the doomed one also has a
  // pending permission so deletion must sweep interactive state too.
  await chatService.sendMessage(sendRequest(doomed.id, "doomed turn"))
  await chatService.sendMessage(sendRequest(survivor.id, "survivor turn"))
  adapter.startAssistantReply(doomed.id, "reply-doomed", "streaming...")
  adapter.startAssistantReply(survivor.id, "reply-survivor", "streaming...")
  adapter.askPermission(doomed.id, "perm-doomed")
  await waitForCondition(
    () => sessionEvents(events, doomed.id).some((entry) => entry.event === "permissionAsked"),
    "doomed permission broadcast",
  )
  assert.ok(await chatService.getActiveRun(doomed.id))

  await sessionService.remove(doomed.id)

  // Store record gone, run state cleared, pending permission swept.
  assert.equal(externalRecords.has(doomed.id), false)
  assert.equal(await chatService.getActiveRun(doomed.id), null)
  assert.deepEqual(await chatService.getPendingPermissions(doomed.id), [])
  assert.deepEqual(await chatService.getMessages(doomed.id), [])

  // Late native events for the deleted session never reach the renderer.
  const eventCountAfterRemoval = events.length
  adapter.emitEvent({
    event: "messageDelta",
    data: {
      sessionId: doomed.id,
      messageId: "reply-doomed",
      partId: "reply-doomed:text",
      text: "zombie delta",
      delta: "zombie delta",
    },
  })
  adapter.emitEvent({ event: "messageCompleted", data: { sessionId: doomed.id } })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(sessionEvents(events.slice(eventCountAfterRemoval), doomed.id), [])

  // The sibling session on the same adapter still completes normally.
  assert.ok(await chatService.getActiveRun(survivor.id), "survivor run still active")
  adapter.completeAssistantTurn(survivor.id, "reply-survivor", "streaming... done")
  await waitForTurnCompletion(chatService)
  const survivorMessages = await chatService.getMessages(survivor.id)
  assert.equal(survivorMessages.filter((message) => message.role === "assistant").length, 1)
  assert.ok(sessionEvents(events, survivor.id).some((entry) => entry.event === "messageCompleted"))
})

// ---------------------------------------------------------------------------
// Edge 7: wrong-kind session ids and a missing kernel
// ---------------------------------------------------------------------------

test("edge7: unknown backends degrade to empty reads and named send errors, never throws from read paths", async () => {
  // Only claude-code is registered; grok exists as a kind but has no adapter,
  // and the kernel is not configured at all.
  const { service } = createHarness(["claude-code"])
  const unregisteredGrok = mintExternalSessionId("grok")
  const unknownKind = `wanta-ext:mystery-agent:${randomUUID()}`
  const kernelSession = "ses_0123456789abcdef"

  for (const sessionId of [unregisteredGrok, unknownKind, kernelSession]) {
    assert.deepEqual(await service.getMessages(sessionId), [])
    assert.deepEqual(await service.getPendingPermissions(sessionId), [])
    assert.deepEqual(await service.getPendingQuestions(sessionId), [])
    const snapshot = await service.getSessionSnapshot(sessionId)
    assert.deepEqual(snapshot, {
      activeRun: null,
      messages: [],
      pendingPermissions: [],
      pendingQuestions: [],
      sessionId,
    })
    // stopGeneration for a missing backend is a silent no-op by design.
    await service.stopGeneration(sessionId)
  }

  // Sends fail loudly and leave no run residue.
  await assert.rejects(service.sendMessage(sendRequest(unregisteredGrok, "hi")), /This agent is not available\./)
  assert.equal(await service.getActiveRun(unregisteredGrok), null)
  await assert.rejects(service.sendMessage(sendRequest(kernelSession, "hi")), /Agent not configured/)
  assert.equal(service.hasActiveGeneration(), false)

  // External-only operations reject kernel ids with a named error.
  await assert.rejects(
    service.getExternalSessionSelection(kernelSession),
    /This operation only applies to external agent sessions\./,
  )
  await assert.rejects(
    service.setExternalSessionModel({ sessionId: kernelSession, modelId: "m" }),
    /This operation only applies to external agent sessions\./,
  )
})

test("edge7b: prototype-chain kind segments are not valid external kinds (in-operator spoof)", async () => {
  // `kind in AGENT_PROFILES` would treat inherited Object.prototype keys as
  // valid kinds; the parse must reject every one so a hostile id cannot defeat
  // the drop-on-read guard or route anywhere.
  for (const kind of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__", "isPrototypeOf"]) {
    assert.equal(externalAgentKindForSessionId(`wanta-ext:${kind}:${randomUUID()}`), undefined, kind)
  }

  // And such an id behaves like an unknown backend end-to-end: empty reads, no route.
  const { service } = createHarness(["claude-code"])
  const spoofed = `wanta-ext:constructor:${randomUUID()}`
  assert.deepEqual(await service.getMessages(spoofed), [])
  assert.deepEqual(await service.getSessionSnapshot(spoofed), {
    activeRun: null,
    messages: [],
    pendingPermissions: [],
    pendingQuestions: [],
    sessionId: spoofed,
  })
})

// ---------------------------------------------------------------------------
// Edge 8: local Grok owns its account, catalog, model, and effort
// ---------------------------------------------------------------------------

test("edge8: Grok ignores Wanta models and accepts its native model/effort mutations", async () => {
  const { service, events, adapters } = createHarness(["grok"])
  const grok = adapters.get("grok")
  assert.ok(grok)
  assert.equal(grok.profile.modelSource, "agent")
  assert.equal(grok.profile.auth.kind, "agent-cli")
  assert.equal(grok.profile.inputs.setModel, true)
  assert.equal(grok.profile.inputs.setEffort, true)
  const sessionId = mintExternalSessionId("grok")

  await service.sendMessage(
    sendRequest(sessionId, "ignore stale Wanta model", { model: { kind: "builtin", id: "oopilot" } }),
  )
  assert.equal(grok.prompts.length, 1)
  assert.equal(grok.prompts[0]?.model, undefined)
  grok.completeAssistantTurn(sessionId, "reply-knobs", "answered")
  await waitForTurnCompletion(service)
  assert.deepEqual(
    events.filter((entry) => entry.event === "messageError" || entry.event === "generationInterrupted"),
    [],
  )

  await service.setExternalSessionModel({ sessionId, modelId: "grok-4-fast" })
  await service.setExternalSessionEffort({ sessionId, effortId: "high" })
  assert.deepEqual(
    grok.setModels.map(({ modelId }) => modelId),
    ["grok-4-fast"],
  )
  assert.deepEqual(
    grok.setEfforts.map(({ effortId }) => effortId),
    ["high"],
  )
  await service.sendMessage(sendRequest(sessionId, "after native selection"))
  assert.equal(grok.prompts.length, 2)
  assert.equal(grok.prompts[1]?.model, undefined)
  grok.completeAssistantTurn(sessionId, "reply-after", "still native")
  await waitForTurnCompletion(service)
  assert.equal((await service.getMessages(sessionId)).filter((message) => message.role === "assistant").length, 2)
})

test("external authentication is delegated to the selected local agent", async () => {
  const { service, adapters } = createHarness(["grok"])
  const grok = adapters.get("grok")
  assert.ok(grok)

  const status = await service.authenticateExternalAgent({ kind: "grok", methodId: "grok.com" })

  assert.deepEqual(grok.authentications, [{ type: "authenticate", methodId: "grok.com" }])
  assert.equal(status.kind, "grok")
})

test("external model and effort choices are persisted per session", async () => {
  const persisted: Array<{ sessionId: string; patch: { modelId?: string | null; effortId?: string | null } }> = []
  const { service } = createHarness(["codex"], {
    onExternalSessionSelectionChanged: (sessionId, patch) => {
      persisted.push({ sessionId, patch })
    },
  })
  const sessionId = mintExternalSessionId("codex")

  await service.setExternalSessionModel({ sessionId, modelId: "sonnet" })
  await service.setExternalSessionEffort({ sessionId, effortId: "high" })
  await service.setExternalSessionModel({ sessionId })

  assert.deepEqual(persisted, [
    { sessionId, patch: { modelId: "sonnet" } },
    { sessionId, patch: { effortId: "high" } },
    { sessionId, patch: { modelId: null } },
  ])
})

test("a rejected prompt-borne selection is rolled back in session metadata", async () => {
  const persisted: Array<{ modelId?: string | null; effortId?: string | null }> = []
  const { service, adapters } = createHarness(["codex"], {
    onExternalSessionSelectionChanged: (_sessionId, patch) => {
      persisted.push(patch)
    },
  })
  const adapter = adapters.get("codex")
  assert.ok(adapter)
  const sessionId = mintExternalSessionId("codex")
  adapter.failNextPrompt = new Error("model rejected")

  await service.sendMessage(sendRequest(sessionId, "use this model", { agentModelId: "sonnet", agentEffortId: "high" }))
  await waitForCondition(() => persisted.length === 4, "prompt selection rollback")

  assert.deepEqual(persisted, [{ modelId: "sonnet" }, { effortId: "high" }, { modelId: null }, { effortId: null }])
  await waitForCondition(() => !service.hasActiveGeneration(), "failed prompt cleanup")
})

test("a rejected prompt rollback cannot overwrite a newer model selection", async () => {
  const persisted: Array<{ modelId?: string | null; effortId?: string | null }> = []
  const { service, adapters } = createHarness(["codex"], {
    onExternalSessionSelectionChanged: (_sessionId, patch) => {
      persisted.push(patch)
    },
  })
  const adapter = adapters.get("codex")
  assert.ok(adapter)
  const sessionId = mintExternalSessionId("codex")
  let releasePromptFailure!: () => void
  adapter.promptFailureBarrier = new Promise<void>((resolve) => (releasePromptFailure = resolve))
  adapter.failNextPrompt = new Error("prompt rejected")

  await service.sendMessage(sendRequest(sessionId, "use sonnet", { agentModelId: "sonnet" }))
  await waitForCondition(() => persisted.length === 1, "prompt selection persistence")
  await service.setExternalSessionModel({ sessionId, modelId: "haiku" })
  releasePromptFailure()
  await waitForCondition(() => !service.hasActiveGeneration(), "rejected prompt cleanup")

  assert.deepEqual(persisted, [{ modelId: "sonnet" }, { modelId: "haiku" }])
  assert.deepEqual(adapter.sessionSelection(sessionId), { modelId: "haiku" })
})

test("prompt rollback captures a direct selection that completed before prompt persistence", async () => {
  const persisted: Array<{ modelId?: string | null; effortId?: string | null }> = []
  const { service, adapters } = createHarness(["codex"], {
    onExternalSessionSelectionChanged: (_sessionId, patch) => {
      persisted.push(patch)
    },
  })
  const adapter = adapters.get("codex")
  assert.ok(adapter)
  const sessionId = mintExternalSessionId("codex")
  let releasePermissionMode!: () => void
  adapter.permissionModeBarrier = new Promise<void>((resolve) => (releasePermissionMode = resolve))
  adapter.failNextPrompt = new Error("prompt rejected")

  const prompt = service.sendMessage(sendRequest(sessionId, "use sonnet", { agentModelId: "sonnet" }))
  await waitForCondition(() => adapter.permissionModeBarrierEntries === 1, "permission-mode projection barrier")
  await service.setExternalSessionModel({ sessionId, modelId: "haiku" })
  releasePermissionMode()
  await prompt
  await waitForCondition(() => !service.hasActiveGeneration(), "rejected prompt cleanup")

  assert.deepEqual(persisted, [{ modelId: "haiku" }, { modelId: "sonnet" }, { modelId: "haiku" }])
  assert.deepEqual(adapter.sessionSelection(sessionId), { modelId: "haiku" })
})

test("forgetSession waits for pending selection persistence and removes its mutation bookkeeping", async () => {
  let releasePersistence!: () => void
  const persistenceBarrier = new Promise<void>((resolve) => (releasePersistence = resolve))
  let persistenceStarted = false
  const { service } = createHarness(["codex"], {
    onExternalSessionSelectionChanged: async (_sessionId, patch) => {
      if (patch.modelId === "sonnet") {
        persistenceStarted = true
        await persistenceBarrier
      }
    },
  })
  const sessionId = mintExternalSessionId("codex")
  const selection = service.setExternalSessionModel({ sessionId, modelId: "sonnet" })
  await waitForCondition(() => persistenceStarted, "pending selection persistence")

  let deletionSettled = false
  const deletion = service.forgetSession(sessionId).then(() => {
    deletionSettled = true
  })
  await Promise.resolve()
  assert.equal(deletionSettled, false)
  releasePersistence()
  await Promise.all([selection, deletion])

  const internals = service as unknown as {
    externalSelectionMutationTails: Map<string, Promise<void>>
    externalSelectionMutationTokens: Map<string, number>
    externalSelectionMutationSequences: Map<string, number>
  }
  for (const axis of ["model", "effort"] as const) {
    const key = `${sessionId}\0${axis}`
    assert.equal(internals.externalSelectionMutationTails.has(key), false)
    assert.equal(internals.externalSelectionMutationTokens.has(key), false)
    assert.equal(internals.externalSelectionMutationSequences.has(key), false)
  }
})

test("a prompt failure after session deletion cannot enqueue a late selection rollback", async () => {
  const persisted: Array<{ modelId?: string | null; effortId?: string | null }> = []
  const { service, adapters } = createHarness(["codex"], {
    onExternalSessionSelectionChanged: (_sessionId, patch) => {
      persisted.push(patch)
    },
  })
  const adapter = adapters.get("codex")
  assert.ok(adapter)
  const sessionId = mintExternalSessionId("codex")
  let releasePromptFailure!: () => void
  adapter.promptFailureBarrier = new Promise<void>((resolve) => (releasePromptFailure = resolve))
  adapter.failNextPrompt = new Error("prompt rejected after deletion")

  await service.sendMessage(sendRequest(sessionId, "use sonnet", { agentModelId: "sonnet" }))
  await waitForCondition(() => persisted.length === 1, "prompt selection persistence")
  // Prompt selection persistence has settled, so deletion observes an idle
  // queue. The native prompt rejection is deliberately released afterwards.
  await service.forgetSession(sessionId)
  releasePromptFailure()
  await waitForCondition(() => adapter.promptFailureBarrier === undefined, "late prompt rejection")

  assert.deepEqual(persisted, [{ modelId: "sonnet" }])
  await assert.rejects(
    service.setExternalSessionModel({ sessionId, modelId: "haiku" }),
    /external agent session was deleted/u,
  )
  const internals = service as unknown as {
    externalSelectionMutationTails: Map<string, Promise<void>>
    externalSelectionMutationTokens: Map<string, number>
    externalSelectionMutationSequences: Map<string, number>
  }
  for (const axis of ["model", "effort"] as const) {
    const key = `${sessionId}\0${axis}`
    assert.equal(internals.externalSelectionMutationTails.has(key), false)
    assert.equal(internals.externalSelectionMutationTokens.has(key), false)
    assert.equal(internals.externalSelectionMutationSequences.has(key), false)
  }
})

test("external model and effort updates stay ordered when persistence overlaps", async () => {
  let releaseModelPersistence!: () => void
  let releaseEffortPersistence!: () => void
  const modelPersistence = new Promise<void>((resolve) => (releaseModelPersistence = resolve))
  const effortPersistence = new Promise<void>((resolve) => (releaseEffortPersistence = resolve))
  const persisted: Array<{ modelId?: string | null; effortId?: string | null }> = []
  const { service, adapters } = createHarness(["codex"], {
    onExternalSessionSelectionChanged: async (_sessionId, patch) => {
      persisted.push(patch)
      if (patch.modelId === "first-model") await modelPersistence
      if (patch.effortId === "first-effort") await effortPersistence
    },
  })
  const adapter = adapters.get("codex")
  assert.ok(adapter)
  const sessionId = mintExternalSessionId("codex")

  const firstModel = service.setExternalSessionModel({ sessionId, modelId: "first-model" })
  const secondModel = service.setExternalSessionModel({ sessionId, modelId: "second-model" })
  await waitForCondition(() => adapter.setModels.length === 1, "first model update")
  assert.deepEqual(adapter.sessionSelection(sessionId), { modelId: "first-model" })
  releaseModelPersistence()
  await Promise.all([firstModel, secondModel])

  const firstEffort = service.setExternalSessionEffort({ sessionId, effortId: "first-effort" })
  const secondEffort = service.setExternalSessionEffort({ sessionId, effortId: "second-effort" })
  await waitForCondition(() => adapter.setEfforts.length === 1, "first effort update")
  assert.deepEqual(adapter.sessionSelection(sessionId), {
    modelId: "second-model",
    effortId: "first-effort",
  })
  releaseEffortPersistence()
  await Promise.all([firstEffort, secondEffort])

  assert.deepEqual(
    adapter.setModels.map(({ modelId }) => modelId),
    ["first-model", "second-model"],
  )
  assert.deepEqual(
    adapter.setEfforts.map(({ effortId }) => effortId),
    ["first-effort", "second-effort"],
  )
  assert.deepEqual(persisted, [
    { modelId: "first-model" },
    { modelId: "second-model" },
    { effortId: "first-effort" },
    { effortId: "second-effort" },
  ])
  assert.deepEqual(adapter.sessionSelection(sessionId), {
    modelId: "second-model",
    effortId: "second-effort",
  })
})

test("a rejected native permission mode rolls host metadata back and a queued retry can succeed", async () => {
  const persistedModes: AgentPermissionMode[] = []
  const { service, adapters } = createHarness(["codex"], {
    onPermissionModeChanged: async (_sessionId, mode) => {
      persistedModes.push(mode)
    },
  })
  const adapter = adapters.get("codex")
  assert.ok(adapter)
  const sessionId = mintExternalSessionId("codex")
  adapter.failNextPermissionMode = new Error("mode refused")

  const rejected = service.setPermissionMode({ sessionId, permissionMode: "full_access", version: 1 })
  const retry = service.setPermissionMode({ sessionId, permissionMode: "full_access", version: 2 })

  await assert.rejects(rejected, /mode refused/)
  await retry
  assert.deepEqual(persistedModes, ["full_access", "default", "full_access"])
  assert.deepEqual(adapter.permissionModes, [{ sessionId, mode: "full_access" }])
})

test("external turns receive the same Wanta team and Link identity instead of falling back to a default workspace", async () => {
  const { service, adapters } = createHarness(["codex"])
  service.setLinkRuntime("oomol")
  const codex = adapters.get("codex")
  assert.ok(codex)
  const sessionId = mintExternalSessionId("codex")

  await service.sendMessage(
    sendRequest(sessionId, "query PostHog", {
      scope: { kind: "team", teamId: "team-id", teamName: " OOMOL-Internal " },
      appLocale: "zh-CN",
      permissionMode: "default",
      teamSkills: [{ id: "posthog", name: "PostHog", description: "Analyze product usage" }],
    }),
  )

  assert.equal(codex.prompts.length, 1)
  assert.equal(codex.prompts[0]?.teamName, "OOMOL-Internal")
  assert.match(codex.prompts[0]?.system ?? "", /Current-turn Wanta Link workspace: team "OOMOL-Internal"/)
  assert.match(codex.prompts[0]?.system ?? "", /--team "OOMOL-Internal"/)
  assert.match(codex.prompts[0]?.system ?? "", /Team-configured skills for the active workspace/)
  assert.match(codex.prompts[0]?.system ?? "", /Default Access with Wanta's shared approval policy/)
  assert.match(codex.prompts[0]?.system ?? "", /application interface language: Simplified Chinese/)

  codex.completeAssistantTurn(sessionId, "reply", "done")
  await waitForTurnCompletion(service)
})

// ---------------------------------------------------------------------------
// Edge 5b: malformed external ids fail closed before adapter routing
// ---------------------------------------------------------------------------

test("edge5b: a malformed external session uuid is never routed to an adapter", async () => {
  const { service, adapters } = createHarness(["codex"])
  const codex = adapters.get("codex")
  assert.ok(codex)
  const malformedSessionId = "wanta-ext:codex:legacy-imported-session"

  await assert.rejects(
    service.sendMessage(sendRequest(malformedSessionId, "run something")),
    /Invalid or unsupported external agent session/,
  )
  assert.equal(codex.prompts.length, 0)
})
