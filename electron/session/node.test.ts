import type { AgentManager } from "../agent/manager.ts"
import type { SessionActivityStore } from "./activity-store.ts"
import type { SessionInfo, SessionProject } from "./common.ts"
import type { SessionMetadata } from "./metadata-store.ts"
import type { SessionMetadataStore } from "./metadata-store.ts"
import type { SessionProjectStore } from "./project-store.ts"

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

function projectStore(initial = new Map<string, SessionProject>()): SessionProjectStore {
  let projects = initial
  return {
    read: async () => projects,
    write: async (next) => {
      projects = new Map(next)
    },
  } as SessionProjectStore
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

test("list merges persisted session permission mode", async () => {
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
      metadataStore: metadataStore(new Map([["session", { permissionMode: "full_access" }]])),
    },
  )

  assert.equal((await service.list())[0]?.permissionMode, "full_access")
})

test("setPermissionMode persists full access and clears default", async () => {
  const persistedMetadata = metadataStore()
  const service = new SessionServiceImpl(agentWithSessions([]), {
    metadataStore: persistedMetadata,
  })

  await service.setPermissionMode({ id: "session", permissionMode: "full_access" })

  assert.deepEqual(await persistedMetadata.read(), new Map([["session", { permissionMode: "full_access" }]]))

  await service.setPermissionMode({ id: "session", permissionMode: "default" })

  assert.deepEqual(await persistedMetadata.read(), new Map())
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

test("list filters sessions by requested placement", async () => {
  const project: SessionProject = {
    id: "project",
    name: "Wanta",
    path: "/Users/example/code/wanta",
    createdAt: 1_000,
    updatedAt: 1_000,
    scope: { type: "personal" },
  }
  const archivedProject: SessionProject = {
    id: "archived-project",
    name: "Archived",
    path: "/Users/example/code/archived",
    createdAt: 1_000,
    updatedAt: 1_000,
    archivedAt: 4_000,
    scope: { type: "personal" },
  }
  const scopedProject: SessionProject = {
    id: "scoped-project",
    name: "Scoped",
    path: "/Users/example/code/scoped",
    createdAt: 1_000,
    updatedAt: 1_000,
    scope: { type: "organization", organizationId: "org", organizationName: "Org" },
  }
  const service = new SessionServiceImpl(
    agentWithSessions([
      {
        id: "task",
        title: "Task",
        createdAt: 1_000,
        updatedAt: 1_000,
      },
      {
        id: "project-session",
        title: "Project",
        createdAt: 2_000,
        updatedAt: 2_000,
      },
      {
        id: "dangling-project-session",
        title: "Dangling",
        createdAt: 3_000,
        updatedAt: 3_000,
      },
      {
        id: "archived-project-session",
        title: "Archived project",
        createdAt: 4_000,
        updatedAt: 4_000,
      },
      {
        id: "scoped-project-session",
        title: "Scoped project",
        createdAt: 5_000,
        updatedAt: 5_000,
      },
    ]),
    {
      metadataStore: metadataStore(
        new Map([
          ["project-session", { scope: { type: "personal" }, projectId: project.id }],
          ["dangling-project-session", { scope: { type: "personal" }, projectId: "missing-project" }],
          ["archived-project-session", { scope: { type: "personal" }, projectId: archivedProject.id }],
          ["scoped-project-session", { scope: { type: "personal" }, projectId: scopedProject.id }],
        ]),
      ),
      projectStore: projectStore(
        new Map([
          [project.id, project],
          [archivedProject.id, archivedProject],
          [scopedProject.id, scopedProject],
        ]),
      ),
    },
  )

  const allSessions = await service.list({ placement: "all", scope: { type: "personal" } })
  assert.deepEqual(
    allSessions.map((session) => ({ id: session.id, projectId: session.projectId })),
    [
      { id: "scoped-project-session", projectId: undefined },
      { id: "archived-project-session", projectId: undefined },
      { id: "dangling-project-session", projectId: undefined },
      { id: "project-session", projectId: "project" },
      { id: "task", projectId: undefined },
    ],
  )
  assert.deepEqual(
    (await service.list({ placement: "project", scope: { type: "personal" } })).map((session) => session.id),
    ["project-session"],
  )
  assert.deepEqual(
    (await service.list({ placement: "task", scope: { type: "personal" } })).map((session) => session.id),
    ["scoped-project-session", "archived-project-session", "dangling-project-session", "task"],
  )
})

test("listArchived filters sessions by requested placement", async () => {
  const project: SessionProject = {
    id: "project",
    name: "Wanta",
    path: "/Users/example/code/wanta",
    createdAt: 1_000,
    updatedAt: 1_000,
    scope: { type: "personal" },
  }
  const service = new SessionServiceImpl(
    agentWithSessions([
      {
        id: "archived-task",
        title: "Archived task",
        createdAt: 1_000,
        updatedAt: 1_000,
      },
      {
        id: "archived-project",
        title: "Archived project",
        createdAt: 2_000,
        updatedAt: 2_000,
      },
    ]),
    {
      metadataStore: metadataStore(
        new Map([
          ["archived-task", { archivedAt: 3_000, scope: { type: "personal" } }],
          ["archived-project", { archivedAt: 4_000, scope: { type: "personal" }, projectId: project.id }],
        ]),
      ),
      projectStore: projectStore(new Map([[project.id, project]])),
    },
  )

  assert.deepEqual(
    (await service.listArchived({ placement: "task", scope: { type: "personal" } })).map((session) => session.id),
    ["archived-task"],
  )
  assert.deepEqual(
    (await service.listArchived({ placement: "project", scope: { type: "personal" } })).map((session) => session.id),
    ["archived-project"],
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

test("createProject reuses an existing project in the same scope", async () => {
  const persistedProjects = projectStore()
  const service = new SessionServiceImpl(agentWithSessions([]), {
    projectStore: persistedProjects,
  })

  const first = await service.createProject({ path: "/Users/example/code/wanta", scope: { type: "personal" } })
  const second = await service.createProject({ path: "/Users/example/code/wanta/", scope: { type: "personal" } })

  assert.equal(first.id, second.id)
  assert.deepEqual(
    (await service.listProjects()).map((project) => ({ id: project.id, name: project.name, path: project.path })),
    [{ id: first.id, name: "wanta", path: "/Users/example/code/wanta" }],
  )
})

test("project actions rename, pin, and sort projects", async () => {
  const persistedProjects = projectStore(
    new Map([
      [
        "project-a",
        {
          id: "project-a",
          name: "A",
          path: "/Users/example/code/a",
          createdAt: 1_000,
          updatedAt: 1_000,
          scope: { type: "personal" },
        },
      ],
      [
        "project-b",
        {
          id: "project-b",
          name: "B",
          path: "/Users/example/code/b",
          createdAt: 2_000,
          updatedAt: 2_000,
          scope: { type: "personal" },
        },
      ],
    ]),
  )
  const service = new SessionServiceImpl(agentWithSessions([]), {
    projectStore: persistedProjects,
  })

  await service.renameProject({ id: "project-a", name: "Renamed" })
  await service.pinProject({ id: "project-a", pinned: true })

  const projects = await service.listProjects()

  assert.equal(projects[0]?.id, "project-a")
  assert.equal(projects[0]?.name, "Renamed")
  assert.equal(typeof projects[0]?.pinnedAt, "number")
  assert.equal((await persistedProjects.read()).get("project-a")?.name, "Renamed")
})

test("archiveProject hides the project and archives assigned sessions", async () => {
  const persistedMetadata = metadataStore(
    new Map([
      ["session", { pinnedAt: 2_000, projectId: "project", scope: { type: "personal" } }],
      ["task", { scope: { type: "personal" } }],
    ]),
  )
  const persistedProjects = projectStore(
    new Map([
      [
        "project",
        {
          id: "project",
          name: "Wanta",
          path: "/Users/example/code/wanta",
          createdAt: 1_000,
          updatedAt: 1_000,
          pinnedAt: 2_000,
          scope: { type: "personal" },
        },
      ],
    ]),
  )
  const service = new SessionServiceImpl(
    agentWithSessions([
      {
        id: "session",
        title: "Session",
        createdAt: 1_000,
        updatedAt: 1_000,
      },
      {
        id: "task",
        title: "Task",
        createdAt: 2_000,
        updatedAt: 2_000,
      },
    ]),
    {
      metadataStore: persistedMetadata,
      projectStore: persistedProjects,
    },
  )

  await service.archiveProject("project")

  assert.deepEqual(
    (await service.listProjects()).map((project) => project.id),
    [],
  )
  assert.deepEqual(
    (await service.list()).map((session) => session.id),
    ["task"],
  )
  assert.deepEqual(
    (await service.listArchived()).map((session) => session.id),
    ["session"],
  )
  const archivedProject = (await persistedProjects.read()).get("project")
  assert.equal(typeof archivedProject?.archivedAt, "number")
  assert.equal(archivedProject?.pinnedAt, undefined)
  const archivedSessionMetadata = (await persistedMetadata.read()).get("session")
  assert.equal(typeof archivedSessionMetadata?.archivedAt, "number")
  assert.equal(archivedSessionMetadata?.pinnedAt, undefined)
})

test("archiveProject rolls back project state when metadata persistence fails", async () => {
  const persistedMetadata = metadataStore(
    new Map([["session", { pinnedAt: 2_000, projectId: "project", scope: { type: "personal" } }]]),
  )
  let failMetadataWrite = true
  const failingMetadataStore = {
    read: persistedMetadata.read,
    write: async (next: Map<string, SessionMetadata>) => {
      if (failMetadataWrite) {
        failMetadataWrite = false
        throw new Error("metadata write failed")
      }
      await persistedMetadata.write(next)
    },
  } as SessionMetadataStore
  const persistedProjects = projectStore(
    new Map([
      [
        "project",
        {
          id: "project",
          name: "Wanta",
          path: "/Users/example/code/wanta",
          createdAt: 1_000,
          updatedAt: 1_000,
          pinnedAt: 2_000,
          scope: { type: "personal" },
        },
      ],
    ]),
  )
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
      metadataStore: failingMetadataStore,
      projectStore: persistedProjects,
    },
  )

  await assert.rejects(() => service.archiveProject("project"), /metadata write failed/)

  const projects = await service.listProjects()
  assert.equal(projects[0]?.archivedAt, undefined)
  assert.equal(projects[0]?.pinnedAt, 2_000)
  assert.deepEqual(
    (await service.list()).map((session) => session.id),
    ["session"],
  )
  const restoredProject = (await persistedProjects.read()).get("project")
  assert.equal(restoredProject?.archivedAt, undefined)
  assert.equal(restoredProject?.pinnedAt, 2_000)
})

test("create persists project assignment when the project matches the session scope", async () => {
  const persistedMetadata = metadataStore()
  const project: SessionProject = {
    id: "project",
    name: "Wanta",
    path: "/Users/example/code/wanta",
    createdAt: 1_000,
    updatedAt: 1_000,
    scope: { type: "personal" },
  }
  const service = new SessionServiceImpl(
    {
      createSession: async (title?: string) => ({
        id: "created",
        title: title ?? "Untitled",
        createdAt: 2_000,
        updatedAt: 2_000,
      }),
      listSessions: async () => [
        {
          id: "created",
          title: "Scoped",
          createdAt: 2_000,
          updatedAt: 2_000,
        },
      ],
    } as unknown as AgentManager,
    {
      metadataStore: persistedMetadata,
      projectStore: projectStore(new Map([[project.id, project]])),
    },
  )

  const created = await service.create({ projectId: "project", scope: { type: "personal" }, title: "Scoped" })

  assert.equal(created.projectId, "project")
  assert.deepEqual(
    await persistedMetadata.read(),
    new Map([["created", { scope: { type: "personal" }, projectId: "project" }]]),
  )
})

test("assignSessionProject persists only projects in the session scope", async () => {
  const persistedMetadata = metadataStore(new Map([["session", { scope: { type: "personal" } }]]))
  const personalProject: SessionProject = {
    id: "personal-project",
    name: "Personal",
    path: "/Users/example/code/personal",
    createdAt: 1_000,
    updatedAt: 1_000,
    scope: { type: "personal" },
  }
  const organizationProject: SessionProject = {
    id: "organization-project",
    name: "Organization",
    path: "/Users/example/code/organization",
    createdAt: 5_000,
    updatedAt: 5_000,
    scope: { type: "organization", organizationId: "org", organizationName: "Org" },
  }
  const archivedProject: SessionProject = {
    id: "archived-project",
    name: "Archived",
    path: "/Users/example/code/archived",
    archivedAt: 6_000,
    createdAt: 6_000,
    updatedAt: 6_000,
    scope: { type: "personal" },
  }
  const persistedProjects = projectStore(
    new Map([
      [personalProject.id, personalProject],
      [organizationProject.id, organizationProject],
      [archivedProject.id, archivedProject],
    ]),
  )
  const service = new SessionServiceImpl(agentWithSessions([]), {
    metadataStore: persistedMetadata,
    projectStore: persistedProjects,
  })

  await service.assignSessionProject({ sessionId: "session", projectId: "personal-project" })

  assert.equal((await persistedMetadata.read()).get("session")?.projectId, "personal-project")
  assert.ok(((await persistedProjects.read()).get("personal-project")?.updatedAt ?? 0) > personalProject.updatedAt)

  await service.assignSessionProject({ sessionId: "session", projectId: "organization-project" })

  assert.deepEqual(await persistedMetadata.read(), new Map([["session", { scope: { type: "personal" } }]]))
  assert.equal((await persistedProjects.read()).get("organization-project")?.updatedAt, organizationProject.updatedAt)

  await service.assignSessionProject({ sessionId: "session", projectId: "archived-project" })

  assert.deepEqual(await persistedMetadata.read(), new Map([["session", { scope: { type: "personal" } }]]))
  assert.equal((await persistedProjects.read()).get("archived-project")?.updatedAt, archivedProject.updatedAt)
})

test("recordUseAndEmit touches assigned project activity", async () => {
  const persistedProjects = projectStore(
    new Map([
      [
        "project",
        {
          id: "project",
          name: "Wanta",
          path: "/Users/example/code/wanta",
          createdAt: 1_000,
          updatedAt: 1_000,
          scope: { type: "personal" },
        },
      ],
    ]),
  )
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
      activityStore: activityStore(),
      metadataStore: metadataStore(new Map([["session", { scope: { type: "personal" }, projectId: "project" }]])),
      projectStore: persistedProjects,
    },
  )

  await service.recordUseAndEmit("session", 5_000)

  assert.equal((await persistedProjects.read()).get("project")?.updatedAt, 5_000)
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

test("remove invokes local cleanup after remote delete succeeds", async () => {
  const removed: string[] = []
  const service = new SessionServiceImpl(
    {
      deleteSession: async () => undefined,
    } as unknown as AgentManager,
    {
      onSessionRemoved: (sessionId) => {
        removed.push(sessionId)
      },
    },
  )

  await service.remove("session")

  assert.deepEqual(removed, ["session"])
})
