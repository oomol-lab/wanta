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

test("call_action completed with auth output → toolCallResult + authorizationRequired", () => {
  const output = JSON.stringify({
    status: "authorization_required",
    service: "slack",
    displayName: "slack",
    authUrl: "https://console.oomol.com/app-connections?provider=slack",
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
  assert.equal(out.length, 2)
  assert.equal(out[0].event, "toolCallResult")
  assert.equal(out[1].event, "authorizationRequired")
  assert.equal((out[1].data as { service: string }).service, "slack")
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

test("parseAuthorization accepts auth json, rejects plain results", () => {
  assert.equal(
    parseAuthorization(JSON.stringify({ status: "authorization_required", service: "gmail", authUrl: "https://x" }))
      ?.service,
    "gmail",
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

test("normalizeMessage builds ChatMessage with text + tool parts in order", () => {
  const msg = normalizeMessage({
    info: { id: "m1", role: "assistant", time: { created: 123 } },
    parts: [
      { id: "p1", type: "text", text: "Result:" },
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
  assert.equal(msg.parts.length, 2)
  assert.equal(msg.parts[0].kind, "text")
  assert.equal(msg.parts[1].kind, "tool")
})
