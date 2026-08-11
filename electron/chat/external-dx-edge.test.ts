import type { AgentEvent } from "../agent/contract/event.ts"
import type {
  AgentSendOptions,
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
import type { ChatAttachment, ChatPermissionRequest, SendMessageRequest } from "./common.ts"
import type { UserAttachmentStore } from "./user-attachments.ts"

import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test, vi } from "vitest"
import { AGENT_PROFILES } from "../agent/contract/profile.ts"
import { ExternalAgentAdapter } from "../agent/external/adapter-base.ts"
import { externalAgentKindForSessionId, mintExternalSessionId } from "../agent/external/session-id.ts"
import { SessionServiceImpl } from "../session/node.ts"
import { ChatServiceImpl } from "./node.ts"

// Adversarial DX edge tests for the CHAT SERVICE external (BYOA) paths:
// electron/chat/node.ts sendExternalMessage / permission routing / backend
// resolution, plus the session-removal composition wired in electron/main.ts
// (SessionServiceImpl.remove -> adapter.forgetSession + chatService.forgetSession).
//
// The adapter layer itself (claude/acp adapters, transcript store) is covered by
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
 *   Claude adapter does (adapter.ts:284-299), and records the input.
 * - handlePermissionResponse resolves known ids and throws the same named error
 *   the Claude adapter uses for unknown ids.
 * - handleSetModel/handleSetEffort are gated on the profile flags exactly like
 *   the generic ACP adapter (acp/adapter.ts:529-541).
 * Assistant progress is driven explicitly by each test via emit helpers.
 */
class FakeExternalAdapter extends ExternalAgentAdapter {
  public override readonly kind: ExternalAgentKind
  public override readonly profile: AgentProfile
  public readonly prompts: PromptAgentInput[] = []
  public readonly cancels: CancelAgentInput[] = []
  public readonly permissionResponses: PermissionResponseAgentInput[] = []
  public readonly setModels: SetModelAgentInput[] = []
  public readonly setEfforts: SetEffortAgentInput[] = []
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
  }

  protected override async handleSetEffort(input: SetEffortAgentInput): Promise<void> {
    if (!this.profile.inputs.setEffort) {
      return this.rejectUnsupportedInput("set-effort")
    }
    this.setEfforts.push(input)
  }

  public runtimeStatus(): Promise<ExternalAgentRuntimeStatus> {
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
      action: "write_file",
      resources: [`/fake/${requestId}.txt`],
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
  const service = new ChatServiceImpl(null, { ...deps })
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

// ---------------------------------------------------------------------------
// Edge 1: attachments into an external session
// ---------------------------------------------------------------------------

test("edge1: attachment send into an external session rejects cleanly and leaves zero run residue", async () => {
  const record = vi.fn(async () => undefined)
  const removeMessage = vi.fn(async () => undefined)
  const attachmentStore = {
    read: async () => new Map(),
    record,
    removeMessage,
  } as unknown as UserAttachmentStore
  const { service, events, adapters } = createHarness(["claude-code"], { userAttachmentStore: attachmentStore })
  const adapter = adapters.get("claude-code")
  assert.ok(adapter)
  const sessionId = mintExternalSessionId("claude-code")
  const attachment: ChatAttachment = {
    id: "att-1",
    name: "notes.md",
    mime: "text/markdown",
    size: 12,
    path: "/tmp/notes.md",
  }

  await assert.rejects(
    service.sendMessage(sendRequest(sessionId, "please read this", { attachments: [attachment] })),
    /Attachments are not supported for this agent yet\./,
  )

  // No half-created generation: no active run, no adapter dispatch, no
  // optimistic user message in the transcript, no attachment record written.
  assert.equal(service.hasActiveGeneration(), false)
  assert.equal(await service.getActiveRun(sessionId), null)
  assert.equal(adapter.prompts.length, 0)
  assert.deepEqual(await service.getMessages(sessionId), [])
  assert.equal(record.mock.calls.length, 0)
  assert.equal(removeMessage.mock.calls.length, 0)
  assert.deepEqual(
    events.filter((entry) => entry.event === "messageError"),
    [],
  )

  // A follow-up plain-text send into the same session works end to end.
  await service.sendMessage(sendRequest(sessionId, "hello without attachments"))
  assert.equal(adapter.prompts.length, 1)
  adapter.completeAssistantTurn(sessionId, "reply-1", "hi")
  await waitForTurnCompletion(service)
  const messages = await service.getMessages(sessionId)
  assert.equal(messages.length, 2)
  assert.equal(messages[0]?.role, "user")
  assert.equal(messages[1]?.role, "assistant")
  assert.ok(events.some((entry) => entry.event === "messageCompleted"))
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

// ---------------------------------------------------------------------------
// Edge 8: model/effort knobs against an agent that declares setEffort false
// ---------------------------------------------------------------------------

test("edge8: prompt-borne model/effort ids are forwarded verbatim and never kill the turn; direct set-effort rejects with a named error", async () => {
  const { service, events, adapters } = createHarness(["grok"])
  const grok = adapters.get("grok")
  assert.ok(grok)
  assert.equal(grok.profile.inputs.setModel, true)
  assert.equal(grok.profile.inputs.setEffort, false)
  const sessionId = mintExternalSessionId("grok")

  // The chat layer forwards both knobs on the prompt (chat/node.ts:1859-1860);
  // the contract schema accepts them regardless of profile flags, and the
  // adapter owns the decision. The turn must run to completion.
  await service.sendMessage(
    sendRequest(sessionId, "with knobs", { agentModelId: "grok-4-fast", agentEffortId: "high" }),
  )
  assert.equal(grok.prompts.length, 1)
  assert.equal(grok.prompts[0]?.agentModelId, "grok-4-fast")
  assert.equal(grok.prompts[0]?.agentEffortId, "high")
  grok.completeAssistantTurn(sessionId, "reply-knobs", "answered")
  await waitForTurnCompletion(service)
  assert.deepEqual(
    events.filter((entry) => entry.event === "messageError" || entry.event === "generationInterrupted"),
    [],
  )

  // The supported axis works through the dedicated invoke...
  await service.setExternalSessionModel({ sessionId, modelId: "grok-4-fast" })
  assert.equal(grok.setModels.length, 1)

  // ...the undeclared axis rejects with the contract's named error and does
  // not poison the session for later turns.
  await assert.rejects(service.setExternalSessionEffort({ sessionId, effortId: "high" }), /set-effort is not supported/)
  await service.sendMessage(sendRequest(sessionId, "after rejection"))
  assert.equal(grok.prompts.length, 2)
  grok.completeAssistantTurn(sessionId, "reply-after", "still fine")
  await waitForTurnCompletion(service)
  assert.equal((await service.getMessages(sessionId)).filter((message) => message.role === "assistant").length, 2)
})

// ---------------------------------------------------------------------------
// Edge 5b: external permission asks always surface, even for malformed uuids
// ---------------------------------------------------------------------------

test("edge5b: a malformed external session uuid still surfaces the agent's permission request as a prompt", async () => {
  // External permission policy is pass-through: the agent's CLI decided the
  // action needs explicit approval, so the ask must reach the user as a card
  // and never be answered automatically. The external check keys off
  // externalAgentKindForSessionId (is this an external session at all), never
  // off whether any session detail happens to be derivable, so a junk uuid
  // fails closed to the same prompt.
  const { service, events, adapters } = createHarness(["codex"])
  const codex = adapters.get("codex")
  assert.ok(codex)
  // Valid kind prefix, junk uuid: routes to the codex adapter everywhere.
  const malformedSessionId = "wanta-ext:codex:legacy-imported-session"

  await service.sendMessage(sendRequest(malformedSessionId, "run something"))
  assert.equal(codex.prompts.length, 1)
  codex.askPermission(malformedSessionId, "perm-malformed")
  await waitForCondition(
    () =>
      sessionEvents(events, malformedSessionId).some(
        (entry) => entry.event === "permissionAsked" || entry.event === "permissionReplied",
      ),
    "permission settlement",
  )

  // Desired behavior (fails today): the request surfaces to the user...
  assert.ok(
    sessionEvents(events, malformedSessionId).some((entry) => entry.event === "permissionAsked"),
    "permission request must reach the renderer as a prompt",
  )
  // ...and is never answered automatically on the user's behalf.
  assert.equal(codex.permissionResponses.length, 0)
})
