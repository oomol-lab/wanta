import type { OpencodeAgentAdapter } from "../agent/opencode-adapter.ts"
import type { SessionInfo } from "./common.ts"
import type { ExternalSessionRecord, ExternalSessionStore } from "./external-store.ts"
import type { SessionMetadata, SessionMetadataStore } from "./metadata-store.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import { SessionServiceImpl } from "./node.ts"

const localScope = {
  kind: "local" as const,
  workspaceId: "local",
  workspaceName: "Local",
}

function agentWithSessions(sessions: SessionInfo[]): OpencodeAgentAdapter {
  return {
    listSessions: async () => sessions,
    deleteSession: async () => undefined,
  } as unknown as OpencodeAgentAdapter
}

function metadataStore(initial = new Map<string, SessionMetadata>()): SessionMetadataStore {
  let metadata = initial
  return {
    read: async () => metadata,
    write: async (next: Map<string, SessionMetadata>) => {
      metadata = new Map(next)
    },
  } as SessionMetadataStore
}

function externalStore(initial = new Map<string, ExternalSessionRecord>()): {
  store: ExternalSessionStore
  current: () => Map<string, ExternalSessionRecord>
} {
  let records = initial
  return {
    store: {
      read: async () => records,
      write: async (next: Map<string, ExternalSessionRecord>) => {
        records = new Map(next)
      },
    } as ExternalSessionStore,
    current: () => records,
  }
}

test("external sessions are created without the kernel, listed, and carry their agent kind", async () => {
  const external = externalStore()
  const service = new SessionServiceImpl(agentWithSessions([]), {
    externalSessionStore: external.store,
    metadataStore: metadataStore(),
  })

  const created = await service.create({ agentKind: "claude-code", scope: localScope, title: "Claude session" })

  assert.match(created.id, /^wanta-ext:claude-code:/)
  assert.equal(created.agentKind, "claude-code")
  assert.equal(created.title, "Claude session")
  assert.equal(created.scope?.kind, "local")
  assert.equal(external.current().has(created.id), true)

  const sessions = await service.list({ scope: localScope })
  assert.deepEqual(
    sessions.map((session) => ({ id: session.id, agentKind: session.agentKind })),
    [{ id: created.id, agentKind: "claude-code" }],
  )
})

test("external sessions rename and remove without touching the kernel", async () => {
  const external = externalStore()
  const removed: string[] = []
  const service = new SessionServiceImpl(agentWithSessions([]), {
    externalSessionStore: external.store,
    metadataStore: metadataStore(),
    onSessionRemoved: (sessionId) => {
      removed.push(sessionId)
    },
  })

  const created = await service.create({ agentKind: "gemini-cli", scope: localScope })
  await service.rename({ id: created.id, title: "Renamed" })
  assert.equal(external.current().get(created.id)?.title, "Renamed")

  await service.remove(created.id)
  assert.equal(external.current().has(created.id), false)
  assert.deepEqual(removed, [created.id])
  assert.deepEqual(await service.list({ scope: localScope }), [])
})

test("removeMany handles mixed kernel and external sessions", async () => {
  const external = externalStore()
  const service = new SessionServiceImpl(
    agentWithSessions([{ id: "kernel-1", title: "Kernel", createdAt: 1, updatedAt: 1 }]),
    {
      externalSessionStore: external.store,
      metadataStore: metadataStore(new Map([["kernel-1", { scope: localScope }]])),
    },
  )
  const created = await service.create({ agentKind: "codex", scope: localScope })

  const result = await service.removeMany({ ids: ["kernel-1", created.id], scope: localScope })

  assert.deepEqual(result.failures, [])
  assert.deepEqual([...result.succeededIds].sort(), ["kernel-1", created.id].sort())
  assert.equal(external.current().has(created.id), false)
})

test("external sessions archive and unarchive through the shared metadata overlay", async () => {
  const external = externalStore()
  const service = new SessionServiceImpl(agentWithSessions([]), {
    externalSessionStore: external.store,
    metadataStore: metadataStore(),
  })
  const created = await service.create({ agentKind: "claude-code", scope: localScope })

  await service.archive(created.id)
  assert.deepEqual(await service.list({ scope: localScope }), [])
  const archived = await service.listArchived({ scope: localScope })
  assert.equal(archived[0]?.id, created.id)

  const restored = await service.unarchive(created.id)
  assert.equal(restored?.id, created.id)
  assert.equal(restored?.agentKind, "claude-code")
  assert.equal((await service.list({ scope: localScope }))[0]?.id, created.id)
})
