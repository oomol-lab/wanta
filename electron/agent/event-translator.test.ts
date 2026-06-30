import assert from "node:assert/strict"
import { test } from "vitest"
import { normalizeMessage, parseAuthorization, translateOpencodeEvent } from "./event-translator.ts"

test("message.updated → messageStarted with role", () => {
  const out = translateOpencodeEvent({
    type: "message.updated",
    properties: { info: { id: "m1", sessionID: "s1", role: "assistant" } },
  })
  assert.deepEqual(out, [{ event: "messageStarted", data: { sessionId: "s1", messageId: "m1", role: "assistant" } }])
})

test("message.updated with assistant error emits agentError after messageStarted", () => {
  const out = translateOpencodeEvent({
    type: "message.updated",
    properties: {
      info: {
        id: "m1",
        sessionID: "s1",
        role: "assistant",
        error: {
          name: "APIError",
          data: { message: "Payment Required: account is in deficit", statusCode: 402 },
        },
      },
    },
  })

  assert.deepEqual(out, [
    { event: "messageStarted", data: { sessionId: "s1", messageId: "m1", role: "assistant" } },
    { event: "agentError", data: { sessionId: "s1", message: "Payment Required: account is in deficit" } },
  ])
})

test("message.updated with assistant abort skips agentError", () => {
  const out = translateOpencodeEvent({
    type: "message.updated",
    properties: {
      info: {
        id: "m1",
        sessionID: "s1",
        role: "assistant",
        error: { name: "MessageAbortedError", data: { message: "Aborted" } },
      },
    },
  })

  assert.deepEqual(out, [{ event: "messageStarted", data: { sessionId: "s1", messageId: "m1", role: "assistant" } }])
})

test("text part.updated → messageDelta carrying cumulative text", () => {
  const out = translateOpencodeEvent({
    type: "message.part.updated",
    properties: { part: { id: "p1", sessionID: "s1", messageID: "m1", type: "text", text: "Hello wo" } },
  })
  assert.deepEqual(out, [
    { event: "messageDelta", data: { sessionId: "s1", messageId: "m1", partId: "p1", text: "Hello wo" } },
  ])
})

test("text part.updated forwards streaming delta when cumulative text is unavailable", () => {
  const out = translateOpencodeEvent({
    type: "message.part.updated",
    properties: { part: { id: "p1", sessionID: "s1", messageID: "m1", type: "text", text: "" }, delta: "Hi" },
  })
  assert.deepEqual(out, [
    { event: "messageDelta", data: { sessionId: "s1", messageId: "m1", partId: "p1", text: "", delta: "Hi" } },
  ])
})

test("reasoning part.updated → messageReasoningDelta", () => {
  const out = translateOpencodeEvent({
    type: "message.part.updated",
    properties: {
      part: { id: "r1", sessionID: "s1", messageID: "m1", type: "reasoning", text: "Need to inspect files" },
    },
  })
  assert.deepEqual(out, [
    {
      event: "messageReasoningDelta",
      data: { sessionId: "s1", messageId: "m1", partId: "r1", text: "Need to inspect files" },
    },
  ])
})

test("step parts update assistant activity without creating visible message parts", () => {
  assert.deepEqual(
    translateOpencodeEvent({
      type: "message.part.updated",
      properties: { part: { id: "step-1", sessionID: "s1", messageID: "m1", type: "step-start" } },
    }),
    [{ event: "assistantActivity", data: { sessionId: "s1", messageId: "m1", phase: "thinking" } }],
  )
  assert.deepEqual(
    translateOpencodeEvent({
      type: "message.part.updated",
      properties: {
        part: { id: "step-2", sessionID: "s1", messageID: "m1", type: "step-finish", reason: "tool-calls" },
      },
    }),
    [{ event: "assistantActivity", data: { sessionId: "s1", messageId: "m1", phase: "finalizing" } }],
  )
})

test("retry signals update assistant activity", () => {
  const out = translateOpencodeEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "retry-1",
        sessionID: "s1",
        messageID: "m1",
        type: "retry",
        attempt: 2,
        error: { name: "APIError", data: { message: "upstream timeout" } },
      },
    },
  })

  assert.deepEqual(out, [
    {
      event: "assistantActivity",
      data: { sessionId: "s1", messageId: "m1", phase: "retrying", message: "upstream timeout", attempt: 2 },
    },
  ])
})

test("file part.updated → messageAttachment", () => {
  const out = translateOpencodeEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "p-file",
        sessionID: "s1",
        messageID: "m1",
        type: "file",
        filename: "report.pdf",
        mime: "application/pdf",
        source: { path: "/Users/me/report.pdf" },
      },
    },
  })
  assert.deepEqual(out, [
    {
      event: "messageAttachment",
      data: {
        sessionId: "s1",
        messageId: "m1",
        partId: "p-file",
        attachment: {
          id: "p-file",
          name: "report.pdf",
          mime: "application/pdf",
          size: 0,
          path: "/Users/me/report.pdf",
          kind: "file",
        },
      },
    },
  ])
})

test("tool part pending → toolCallStarted", () => {
  const out = translateOpencodeEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "p2",
        sessionID: "s1",
        messageID: "m1",
        type: "tool",
        callID: "c1",
        tool: "search_actions",
        state: { status: "pending", input: { query: "x" } },
      },
    },
  })
  assert.equal(out.length, 1)
  assert.equal(out[0].event, "toolCallStarted")
})

test("tool part with error is normalized to toolCallResult error", () => {
  const out = translateOpencodeEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "p2",
        sessionID: "s1",
        messageID: "m1",
        type: "tool",
        callID: "c1",
        tool: "grep",
        state: { status: "running", input: { pattern: "hello" }, error: "ripgrep execution failed" },
      },
    },
  })

  assert.deepEqual(out, [
    {
      event: "toolCallResult",
      data: {
        sessionId: "s1",
        messageId: "m1",
        partId: "p2",
        callId: "c1",
        tool: "grep",
        input: { pattern: "hello" },
        status: "error",
        error: "ripgrep execution failed",
      },
    },
  ])
})

test("tool events preserve title, metadata and timing for renderer summaries", () => {
  const out = translateOpencodeEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "p2",
        sessionID: "s1",
        messageID: "m1",
        type: "tool",
        callID: "c1",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "npm test" },
          output: "ok",
          title: "Run tests",
          metadata: { exit: 0 },
          time: { start: 100, end: 250 },
          attachments: [{}],
        },
      },
    },
  })
  assert.equal(out.length, 1)
  assert.equal(out[0].event, "toolCallResult")
  assert.deepEqual(out[0].data, {
    sessionId: "s1",
    messageId: "m1",
    partId: "p2",
    callId: "c1",
    tool: "bash",
    input: { command: "npm test" },
    status: "completed",
    output: "ok",
    title: "Run tests",
    metadata: { exit: 0 },
    timing: { start: 100, end: 250 },
    attachmentsCount: 1,
  })
})

test("tool events use input description as title fallback", () => {
  const out = translateOpencodeEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "p2",
        sessionID: "s1",
        messageID: "m1",
        type: "tool",
        callID: "c1",
        tool: "bash",
        state: {
          status: "running",
          input: { command: "curl wttr.in/Hangzhou", description: "获取杭州天气" },
          time: { start: 100 },
        },
      },
    },
  })

  assert.equal(out.length, 1)
  assert.equal(out[0].event, "toolCallStarted")
  assert.deepEqual(out[0].data, {
    sessionId: "s1",
    messageId: "m1",
    partId: "p2",
    callId: "c1",
    tool: "bash",
    input: { command: "curl wttr.in/Hangzhou", description: "获取杭州天气" },
    status: "running",
    title: "获取杭州天气",
    timing: { start: 100, end: undefined },
  })
})

test("call_action completed with auth output → toolCallResult with authorization", () => {
  const output = JSON.stringify({
    status: "authorization_required",
    service: "slack",
    action: "send_message",
    displayName: "slack",
    errorCode: "connection_required",
  })
  const out = translateOpencodeEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "p3",
        sessionID: "s1",
        messageID: "m1",
        type: "tool",
        callID: "c2",
        tool: "call_action",
        state: { status: "completed", input: {}, output },
      },
    },
  })
  assert.equal(out.length, 1)
  assert.equal(out[0].event, "toolCallResult")
  assert.equal((out[0].data as { authorization?: { service: string } }).authorization?.service, "slack")
  assert.equal((out[0].data as { authorization?: { action: string } }).authorization?.action, "send_message")
  assert.equal(
    (out[0].data as { authorization?: { errorCode: string } }).authorization?.errorCode,
    "connection_required",
  )
})

test("message.part.removed → messagePartRemoved", () => {
  const out = translateOpencodeEvent({
    type: "message.part.removed",
    properties: { sessionID: "s1", messageID: "m1", partID: "p1" },
  })

  assert.deepEqual(out, [{ event: "messagePartRemoved", data: { sessionId: "s1", messageId: "m1", partId: "p1" } }])
})

test("session.status retry → assistantActivity", () => {
  const out = translateOpencodeEvent({
    type: "session.status",
    properties: { sessionID: "s1", status: { type: "retry", attempt: 3, message: "rate limited" } },
  })

  assert.deepEqual(out, [
    {
      event: "assistantActivity",
      data: { sessionId: "s1", phase: "retrying", message: "rate limited", attempt: 3 },
    },
  ])
})

test("session.idle → messageCompleted; session.error → agentError", () => {
  assert.deepEqual(translateOpencodeEvent({ type: "session.idle", properties: { sessionID: "s1" } }), [
    { event: "messageCompleted", data: { sessionId: "s1" } },
  ])
  const err = translateOpencodeEvent({
    type: "session.error",
    properties: { sessionID: "s1", error: { name: "UnknownError", data: { message: "boom" } } },
  })
  assert.equal(err[0].event, "agentError")
  assert.equal((err[0].data as { message: string }).message, "boom")
})

test("session.error skips message aborts", () => {
  const out = translateOpencodeEvent({
    type: "session.error",
    properties: { sessionID: "s1", error: { name: "MessageAbortedError", data: { message: "Aborted" } } },
  })

  assert.deepEqual(out, [])
})

test("parseAuthorization accepts auth json, rejects plain results", () => {
  assert.deepEqual(
    parseAuthorization(
      JSON.stringify({
        status: "authorization_required",
        service: "gmail",
        action: "list",
        displayName: "Gmail",
        errorCode: "connection_required",
      }),
    ),
    {
      service: "gmail",
      action: "list",
      displayName: "Gmail",
      errorCode: "connection_required",
      message: undefined,
      authUrl: undefined,
    },
  )
  assert.equal(parseAuthorization(JSON.stringify({ data: { ok: true } })), null)
  assert.equal(parseAuthorization("not json"), null)
  assert.equal(parseAuthorization(undefined), null)
})

test("normalizeMessage marks directory attachments from inode mime", () => {
  const message = normalizeMessage({
    info: { id: "m1", role: "user", time: { created: 1 } },
    parts: [
      {
        id: "p1",
        type: "file",
        filename: "project",
        mime: "inode/directory",
        source: { path: "/Users/me/project" },
      },
    ],
  })
  assert.deepEqual(message?.parts, [
    {
      kind: "attachment",
      partId: "p1",
      attachment: {
        id: "p1",
        name: "project",
        mime: "inode/directory",
        size: 0,
        path: "/Users/me/project",
        kind: "directory",
      },
    },
  ])
})

test("normalizeMessage builds ChatMessage with text + reasoning + tool parts in order", () => {
  const msg = normalizeMessage({
    info: { id: "m1", role: "assistant", time: { created: 123 } },
    parts: [
      { id: "p1", type: "text", text: "Result:" },
      { id: "r1", type: "reasoning", text: "Checked local context" },
      {
        id: "p2",
        type: "tool",
        callID: "c1",
        tool: "call_action",
        state: { status: "completed", input: {}, output: "{}" },
      },
      { id: "p3", type: "step-finish" },
    ],
  })
  assert.ok(msg)
  assert.equal(msg.id, "m1")
  assert.equal(msg.role, "assistant")
  assert.equal(msg.parts.length, 3)
  assert.equal(msg.parts[0].kind, "text")
  assert.equal(msg.parts[1].kind, "reasoning")
  assert.equal(msg.parts[2].kind, "tool")
})

test("normalizeMessage preserves assistant token usage", () => {
  const msg = normalizeMessage({
    info: {
      id: "m1",
      role: "assistant",
      time: { created: 123 },
      tokens: {
        input: 1200,
        output: 320,
        reasoning: 40,
        cache: { read: 800, write: 50 },
      },
    },
    parts: [{ id: "p1", type: "text", text: "Done" }],
  })

  assert.deepEqual(msg?.tokenUsage, {
    input: 1200,
    output: 320,
    reasoning: 40,
    cache: { read: 800, write: 50 },
  })
})

test("normalizeMessage appends assistant message-level errors", () => {
  const msg = normalizeMessage({
    info: {
      id: "m1",
      role: "assistant",
      time: { created: 123 },
      error: {
        name: "APIError",
        data: { message: "Payment Required: account is in deficit", statusCode: 402 },
      },
    },
    parts: [{ id: "p1", type: "text", text: "Partial answer" }],
  })

  assert.ok(msg)
  assert.deepEqual(msg.parts, [
    { kind: "text", partId: "p1", text: "Partial answer" },
    {
      kind: "error",
      partId: "message-error-APIError",
      errorText: "Payment Required: account is in deficit",
    },
  ])
})

test("normalizeMessage skips aborted message-level errors for stopped history", () => {
  const msg = normalizeMessage({
    info: {
      id: "m1",
      role: "assistant",
      time: { created: 123 },
      error: { name: "MessageAbortedError", data: { message: "Aborted" } },
    },
    parts: [{ id: "p1", type: "text", text: "Partial answer" }],
  })

  assert.ok(msg)
  assert.deepEqual(msg.parts, [{ kind: "text", partId: "p1", text: "Partial answer" }])
})
