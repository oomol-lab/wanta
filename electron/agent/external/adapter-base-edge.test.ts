import type { AgentEvent } from "../contract/event.ts"
import type { AgentSendOptions, CancelAgentInput, PromptAgentInput } from "../contract/input.ts"
import type { ExternalAgentAdapterOptions } from "./adapter-base.ts"
import type { ExternalAgentRuntimeStatus } from "./status.ts"

import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AGENT_PROFILES } from "../contract/profile.ts"
import { ExternalAgentAdapter } from "./adapter-base.ts"
import { externalSessionUuid } from "./session-id.ts"
import { ExternalTranscriptStore } from "./transcript-store.ts"

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

// Adversarial edge-case coverage for external transcript persistence and
// hydration: corrupted on-disk files, sanitizer interplay on restored
// sessions, forget/stop races, cross-session isolation, hydration races, and
// round-trip fidelity. Failing tests in this file document real defects — do
// not "fix" the test without fixing the production code it indicts.

const TRANSCRIPT_DEBOUNCE_WAIT_MS = 800

function sessionIdFor(uuid: string): string {
  return `wanta-ext:claude-code:${uuid}`
}

const SESSION_A = sessionIdFor("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
const SESSION_B = sessionIdFor("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

class FakeExternalAdapter extends ExternalAgentAdapter {
  public readonly kind = "claude-code"
  public readonly profile = AGENT_PROFILES["claude-code"]
  /** Mimic an external adapter: a prompt synthesizes the user turn via emit(). */
  public promptEmitsUserTurn = false
  private promptSeq = 0

  public constructor(options: ExternalAgentAdapterOptions) {
    super(options)
  }

  public emitForTest(event: AgentEvent): void {
    this.emit(event)
  }

  public restoredContextForTest(sessionId: string, maxCharacters: number): string | undefined {
    return this.restoredConversationContext(sessionId, maxCharacters)
  }

  public runtimeStatus(): Promise<ExternalAgentRuntimeStatus> {
    return Promise.resolve({
      kind: "claude-code",
      displayName: "Claude Code",
      binary: { status: "detected", path: "/fake/claude" },
      login: { status: "logged_in" },
      loginHint: "",
    })
  }

  protected handleStart(): Promise<void> {
    return Promise.resolve()
  }

  protected handleStop(): Promise<void> {
    return Promise.resolve()
  }

  protected handlePrompt(input: PromptAgentInput, _options?: AgentSendOptions): Promise<void> {
    if (this.promptEmitsUserTurn) {
      this.promptSeq += 1
      const messageId = `prompt-user-${this.promptSeq}`
      this.emit({
        event: "messageStarted",
        data: { sessionId: input.sessionId, messageId, role: "user" },
      })
      this.emit({
        event: "messageDelta",
        data: { sessionId: input.sessionId, messageId, partId: `${messageId}:0`, text: input.text },
      })
    }
    return Promise.resolve()
  }

  protected handleCancel(_input: CancelAgentInput, _options?: AgentSendOptions): Promise<void> {
    return Promise.resolve()
  }
}

function assistantTurn(sessionId: string, messageId: string, text: string): AgentEvent[] {
  return [
    { event: "messageStarted", data: { sessionId, messageId, role: "assistant" } },
    { event: "messageDelta", data: { sessionId, messageId, partId: `${messageId}:0`, text } },
    { event: "messageCompleted", data: { sessionId } },
  ]
}

function transcriptPath(transcriptDir: string, sessionId: string): string {
  return path.join(transcriptDir, `${externalSessionUuid(sessionId) ?? encodeURIComponent(sessionId)}.json`)
}

it("omits an oversized newest message from restored conversation context", () => {
  const adapter = new FakeExternalAdapter({})
  for (const event of assistantTurn(SESSION_A, "oversized", "x".repeat(200))) adapter.emitForTest(event)
  expect(adapter.restoredContextForTest(SESSION_A, 100)).toBeUndefined()
})

async function writeTranscriptFile(transcriptDir: string, sessionId: string, content: string): Promise<void> {
  await writeFile(transcriptPath(transcriptDir, sessionId), content, "utf8")
}

async function readTranscriptJson(transcriptDir: string, sessionId: string): Promise<unknown> {
  const raw = await readFile(transcriptPath(transcriptDir, sessionId), "utf8")
  return JSON.parse(raw)
}

async function fileExists(filePath: string): Promise<boolean> {
  return stat(filePath).then(
    () => true,
    () => false,
  )
}

function validTranscriptJson(messages: unknown[]): string {
  return JSON.stringify({ version: 1, messages })
}

function userMessage(id: string, text: string): unknown {
  return { id, role: "user", parts: [{ kind: "text", partId: `${id}:0`, text }], createdAt: 1 }
}

function assistantMessage(id: string, text: string): unknown {
  return {
    id,
    role: "assistant",
    parts: [{ kind: "text", partId: `${id}:0`, text }],
    createdAt: 2,
    completedAt: 3,
    finishReason: "stop",
  }
}

const cleanups: string[] = []
const startedAdapters: Array<{ stop: () => Promise<void> }> = []

afterEach(async () => {
  for (const adapter of startedAdapters.splice(0)) {
    await adapter.stop().catch(() => undefined)
  }
  for (const dir of cleanups.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
})

async function makeTranscriptDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-transcripts-edge-"))
  cleanups.push(dir)
  return dir
}

async function makeAdapter(transcriptDir: string): Promise<FakeExternalAdapter> {
  const adapter = new FakeExternalAdapter({ transcriptDir })
  await adapter.start()
  startedAdapters.push(adapter)
  return adapter
}

// ─── 1. Corrupted on-disk transcripts ───────────────────────────────────────

describe("corrupted on-disk transcripts", () => {
  it("degrades to empty for truncated JSON and still persists a later turn", async () => {
    const transcriptDir = await makeTranscriptDir()
    await writeTranscriptFile(transcriptDir, SESSION_A, '{"version":1,"messages":[{"id":"m1"')

    const adapter = await makeAdapter(transcriptDir)
    await expect(adapter.getMessages(SESSION_A)).resolves.toEqual([])

    for (const event of assistantTurn(SESSION_A, "m-new", "recovered")) {
      adapter.emitForTest(event)
    }
    await adapter.stop()

    const reopened = await makeAdapter(transcriptDir)
    const messages = await reopened.getMessages(SESSION_A)
    expect(messages.map((message) => message.id)).toEqual(["m-new"])
  })

  it("degrades to empty for garbage bytes and a JSON `null` document", async () => {
    const transcriptDir = await makeTranscriptDir()
    await writeTranscriptFile(transcriptDir, SESSION_A, "not json at all {{{")
    // JSON.parse("null") succeeds; the shape check must survive a null root.
    await writeTranscriptFile(transcriptDir, SESSION_B, "null")

    const adapter = await makeAdapter(transcriptDir)
    await expect(adapter.getMessages(SESSION_A)).resolves.toEqual([])
    await expect(adapter.getMessages(SESSION_B)).resolves.toEqual([])
  })

  it("degrades to empty for valid JSON with a wrong top-level shape", async () => {
    const transcriptDir = await makeTranscriptDir()
    const shapes: Array<[string, string]> = [
      [sessionIdFor("00000000-0000-4000-8000-000000000001"), '{"messages":[]}'],
      [sessionIdFor("00000000-0000-4000-8000-000000000002"), '{"version":2,"messages":[]}'],
      [sessionIdFor("00000000-0000-4000-8000-000000000003"), '{"version":1,"messages":{}}'],
      [sessionIdFor("00000000-0000-4000-8000-000000000004"), '"just a string"'],
      [sessionIdFor("00000000-0000-4000-8000-000000000005"), "42"],
    ]
    for (const [sessionId, content] of shapes) {
      await writeTranscriptFile(transcriptDir, sessionId, content)
    }

    const adapter = await makeAdapter(transcriptDir)
    for (const [sessionId] of shapes) {
      await expect(adapter.getMessages(sessionId)).resolves.toEqual([])
    }
  })

  it("degrades gracefully when the messages array contains null entries", async () => {
    // {"version":1,"messages":[null]} passes the store's shape check
    // (version === 1, Array.isArray) but recorder.restore() dereferences
    // message.id on the null entry.
    const transcriptDir = await makeTranscriptDir()
    await writeTranscriptFile(transcriptDir, SESSION_A, validTranscriptJson([null]))

    const adapter = await makeAdapter(transcriptDir)
    await expect(adapter.getMessages(SESSION_A)).resolves.toEqual([])
  })

  it("degrades gracefully when a restored message lacks a parts array", async () => {
    const transcriptDir = await makeTranscriptDir()
    await writeTranscriptFile(transcriptDir, SESSION_A, validTranscriptJson([{ id: "m1", role: "user", createdAt: 1 }]))

    const adapter = await makeAdapter(transcriptDir)
    await expect(adapter.getMessages(SESSION_A)).resolves.toEqual([])
  })

  it("a malformed transcript must not permanently poison the session", async () => {
    // The one-shot hydration promise is memoized; if it rejects, every later
    // getMessages AND every later prompt (send() awaits hydration) must not
    // keep rejecting forever — the session would otherwise be bricked until
    // app restart even though the in-memory recorder is perfectly healthy.
    const transcriptDir = await makeTranscriptDir()
    await writeTranscriptFile(transcriptDir, SESSION_A, validTranscriptJson([null]))

    const adapter = await makeAdapter(transcriptDir)
    await adapter.getMessages(SESSION_A).catch(() => undefined)
    await expect(adapter.getMessages(SESSION_A)).resolves.toEqual([])
    await expect(adapter.send({ type: "prompt", sessionId: SESSION_A, text: "hello" })).resolves.toBeUndefined()
  })

  it("a corrupted session never damages other sessions' transcripts", async () => {
    const transcriptDir = await makeTranscriptDir()
    await writeTranscriptFile(transcriptDir, SESSION_A, validTranscriptJson([null]))
    await writeTranscriptFile(
      transcriptDir,
      SESSION_B,
      validTranscriptJson([userMessage("b-u1", "b question"), assistantMessage("b-a1", "b answer")]),
    )

    const adapter = await makeAdapter(transcriptDir)
    // Touch the corrupted session first (whatever the outcome).
    await adapter.getMessages(SESSION_A).catch(() => undefined)

    // A normal turn in the healthy session must append, not overwrite.
    await adapter.send({ type: "prompt", sessionId: SESSION_B, text: "continue" })
    for (const event of assistantTurn(SESSION_B, "b-a2", "b second answer")) {
      adapter.emitForTest(event)
    }
    await adapter.stop()

    const reopened = await makeAdapter(transcriptDir)
    const messages = await reopened.getMessages(SESSION_B)
    expect(messages.map((message) => message.id)).toEqual(["b-u1", "b-a1", "b-a2"])
    // The corrupted file itself must not have been rewritten or deleted as a
    // side effect of the other session's save traffic.
    expect(await readFile(transcriptPath(transcriptDir, SESSION_A), "utf8")).toBe(validTranscriptJson([null]))
  })
})

// ─── 2. Empty and empty-ish files ───────────────────────────────────────────

describe("empty and empty-ish transcript files", () => {
  it("treats a 0-byte file as no history and appends normally afterwards", async () => {
    const transcriptDir = await makeTranscriptDir()
    await writeTranscriptFile(transcriptDir, SESSION_A, "")

    const adapter = await makeAdapter(transcriptDir)
    await expect(adapter.getMessages(SESSION_A)).resolves.toEqual([])
    for (const event of assistantTurn(SESSION_A, "m1", "after empty")) {
      adapter.emitForTest(event)
    }
    await adapter.stop()

    const reopened = await makeAdapter(transcriptDir)
    expect((await reopened.getMessages(SESSION_A)).map((message) => message.id)).toEqual(["m1"])
  })

  it("treats a bare `[]` document as no history", async () => {
    const transcriptDir = await makeTranscriptDir()
    await writeTranscriptFile(transcriptDir, SESSION_A, "[]")

    const adapter = await makeAdapter(transcriptDir)
    await expect(adapter.getMessages(SESSION_A)).resolves.toEqual([])
  })

  it("treats a well-formed empty transcript ({messages: []}) as no history", async () => {
    const transcriptDir = await makeTranscriptDir()
    await writeTranscriptFile(transcriptDir, SESSION_A, validTranscriptJson([]))

    const adapter = await makeAdapter(transcriptDir)
    await expect(adapter.getMessages(SESSION_A)).resolves.toEqual([])
    for (const event of assistantTurn(SESSION_A, "m1", "first real turn")) {
      adapter.emitForTest(event)
    }
    await adapter.stop()

    const reopened = await makeAdapter(transcriptDir)
    expect((await reopened.getMessages(SESSION_A)).map((message) => message.id)).toEqual(["m1"])
  })
})

// ─── 3. forgetSession / stop races ──────────────────────────────────────────

describe("forgetSession and stop() races", () => {
  it("forgetSession cancels a pending debounced save and deletes the file", async () => {
    const transcriptDir = await makeTranscriptDir()
    const adapter = await makeAdapter(transcriptDir)
    // Delta without completion => only a debounced save is pending.
    adapter.emitForTest({ event: "messageStarted", data: { sessionId: SESSION_A, messageId: "m1", role: "assistant" } })
    adapter.emitForTest({
      event: "messageDelta",
      data: { sessionId: SESSION_A, messageId: "m1", partId: "m1:0", text: "doomed" },
    })
    adapter.forgetSession(SESSION_A)
    // stop() awaits the queued remove op.
    await adapter.stop()
    expect(await readdir(transcriptDir)).toEqual([])
    // A cancelled debounce timer must not fire late and rewrite the file.
    await sleep(TRANSCRIPT_DEBOUNCE_WAIT_MS)
    expect(await readdir(transcriptDir)).toEqual([])
  })

  it("forgetSession queued behind an in-flight flush still deletes the file", async () => {
    const transcriptDir = await makeTranscriptDir()
    const adapter = await makeAdapter(transcriptDir)
    for (const event of assistantTurn(SESSION_A, "m1", "flushed then deleted")) {
      adapter.emitForTest(event)
    }
    // The messageCompleted flush op is now queued/in flight; remove must chain
    // behind it and win.
    adapter.forgetSession(SESSION_A)
    await adapter.stop()
    expect(await readdir(transcriptDir)).toEqual([])
  })

  it("an event arriving after forgetSession must not resurrect the transcript file", async () => {
    // Reachable in production: the Claude query loop drains already-buffered
    // SDK frames after handleForgetSession closes the query, and every emit
    // schedules a save with no forgotten-session tombstone in the base class.
    const transcriptDir = await makeTranscriptDir()
    const adapter = await makeAdapter(transcriptDir)
    for (const event of assistantTurn(SESSION_A, "m1", "will be deleted")) {
      adapter.emitForTest(event)
    }
    adapter.forgetSession(SESSION_A)
    await vi.waitFor(async () => {
      expect(await fileExists(transcriptPath(transcriptDir, SESSION_A))).toBe(false)
    })

    // A straggler frame for the deleted session arrives afterwards.
    adapter.emitForTest({
      event: "messageDelta",
      data: { sessionId: SESSION_A, messageId: "m-late", partId: "m-late:0", text: "zombie" },
    })
    await sleep(TRANSCRIPT_DEBOUNCE_WAIT_MS)
    expect(await fileExists(transcriptPath(transcriptDir, SESSION_A))).toBe(false)
  })

  it("an already-aborted prompt after forgetSession must not clear the tombstone and resurrect the file", async () => {
    // The delete flow aborts the generation, then a resumed sendExternalMessage
    // dispatches the prompt with an aborted signal. That send must NOT reopen the
    // late-event gate, or a still-draining native frame would rewrite the file.
    const transcriptDir = await makeTranscriptDir()
    const adapter = await makeAdapter(transcriptDir)
    for (const event of assistantTurn(SESSION_A, "m1", "will be deleted")) {
      adapter.emitForTest(event)
    }
    adapter.forgetSession(SESSION_A)
    await vi.waitFor(async () => {
      expect(await fileExists(transcriptPath(transcriptDir, SESSION_A))).toBe(false)
    })

    const controller = new AbortController()
    controller.abort()
    await adapter.send({ type: "prompt", sessionId: SESSION_A, text: "reopen?" }, { signal: controller.signal })

    // A straggler frame lands after the aborted send; the tombstone must still hold.
    adapter.emitForTest({
      event: "messageDelta",
      data: { sessionId: SESSION_A, messageId: "m-late", partId: "m-late:0", text: "zombie" },
    })
    await sleep(TRANSCRIPT_DEBOUNCE_WAIT_MS)
    expect(await fileExists(transcriptPath(transcriptDir, SESSION_A))).toBe(false)
  })

  it("stop() completes in-flight and pending saves without unhandled rejections or late writes", async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on("unhandledRejection", onUnhandled)
    try {
      const transcriptDir = await makeTranscriptDir()
      const adapter = await makeAdapter(transcriptDir)
      // Session A: completed turn => immediate flush op in flight.
      for (const event of assistantTurn(SESSION_A, "a1", "turn a")) {
        adapter.emitForTest(event)
      }
      // Session B: dangling delta => debounced save still pending at stop().
      adapter.emitForTest({
        event: "messageStarted",
        data: { sessionId: SESSION_B, messageId: "b1", role: "assistant" },
      })
      adapter.emitForTest({
        event: "messageDelta",
        data: { sessionId: SESSION_B, messageId: "b1", partId: "b1:0", text: "turn b" },
      })
      await adapter.stop()

      const fileA = (await readTranscriptJson(transcriptDir, SESSION_A)) as { messages: Array<{ id: string }> }
      const fileB = (await readTranscriptJson(transcriptDir, SESSION_B)) as { messages: Array<{ id: string }> }
      expect(fileA.messages.map((message) => message.id)).toEqual(["a1"])
      expect(fileB.messages.map((message) => message.id)).toEqual(["b1"])

      // No stray write may land after stop() resolved.
      const statsBefore = await Promise.all([
        stat(transcriptPath(transcriptDir, SESSION_A)),
        stat(transcriptPath(transcriptDir, SESSION_B)),
      ])
      await sleep(TRANSCRIPT_DEBOUNCE_WAIT_MS)
      const statsAfter = await Promise.all([
        stat(transcriptPath(transcriptDir, SESSION_A)),
        stat(transcriptPath(transcriptDir, SESSION_B)),
      ])
      expect(statsAfter.map((entry) => entry.mtimeMs)).toEqual(statsBefore.map((entry) => entry.mtimeMs))
      expect(unhandled).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
  })

  it("a broken transcript directory never crashes emits or stop()", async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on("unhandledRejection", onUnhandled)
    try {
      const base = await mkdtemp(path.join(os.tmpdir(), "wanta-transcripts-broken-"))
      cleanups.push(base)
      // A FILE occupies the configured directory path: every mkdir/save fails.
      const blockedDir = path.join(base, "blocked")
      await writeFile(blockedDir, "not a directory", "utf8")

      const adapter = new FakeExternalAdapter({ transcriptDir: blockedDir })
      await adapter.start()
      startedAdapters.push(adapter)
      for (const event of assistantTurn(SESSION_A, "m1", "unpersistable")) {
        adapter.emitForTest(event)
      }
      // In-memory transcript still works even though every save fails.
      expect((await adapter.getMessages(SESSION_A)).map((message) => message.id)).toEqual(["m1"])
      await adapter.stop()
      await sleep(50)
      expect(unhandled).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
  })
})

// ─── 5. Cross-session isolation under rapid bursts ──────────────────────────

describe("cross-session isolation under rapid event bursts", () => {
  it("keeps two concurrently streaming sessions in separate files", async () => {
    const transcriptDir = await makeTranscriptDir()
    const adapter = await makeAdapter(transcriptDir)

    adapter.emitForTest({ event: "messageStarted", data: { sessionId: SESSION_A, messageId: "a1", role: "assistant" } })
    adapter.emitForTest({ event: "messageStarted", data: { sessionId: SESSION_B, messageId: "b1", role: "assistant" } })
    let textA = ""
    let textB = ""
    for (let index = 0; index < 50; index += 1) {
      textA += `A${index} `
      textB += `B${index} `
      adapter.emitForTest({
        event: "messageDelta",
        data: { sessionId: SESSION_A, messageId: "a1", partId: "a1:0", text: textA },
      })
      adapter.emitForTest({
        event: "messageDelta",
        data: { sessionId: SESSION_B, messageId: "b1", partId: "b1:0", text: textB },
      })
    }
    adapter.emitForTest({ event: "messageCompleted", data: { sessionId: SESSION_A } })
    adapter.emitForTest({ event: "messageCompleted", data: { sessionId: SESSION_B } })
    await adapter.stop()

    const fileA = (await readTranscriptJson(transcriptDir, SESSION_A)) as {
      messages: Array<{ id: string; parts: Array<{ text?: string }> }>
    }
    const fileB = (await readTranscriptJson(transcriptDir, SESSION_B)) as {
      messages: Array<{ id: string; parts: Array<{ text?: string }> }>
    }
    expect(fileA.messages.map((message) => message.id)).toEqual(["a1"])
    expect(fileB.messages.map((message) => message.id)).toEqual(["b1"])
    expect(fileA.messages[0]?.parts[0]?.text).toBe(textA)
    expect(fileB.messages[0]?.parts[0]?.text).toBe(textB)
    // No cross-contamination in either raw file.
    expect(JSON.stringify(fileA)).not.toContain("B0 ")
    expect(JSON.stringify(fileB)).not.toContain("A0 ")
  })
})

// ─── 6/8. Round-trip fidelity incl. usage ───────────────────────────────────

describe("round-trip fidelity", () => {
  it("survives unicode, 100KB text, reasoning, and failed tool parts verbatim", async () => {
    const transcriptDir = await makeTranscriptDir()
    const adapter = await makeAdapter(transcriptDir)
    const bigText = "x".repeat(100 * 1024)
    // Includes CJK, emoji with ZWJ, RTL text, control-adjacent chars, and a
    // LONE SURROGATE (\ud800) — JSON.stringify escapes it, so it must survive.
    const trickyText = "中文测试 👩‍👩‍👧‍👦 مرحبا    \ud800 end"

    adapter.emitForTest({ event: "messageStarted", data: { sessionId: SESSION_A, messageId: "u1", role: "user" } })
    adapter.emitForTest({
      event: "messageDelta",
      data: { sessionId: SESSION_A, messageId: "u1", partId: "u1:0", text: trickyText },
    })
    adapter.emitForTest({ event: "messageStarted", data: { sessionId: SESSION_A, messageId: "a1", role: "assistant" } })
    adapter.emitForTest({
      event: "messageReasoningDelta",
      data: { sessionId: SESSION_A, messageId: "a1", partId: "a1:think", text: "pondering 🤔 深く考える" },
    })
    adapter.emitForTest({
      event: "messageDelta",
      data: { sessionId: SESSION_A, messageId: "a1", partId: "a1:text", text: bigText },
    })
    adapter.emitForTest({
      event: "toolCallStarted",
      data: {
        sessionId: SESSION_A,
        messageId: "a1",
        partId: "call-1",
        callId: "call-1",
        tool: "Bash",
        input: { command: "false && echo 'quoted \"stuff\"'" },
        status: "running",
      },
    })
    adapter.emitForTest({
      event: "toolCallResult",
      data: {
        sessionId: SESSION_A,
        messageId: "a1",
        partId: "call-1",
        callId: "call-1",
        tool: "Bash",
        status: "error",
        input: { command: "false && echo 'quoted \"stuff\"'" },
        error: "exit status 1\nstderr: boom 💥",
        metadata: { exitCode: 1, nested: { deep: ["a", "b"] } },
        timing: { start: 1000, end: 2000 },
      },
    })
    adapter.emitForTest({ event: "messageCompleted", data: { sessionId: SESSION_A } })

    const before = await adapter.getMessages(SESSION_A)
    await adapter.stop()

    const reopened = await makeAdapter(transcriptDir)
    const after = await reopened.getMessages(SESSION_A)
    expect(after).toEqual(before)
    const assistant = after.find((message) => message.id === "a1")
    expect(assistant?.parts.map((part) => part.kind)).toEqual(["reasoning", "text", "tool"])
    expect(assistant?.parts[1]?.text).toHaveLength(bigText.length)
    const tool = assistant?.parts[2]
    expect(tool).toMatchObject({ status: "error", error: "exit status 1\nstderr: boom 💥" })
    expect(after.find((message) => message.id === "u1")?.parts[0]?.text).toBe(trickyText)
  })

  it("persists usageUpdated onto the assistant message across the round-trip", async () => {
    const transcriptDir = await makeTranscriptDir()
    const adapter = await makeAdapter(transcriptDir)
    const usage = {
      total: 1234,
      input: 1000,
      output: 200,
      reasoning: 34,
      cache: { read: 700, write: 20 },
      contextWindow: 200_000,
    }
    adapter.emitForTest({ event: "messageStarted", data: { sessionId: SESSION_A, messageId: "a1", role: "assistant" } })
    adapter.emitForTest({
      event: "messageDelta",
      data: { sessionId: SESSION_A, messageId: "a1", partId: "a1:0", text: "usage-bearing turn" },
    })
    adapter.emitForTest({ event: "usageUpdated", data: { sessionId: SESSION_A, tokenUsage: usage } })
    adapter.emitForTest({ event: "messageCompleted", data: { sessionId: SESSION_A } })
    await adapter.stop()

    const reopened = await makeAdapter(transcriptDir)
    const messages = await reopened.getMessages(SESSION_A)
    expect(messages[0]?.tokenUsage).toEqual(usage)
  })

  it("attaches post-restore usage to the restored assistant and persists it", async () => {
    const transcriptDir = await makeTranscriptDir()
    await writeTranscriptFile(
      transcriptDir,
      SESSION_A,
      validTranscriptJson([userMessage("u1", "question"), assistantMessage("a1", "answer")]),
    )
    const usage = { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } }

    const adapter = await makeAdapter(transcriptDir)
    await adapter.getMessages(SESSION_A)
    adapter.emitForTest({ event: "usageUpdated", data: { sessionId: SESSION_A, tokenUsage: usage } })
    await adapter.stop()

    const reopened = await makeAdapter(transcriptDir)
    const messages = await reopened.getMessages(SESSION_A)
    expect(messages.find((message) => message.id === "a1")?.tokenUsage).toEqual(usage)
  })
})

// ─── 7. Hydration races ─────────────────────────────────────────────────────

describe("hydration races", () => {
  it("two concurrent getMessages calls hydrate once and never duplicate", async () => {
    const transcriptDir = await makeTranscriptDir()
    await writeTranscriptFile(
      transcriptDir,
      SESSION_A,
      validTranscriptJson([userMessage("u1", "hello"), assistantMessage("a1", "hi")]),
    )

    const adapter = await makeAdapter(transcriptDir)
    const [first, second] = await Promise.all([adapter.getMessages(SESSION_A), adapter.getMessages(SESSION_A)])
    expect(first.map((message) => message.id)).toEqual(["u1", "a1"])
    expect(second.map((message) => message.id)).toEqual(["u1", "a1"])
  })

  it("getMessages racing a prompt yields restored history plus the new turn, once each", async () => {
    const transcriptDir = await makeTranscriptDir()
    await writeTranscriptFile(
      transcriptDir,
      SESSION_A,
      validTranscriptJson([userMessage("u1", "hello"), assistantMessage("a1", "hi")]),
    )

    const adapter = await makeAdapter(transcriptDir)
    adapter.promptEmitsUserTurn = true
    await Promise.all([
      adapter.getMessages(SESSION_A),
      adapter.send({ type: "prompt", sessionId: SESSION_A, text: "continue" }),
    ])
    await adapter.stop()

    const reopened = await makeAdapter(transcriptDir)
    const messages = await reopened.getMessages(SESSION_A)
    expect(messages.map((message) => message.id)).toEqual(["u1", "a1", "prompt-user-1"])
  })

  it("getMessages immediately after forgetSession must not resurrect deleted history", async () => {
    // The hydration load is NOT serialized with the per-session op chain: a
    // getMessages issued right after forgetSession races store.load against
    // the queued store.remove and can restore ghost messages of a session the
    // user just deleted (which later saves would even write back to disk).
    const transcriptDir = await makeTranscriptDir()
    const adapter = await makeAdapter(transcriptDir)
    for (const event of assistantTurn(SESSION_A, "m1", "soon deleted")) {
      adapter.emitForTest(event)
    }
    // Make sure the file exists on disk before staging the race.
    await vi.waitFor(async () => {
      expect(await fileExists(transcriptPath(transcriptDir, SESSION_A))).toBe(true)
    })
    // Keep the op chain busy so the queued remove cannot win the race.
    for (const event of assistantTurn(SESSION_A, "m2", "more traffic")) {
      adapter.emitForTest(event)
    }
    adapter.forgetSession(SESSION_A)
    const ghost = await adapter.getMessages(SESSION_A)
    expect(ghost).toEqual([])
  })

  it("a delete + reopen while the original load is in flight must not restore deleted history", async () => {
    // The tombstone alone is not enough: a valid prompt can reopen the id and
    // clear the tombstone BEFORE an already-started store.load resolves, so the
    // stale load would restore the deleted messages (and sessionsWithDiskHistory).
    // A per-session deletion generation invalidates that superseded load.
    const transcriptDir = await makeTranscriptDir()
    await writeTranscriptFile(
      transcriptDir,
      SESSION_A,
      validTranscriptJson([userMessage("u1", "secret"), assistantMessage("a1", "deleted")]),
    )
    const adapter = await makeAdapter(transcriptDir)
    adapter.promptEmitsUserTurn = true

    // Hold the first load in flight so the delete + reopen interleave before it
    // resolves; on release it delegates to the real load (the file still exists).
    const realLoad = ExternalTranscriptStore.prototype.load
    const gate = deferred()
    let gated = false
    const loadSpy = vi.spyOn(ExternalTranscriptStore.prototype, "load").mockImplementation(function (
      this: ExternalTranscriptStore,
      sessionId: string,
    ) {
      if (sessionId === SESSION_A && !gated) {
        gated = true
        return gate.promise.then(() => realLoad.call(this, sessionId))
      }
      return realLoad.call(this, sessionId)
    })

    const hydrating = adapter.getMessages(SESSION_A) // op1
    // Wait until the load is genuinely IN FLIGHT (op1's body reached store.load)
    // before deleting, so this exercises the post-load race, not the pre-load guard.
    await vi.waitFor(() => expect(gated).toBe(true))
    adapter.forgetSession(SESSION_A) // bumps the deletion generation, queues remove
    const sending = adapter.send({ type: "prompt", sessionId: SESSION_A, text: "new turn" }) // clears the tombstone
    gate.resolve() // original load resolves; the generation check must reject its result
    await hydrating
    await sending
    loadSpy.mockRestore()
    await adapter.stop()

    // Reopened from disk: only the new turn, never the deleted history.
    const reopened = await makeAdapter(transcriptDir)
    const messages = await reopened.getMessages(SESSION_A)
    expect(messages.map((message) => message.id)).toEqual(["prompt-user-1"])
  })
})
