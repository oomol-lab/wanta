import assert from "node:assert/strict"
import { test, vi } from "vitest"
import {
  normalizeMessage,
  normalizeSyncMessage,
  parseAuthorization,
  translateOpencodeEvent,
} from "./event-translator.ts"

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

test("known ignored event types do not warn in development", () => {
  const originalNodeEnv = process.env.NODE_ENV
  process.env.NODE_ENV = "development"
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
  try {
    assert.deepEqual(translateOpencodeEvent({ type: "installation.update-available", properties: {} }), [])
    assert.equal(warn.mock.calls.length, 0)
  } finally {
    warn.mockRestore()
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = originalNodeEnv
    }
  }
})

test("unknown event types warn in development", () => {
  const originalNodeEnv = process.env.NODE_ENV
  process.env.NODE_ENV = "development"
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
  try {
    assert.deepEqual(translateOpencodeEvent({ type: "new.event", properties: {} }), [])
    assert.equal(warn.mock.calls[0]?.[0], "[wanta] unhandled OpenCode event type: new.event")
  } finally {
    warn.mockRestore()
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = originalNodeEnv
    }
  }
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

test("text part.updated strips Wanta hidden turn context before reaching the renderer", () => {
  const out = translateOpencodeEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "p1",
        sessionID: "s1",
        messageID: "m1",
        type: "text",
        text: [
          "你好",
          '<wanta_turn_context visibility="hidden_from_ui">',
          "internal context",
          "</wanta_turn_context>",
        ].join("\n\n"),
      },
      delta: "\n</wanta_turn_context>",
    },
  })

  assert.deepEqual(out, [
    { event: "messageDelta", data: { sessionId: "s1", messageId: "m1", partId: "p1", text: "你好" } },
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

test("session.next.text.ended strips Wanta hidden turn context", () => {
  const out = translateOpencodeEvent({
    type: "session.next.text.ended",
    data: {
      sessionID: "s1",
      assistantMessageID: "m1",
      textID: "t1",
      text: [
        "Done",
        '<wanta_turn_context visibility="hidden_from_ui">',
        "internal context",
        "</wanta_turn_context>",
      ].join("\n\n"),
    },
  })

  assert.deepEqual(out, [
    { event: "messageDelta", data: { sessionId: "s1", messageId: "m1", partId: "t1", text: "Done" } },
  ])
})

test("ignored text part.updated is not shown", () => {
  const out = translateOpencodeEvent({
    type: "message.part.updated",
    properties: { part: { id: "p1", sessionID: "s1", messageID: "m1", type: "text", text: "hidden", ignored: true } },
  })

  assert.deepEqual(out, [])
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

test("known non-chat part types are explicitly ignored", () => {
  assert.deepEqual(
    translateOpencodeEvent({
      type: "message.part.updated",
      properties: {
        part: { id: "snapshot-1", sessionID: "s1", messageID: "m1", type: "snapshot", snapshot: "abc" },
      },
    }),
    [],
  )
  assert.deepEqual(
    translateOpencodeEvent({
      type: "message.part.updated",
      properties: { part: { id: "agent-1", sessionID: "s1", messageID: "m1", type: "agent", name: "build" } },
    }),
    [],
  )
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
          attachments: [
            {
              id: "file-1",
              sessionID: "s1",
              messageID: "m1",
              type: "file",
              filename: "result.txt",
              mime: "text/plain",
              source: { path: "/tmp/result.txt" },
            },
          ],
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
    attachments: [
      {
        id: "file-1",
        name: "result.txt",
        mime: "text/plain",
        size: 0,
        path: "/tmp/result.txt",
        kind: "file",
      },
    ],
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
    properties: { sessionID: "s1", status: { type: "retry", attempt: 3, message: "rate limited", next: 1000 } },
  })

  assert.deepEqual(out, [
    {
      event: "assistantActivity",
      data: { sessionId: "s1", phase: "retrying", message: "rate limited", attempt: 3, nextRetryAt: 1000 },
    },
  ])
})

test("session.idle → messageCompleted; session.error → agentError", () => {
  assert.deepEqual(translateOpencodeEvent({ type: "session.idle", properties: { sessionID: "s1" } }), [
    { event: "messageCompleted", data: { sessionId: "s1" } },
  ])
  assert.deepEqual(translateOpencodeEvent({ type: "session.idle", data: { sessionID: "s2" } }), [
    { event: "messageCompleted", data: { sessionId: "s2" } },
  ])
  const err = translateOpencodeEvent({
    type: "session.error",
    data: { sessionID: "s1", error: { name: "UnknownError", data: { message: "boom" } } },
  })
  assert.equal(err[0].event, "agentError")
  assert.equal((err[0].data as { message: string }).message, "boom")
})

test("V2 prompt admission starts the user message", () => {
  assert.deepEqual(
    translateOpencodeEvent({
      type: "session.next.prompt.admitted",
      data: { sessionID: "s1", messageID: "u1", prompt: { text: "hello" }, delivery: "queue" },
    }),
    [{ event: "messageStarted", data: { sessionId: "s1", messageId: "u1", role: "user" } }],
  )
  assert.deepEqual(
    translateOpencodeEvent({
      type: "session.next.prompted",
      properties: { sessionID: "s2", messageID: "u2", prompt: { text: "hi" }, delivery: "queue" },
    }),
    [{ event: "messageStarted", data: { sessionId: "s2", messageId: "u2", role: "user" } }],
  )
})

test("session.error skips message aborts", () => {
  const out = translateOpencodeEvent({
    type: "session.error",
    properties: { sessionID: "s1", error: { name: "MessageAbortedError", data: { message: "Aborted" } } },
  })

  assert.deepEqual(out, [])
})

test("permission.v2.asked reports an unexpected permission request", () => {
  const out = translateOpencodeEvent({
    type: "permission.v2.asked",
    data: {
      id: "perm-1",
      sessionID: "s1",
      action: "Run bash",
      resources: ["npm test"],
      source: { type: "tool", tool: "bash" },
    },
  })

  assert.deepEqual(out, [
    {
      event: "unexpectedPermission",
      data: {
        sessionId: "s1",
        requestId: "perm-1",
        message:
          "OpenCode requested permission approval (Run bash · bash · npm test), but Wanta does not support ask permissions. The generation was stopped.",
      },
    },
  ])
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
    id: "m1",
    type: "user",
    time: { created: 1 },
    text: "",
    files: [
      {
        uri: "file:///Users/me/project",
        name: "project",
        mime: "inode/directory",
      },
    ],
  })
  assert.deepEqual(message?.parts, [
    {
      kind: "attachment",
      partId: "m1-file-0",
      attachment: {
        id: "m1-file-0",
        name: "project",
        mime: "inode/directory",
        size: 0,
        path: "/Users/me/project",
        kind: "directory",
      },
    },
  ])
})

test("normalizeMessage decodes file URL attachment paths", () => {
  const message = normalizeMessage({
    id: "m1",
    type: "user",
    time: { created: 1 },
    text: "",
    files: [
      {
        uri: "file:///Users/me/project%20files/report.txt",
        name: "report.txt",
        mime: "text/plain",
      },
    ],
  })

  const part = message?.parts[0]
  assert.ok(part && part.kind === "attachment")
  assert.equal(part.attachment?.path, "/Users/me/project files/report.txt")
})

test("normalizeMessage strips hidden turn context from V2 user history", () => {
  const message = normalizeMessage({
    id: "u1",
    type: "user",
    time: { created: 1 },
    text: [
      "你好",
      '<wanta_turn_context visibility="hidden_from_ui">',
      "Artifact output contract for this turn:",
      "</wanta_turn_context>",
    ].join("\n\n"),
  })

  assert.deepEqual(message, {
    id: "u1",
    role: "user",
    parts: [{ kind: "text", partId: "u1-text", text: "你好" }],
    createdAt: 1,
  })
})

test("normalizeMessage strips hidden turn context from V2 assistant text history", () => {
  const message = normalizeMessage({
    id: "a1",
    type: "assistant",
    time: { created: 2 },
    agent: "build",
    model: { id: "oopilot", providerID: "oomol" },
    content: [
      {
        id: "text-1",
        type: "text",
        text: [
          "Done",
          '<wanta_turn_context visibility="hidden_from_ui">',
          "internal context",
          "</wanta_turn_context>",
        ].join("\n\n"),
      },
    ],
  })

  assert.deepEqual(message, {
    id: "a1",
    role: "assistant",
    parts: [{ kind: "text", partId: "text-1", text: "Done" }],
    createdAt: 2,
  })
})

test("normalizeMessage ignores non-chat V2 message history entries", () => {
  const message = normalizeMessage({
    id: "system-1",
    type: "system",
    time: { created: 1 },
    text: "internal system message",
  })

  assert.equal(message, null)
})

test("normalizeMessage ignores V2 history entries with no visible parts", () => {
  const user = normalizeMessage({
    id: "u1",
    type: "user",
    time: { created: 1 },
    text: "",
    files: [],
  })
  const assistant = normalizeMessage({
    id: "a1",
    type: "assistant",
    time: { created: 2 },
    agent: "build",
    model: { id: "oopilot", providerID: "oomol" },
    content: [],
  })

  assert.equal(user, null)
  assert.equal(assistant, null)
})

test("normalizeSyncMessage skips ignored text parts", () => {
  const message = normalizeSyncMessage({
    info: { id: "m1", role: "assistant", time: { created: 1 } },
    parts: [
      { id: "p1", type: "text", text: "hidden", ignored: true },
      { id: "p2", type: "text", text: "visible" },
    ],
  })

  assert.deepEqual(message?.parts, [{ kind: "text", partId: "p2", text: "visible" }])
})

test("normalizeMessage builds ChatMessage with text + reasoning + tool parts in order", () => {
  const msg = normalizeMessage({
    id: "m1",
    type: "assistant",
    time: { created: 123 },
    agent: "build",
    model: { id: "oopilot", providerID: "oomol" },
    content: [
      { id: "p1", type: "text", text: "Result:" },
      { id: "r1", type: "reasoning", text: "Checked local context" },
      {
        id: "c1",
        type: "tool",
        name: "call_action",
        state: { status: "completed", input: {}, content: [{ type: "text", text: "{}" }], structured: {} },
        time: { created: 100, ran: 101, completed: 102 },
      },
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

test("normalizeSyncMessage preserves structured tool attachments", () => {
  const msg = normalizeSyncMessage({
    info: { id: "m1", role: "assistant", time: { created: 123 } },
    parts: [
      {
        id: "tool-1",
        type: "tool",
        callID: "call-1",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "cat result.txt" },
          output: "ok",
          attachments: [
            {
              id: "file-1",
              type: "file",
              filename: "result.txt",
              mime: "text/plain",
              source: { path: "/tmp/result.txt" },
            },
          ],
        },
      },
    ],
  })

  assert.deepEqual(msg?.parts[0], {
    kind: "tool",
    partId: "tool-1",
    callId: "call-1",
    tool: "bash",
    status: "completed",
    input: { command: "cat result.txt" },
    output: "ok",
    error: undefined,
    title: undefined,
    metadata: undefined,
    timing: undefined,
    attachmentsCount: 1,
    attachments: [
      {
        id: "file-1",
        name: "result.txt",
        mime: "text/plain",
        size: 0,
        path: "/tmp/result.txt",
        kind: "file",
      },
    ],
  })
})

test("normalizeMessage preserves assistant token usage", () => {
  const msg = normalizeMessage({
    id: "m1",
    type: "assistant",
    time: { created: 123 },
    agent: "build",
    model: { id: "oopilot", providerID: "oomol" },
    tokens: {
      input: 1200,
      output: 320,
      reasoning: 40,
      cache: { read: 800, write: 50 },
    },
    content: [{ id: "p1", type: "text", text: "Done" }],
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
    id: "m1",
    type: "assistant",
    time: { created: 123 },
    agent: "build",
    model: { id: "oopilot", providerID: "oomol" },
    error: { type: "unknown", message: "Payment Required: account is in deficit" },
    content: [{ id: "p1", type: "text", text: "Partial answer" }],
  })

  assert.ok(msg)
  assert.deepEqual(msg.parts, [
    { kind: "text", partId: "p1", text: "Partial answer" },
    {
      kind: "error",
      partId: "message-error-unknown",
      errorText: "Payment Required: account is in deficit",
    },
  ])
})
