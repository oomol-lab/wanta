import type { AgentManager } from "../agent/manager.ts"
import type { SessionActivityStore } from "./activity-store.ts"
import type { SessionInfo } from "./common.ts"
import type { SessionMetadata } from "./metadata-store.ts"
import type { SessionMetadataStore } from "./metadata-store.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import { SessionServiceImpl } from "./node.ts"

function agentWithSessions(sessions: SessionInfo[]): AgentManager {
  return {
    listSessions: async () => sessions,
  } as AgentManager
}

function metadataStore(initial = new Map<string, SessionMetadata>()): SessionMetadataStore {
  let metadata = initial
  return {
    read: async () => metadata,
    write: async (next) => {
      metadata = new Map(next)
    },
  } as SessionMetadataStore
}

function activityStore(initial = new Map<string, number>()): SessionActivityStore {
  let activity = initial
  return {
    read: async () => activity,
    write: async (next) => {
      activity = new Map(next)
    },
  } as SessionActivityStore
}

test("list merges local activity times and sorts by most recent use", async () => {
  const oldSession: SessionInfo = {
    id: "old",
    title: "Old",
    createdAt: 1_000,
    updatedAt: 1_000,
  }
  const recentSession: SessionInfo = {
    id: "recent",
    title: "Recent",
    createdAt: 2_000,
    updatedAt: 2_000,
  }
  const service = new SessionServiceImpl(agentWithSessions([recentSession, oldSession]))

  assert.equal(service.markUsed("old", 3_000), true)

  const sessions = await service.list()

  assert.deepEqual(
    sessions.map((session) => ({ id: session.id, updatedAt: session.updatedAt })),
    [
      { id: "old", updatedAt: 3_000 },
      { id: "recent", updatedAt: 2_000 },
    ],
  )
})

test("local activity never moves a session timestamp backwards", async () => {
  const service = new SessionServiceImpl(
    agentWithSessions([
      {
        id: "session",
        title: "Session",
        createdAt: 1_000,
        updatedAt: 5_000,
      },
    ]),
  )

  assert.equal(service.markUsed("session", 3_000), true)

  const sessions = await service.list()

  assert.equal(sessions[0]?.updatedAt, 5_000)
})

test("generateTitle preserves whether the title came from the model", async () => {
  const service = new SessionServiceImpl({
    generateSessionTitle: async () => ({ generated: true, title: "Gmail 三日报告" }),
  } as unknown as AgentManager)

  const result = await service.generateTitle({ text: "分析最近三天 Gmail 信息" })

  assert.deepEqual(result, { generated: true, title: "Gmail 三日报告" })
})

test("list hides archived sessions and keeps pinned sessions active", async () => {
  const service = new SessionServiceImpl(
    agentWithSessions([
      {
        id: "pinned",
        title: "Pinned",
        createdAt: 1_000,
        updatedAt: 1_000,
      },
      {
        id: "archived",
        title: "Archived",
        createdAt: 2_000,
        updatedAt: 2_000,
      },
    ]),
    {
      metadataStore: metadataStore(
        new Map([
          ["pinned", { pinnedAt: 4_000 }],
          ["archived", { archivedAt: 5_000 }],
        ]),
      ),
    },
  )

  const activeSessions = await service.list()
  const archivedSessions = await service.listArchived()

  assert.deepEqual(
    activeSessions.map((session) => ({ id: session.id, pinnedAt: session.pinnedAt })),
    [{ id: "pinned", pinnedAt: 4_000 }],
  )
  assert.deepEqual(
    archivedSessions.map((session) => ({ archivedAt: session.archivedAt, id: session.id })),
    [{ archivedAt: 5_000, id: "archived" }],
  )
})

test("list filters sessions by requested scope", async () => {
  const service = new SessionServiceImpl(
    agentWithSessions([
      {
        id: "personal",
        title: "Personal",
        createdAt: 1_000,
        updatedAt: 1_000,
      },
      {
        id: "aaa",
        title: "AAA",
        createdAt: 2_000,
        updatedAt: 2_000,
      },
      {
        id: "netless",
        title: "Netless",
        createdAt: 3_000,
        updatedAt: 3_000,
      },
    ]),
    {
      metadataStore: metadataStore(
        new Map([
          ["aaa", { scope: { type: "organization", organizationId: "aaa-id", organizationName: "aaa" } }],
          ["netless", { scope: { type: "organization", organizationId: "netless-id", organizationName: "netless" } }],
        ]),
      ),
    },
  )

  assert.deepEqual(
    (await service.list({ scope: { type: "personal" } })).map((session) => session.id),
    ["personal"],
  )
  assert.deepEqual(
    (
      await service.list({
        scope: { type: "organization", organizationId: "aaa-id", organizationName: "aaa" },
      })
    ).map((session) => session.id),
    ["aaa"],
  )
})

test("create persists the requested session scope", async () => {
  const persistedMetadata = metadataStore()
  const service = new SessionServiceImpl(
    {
      createSession: async (title?: string) => ({
        id: "created",
        title: title ?? "Untitled",
        createdAt: 1_000,
        updatedAt: 1_000,
      }),
      listSessions: async () => [
        {
          id: "created",
          title: "Scoped",
          createdAt: 1_000,
          updatedAt: 1_000,
        },
      ],
    } as unknown as AgentManager,
    {
      metadataStore: persistedMetadata,
    },
  )

  const scope = { type: "organization" as const, organizationId: "aaa-id", organizationName: "aaa" }
  const created = await service.create({ scope, title: "Scoped" })

  assert.deepEqual(created.scope, scope)
  assert.deepEqual(await persistedMetadata.read(), new Map([["created", { scope }]]))
})

test("archive clears pinned state", async () => {
  const service = new SessionServiceImpl(
    agentWithSessions([
      {
        id: "session",
        title: "Session",
        createdAt: 1_000,
        updatedAt: 1_000,
      },
    ]),
    {
      metadataStore: metadataStore(new Map([["session", { pinnedAt: 2_000 }]])),
    },
  )

  await service.archive("session")

  assert.deepEqual(await service.list(), [])
  const archivedSessions = await service.listArchived()
  assert.equal(archivedSessions[0]?.id, "session")
  assert.equal(archivedSessions[0]?.pinnedAt, undefined)
  assert.equal(typeof archivedSessions[0]?.archivedAt, "number")
})

test("remove keeps local state when remote delete fails", async () => {
  const persistedActivity = activityStore(new Map([["session", 3_000]]))
  const persistedMetadata = metadataStore(new Map([["session", { pinnedAt: 2_000 }]]))
  const service = new SessionServiceImpl(
    {
      deleteSession: async () => {
        throw new Error("delete failed")
      },
    } as unknown as AgentManager,
    {
      activityStore: persistedActivity,
      metadataStore: persistedMetadata,
    },
  )

  await assert.rejects(service.remove("session"), /delete failed/)

  assert.deepEqual(await persistedActivity.read(), new Map([["session", 3_000]]))
  assert.deepEqual(await persistedMetadata.read(), new Map([["session", { pinnedAt: 2_000 }]]))
})
