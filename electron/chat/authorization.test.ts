import type { ChatMessage } from "./common.ts"

import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "vitest"
import { parseAuthorizationSignal, parseSearchAuthorizationSignal } from "./authorization-signal.ts"
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

test("parseSearchAuthorizationSignal accepts one unauthenticated provider", () => {
  assert.deepEqual(
    parseSearchAuthorizationSignal(
      JSON.stringify([
        {
          service: "supabase",
          name: "list_projects",
          description: "List projects",
          authenticated: false,
        },
        {
          service: "supabase",
          name: "run_read_only_query",
          description: "Run SQL",
          authenticated: false,
        },
      ]),
    ),
    {
      service: "supabase",
      displayName: "Supabase",
      errorCode: "connection_required",
    },
  )
})

test("parseSearchAuthorizationSignal rejects ambiguous search results", () => {
  assert.equal(
    parseSearchAuthorizationSignal(
      JSON.stringify([
        { service: "gmail", name: "list_messages", authenticated: false },
        { service: "slack", name: "send_message", authenticated: false },
      ]),
    ),
    null,
  )
  assert.equal(parseSearchAuthorizationSignal(JSON.stringify([{ service: "gmail", authenticated: true }])), null)
  assert.equal(parseSearchAuthorizationSignal(JSON.stringify({ status: "error" })), null)
})

test("parseSearchAuthorizationSignal ignores search results with unreliable authentication scope", () => {
  assert.equal(
    parseSearchAuthorizationSignal(
      JSON.stringify([
        {
          service: "supabase",
          name: "list_projects",
          authenticated: false,
          authenticatedReliable: false,
          authenticatedScope: "search_default_identity",
        },
      ]),
    ),
    null,
  )
})

test("parseSearchAuthorizationSignal prefers the provider named by the search input", () => {
  const output = JSON.stringify([
    { service: "supabase", name: "list_projects", authenticated: false },
    { service: "supabase", name: "run_read_only_query", authenticated: false },
    { service: "neon", name: "get_database", authenticated: false },
  ])

  assert.deepEqual(
    parseSearchAuthorizationSignal(output, { keywords: "supabase", query: "Supabase database connection" }),
    {
      service: "supabase",
      displayName: "Supabase",
      errorCode: "connection_required",
    },
  )
  assert.equal(parseSearchAuthorizationSignal(output), null)
})

test("parseSearchAuthorizationSignal suppresses a single unrelated provider when context names another provider", () => {
  assert.equal(
    parseSearchAuthorizationSignal(JSON.stringify([{ service: "launchdarkly", authenticated: false }]), {
      query: "PostHog feature flags",
      userText: "PostHog 功能介绍",
    }),
    null,
  )
  assert.deepEqual(
    parseSearchAuthorizationSignal(JSON.stringify([{ service: "launchdarkly", authenticated: false }]), {
      query: "feature flags",
    }),
    {
      service: "launchdarkly",
      displayName: "Launchdarkly",
      errorCode: "connection_required",
    },
  )
})

test("parseSearchAuthorizationSignal does not match provider names as arbitrary substrings", () => {
  const output = JSON.stringify([
    { service: "box", name: "upload_file", authenticated: false },
    { service: "notion", name: "search_pages", authenticated: false },
  ])

  assert.equal(parseSearchAuthorizationSignal(output, { query: "search inbox annotations" }), null)
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
