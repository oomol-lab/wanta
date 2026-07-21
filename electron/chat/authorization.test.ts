import type { ChatMessage } from "./common.ts"

import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "vitest"
import { parseAuthorizationSignal } from "./authorization-signal.ts"
import { applyAuthorizationOverlays, AuthorizationOverlayStore, recordAuthorizationOverlay } from "./authorization.ts"

function assistantMessage(): ChatMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    createdAt: 1,
    parts: [
      {
        kind: "tool",
        partId: "tool-1",
        callId: "call-1",
        tool: "call_action",
        status: "completed",
        input: {},
      },
    ],
  }
}

test("parseAuthorizationSignal accepts in-app authorization results", () => {
  assert.deepEqual(
    parseAuthorizationSignal(
      JSON.stringify({
        status: "authorization_required",
        service: "supabase",
        action: "list_projects",
        displayName: "Supabase",
        errorCode: "connection_required",
      }),
    ),
    {
      service: "supabase",
      action: "list_projects",
      authUrl: undefined,
      displayName: "Supabase",
      errorCode: "connection_required",
      message: undefined,
    },
  )
  assert.equal(parseAuthorizationSignal(JSON.stringify({ status: "ok" })), null)
  assert.equal(parseAuthorizationSignal("not json"), null)
})

test("applyAuthorizationOverlays restores authorization onto tool parts", () => {
  const records = new Map()
  recordAuthorizationOverlay(records, "session-1", "assistant-1", "tool-1", {
    service: "supabase",
    displayName: "Supabase",
    action: "list_projects",
    errorCode: "connection_required",
  })

  const [message] = applyAuthorizationOverlays([assistantMessage()], records.get("session-1"))

  assert.equal(message?.parts[0]?.authorization?.service, "supabase")
  assert.equal(message?.parts[0]?.authorization?.displayName, "Supabase")
  assert.equal(message?.parts[0]?.authorization?.action, "list_projects")
})

test("AuthorizationOverlayStore persists authorization overlays", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-authorization-overlays-"))
  const store = new AuthorizationOverlayStore(root)
  const records = new Map()
  recordAuthorizationOverlay(records, "session-1", "assistant-1", "tool-1", {
    service: "gmail",
    displayName: "Gmail",
    action: "list_messages",
    errorCode: "connection_required",
    message: "authorization is required",
  })

  await store.write(records)

  const restored = await store.read()
  const authorization = restored.get("session-1")?.get("assistant-1")?.get("tool-1")
  assert.equal(authorization?.service, "gmail")
  assert.equal(authorization?.displayName, "Gmail")
  assert.equal(authorization?.action, "list_messages")
  assert.equal(authorization?.message, "authorization is required")
})
