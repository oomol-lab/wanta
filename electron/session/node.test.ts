import type { AgentManager } from "../agent/manager.ts"
import type { SessionActivityStore } from "./activity-store.ts"
import type { SessionInfo, SessionProject } from "./common.ts"
import type { SessionMetadata } from "./metadata-store.ts"
import type { SessionMetadataStore } from "./metadata-store.ts"
import type { SessionProjectStore } from "./project-store.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import { SessionServiceImpl } from "./node.ts"

const testOrganizationScope = {
  organizationId: "org-id",
  organizationName: "org-name",
}

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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
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
  const service = new SessionServiceImpl(agentWithSessions([recentSession, oldSession]), {
    metadataStore: metadataStore(
      new Map([
        ["old", { scope: testOrganizationScope }],
        ["recent", { scope: testOrganizationScope }],
      ]),
    ),
  })

  assert.equal(service.markUsed("old", 3_000), true)

  const sessions = await service.list({ scope: testOrganizationScope })

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
    { metadataStore: metadataStore(new Map([["session", { scope: testOrganizationScope }]])) },
  )

  assert.equal(service.markUsed("session", 3_000), true)

  const sessions = await service.list({ scope: testOrganizationScope })

  assert.equal(sessions[0]?.updatedAt, 5_000)
})

test("generateTitle preserves whether the title came from the model", async () => {
  const service = new SessionServiceImpl({
    generateSessionTitle: async () => ({ generated: true, title: "Gmail 三日报告" }),
  } as unknown as AgentManager)

  const result = await service.generateTitle({ text: "分析最近三天 Gmail 信息" })

  assert.deepEqual(result, { generated: true, title: "Gmail 三日报告" })
})

test("local session metadata remains writable while the agent is temporarily unavailable", async () => {
  const persistedMetadata = metadataStore()
  const service = new SessionServiceImpl(null, { metadataStore: persistedMetadata })

  await Promise.all([
    service.pin({ id: "session", pinned: true }),
    service.setKnowledgeBases({ id: "session", knowledgeBaseIds: ["knowledge"] }),
  ])

  assert.equal(typeof (await persistedMetadata.read()).get("session")?.pinnedAt, "number")
  assert.deepEqual((await persistedMetadata.read()).get("session")?.knowledgeBaseIds, ["knowledge"])
  await assert.rejects(service.rename({ id: "session", title: "Title" }), /Agent not configured/)
  await assert.rejects(service.remove("session"), /Agent not configured/)
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
          ["pinned", { pinnedAt: 4_000, scope: testOrganizationScope }],
          ["archived", { archivedAt: 5_000, scope: testOrganizationScope }],
        ]),
      ),
    },
  )

  const activeSessions = await service.list({ scope: testOrganizationScope })
  const archivedSessions = await service.listArchived({ scope: testOrganizationScope })

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
      metadataStore: metadataStore(
        new Map([["session", { permissionMode: "full_access", scope: testOrganizationScope }]]),
      ),
    },
  )

  assert.equal((await service.list({ scope: testOrganizationScope }))[0]?.permissionMode, "full_access")
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

test("setKnowledgeBases normalizes, persists, and clears session references", async () => {
  const persistedMetadata = metadataStore()
  const service = new SessionServiceImpl(agentWithSessions([]), {
    metadataStore: persistedMetadata,
  })

  await service.setKnowledgeBases({ id: "session", knowledgeBaseIds: [" first ", "first", "", "second"] })

  assert.deepEqual(await persistedMetadata.read(), new Map([["session", { knowledgeBaseIds: ["first", "second"] }]]))

  await service.setKnowledgeBases({ id: "session", knowledgeBaseIds: [] })

  assert.deepEqual(await persistedMetadata.read(), new Map())
})

test("list filters sessions by requested scope", async () => {
  const service = new SessionServiceImpl(
    agentWithSessions([
      {
        id: "archived",
        title: "Archived",
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
          ["archived", { scope: testOrganizationScope }],
          ["aaa", { scope: { organizationId: "aaa-id", organizationName: "aaa" } }],
          ["netless", { scope: { organizationId: "netless-id", organizationName: "netless" } }],
        ]),
      ),
    },
  )

  assert.deepEqual(
    (await service.list({ scope: { organizationId: "org-id", organizationName: "org-name" } })).map(
      (session) => session.id,
    ),
    ["archived"],
  )
  assert.deepEqual(
    (
      await service.list({
        scope: { organizationId: "aaa-id", organizationName: "aaa" },
      })
    ).map((session) => session.id),
    ["aaa"],
  )
})

test("list rejects invalid organization scope requests", async () => {
  const service = new SessionServiceImpl(agentWithSessions([]))

  await assert.rejects(
    () => service.list({ scope: { organizationId: "", organizationName: "Org" } }),
    /Organization scope is invalid/,
  )
})

test("list filters sessions by requested placement", async () => {
  const project: SessionProject = {
    id: "project",
    name: "Wanta",
    path: "/Users/example/code/wanta",
    createdAt: 1_000,
    updatedAt: 1_000,
    scope: { organizationId: "org-id", organizationName: "org-name" },
  }
  const archivedProject: SessionProject = {
    id: "archived-project",
    name: "Archived",
    path: "/Users/example/code/archived",
    createdAt: 1_000,
    updatedAt: 1_000,
    archivedAt: 4_000,
    scope: { organizationId: "org-id", organizationName: "org-name" },
  }
  const scopedProject: SessionProject = {
    id: "scoped-project",
    name: "Scoped",
    path: "/Users/example/code/scoped",
    createdAt: 1_000,
    updatedAt: 1_000,
    scope: { organizationId: "org", organizationName: "Org" },
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
          ["task", { scope: testOrganizationScope }],
          [
            "project-session",
            {
              scope: { organizationId: "org-id", organizationName: "org-name" },
              projectId: project.id,
            },
          ],
          [
            "dangling-project-session",
            {
              scope: { organizationId: "org-id", organizationName: "org-name" },
              projectId: "missing-project",
            },
          ],
          [
            "archived-project-session",
            {
              scope: { organizationId: "org-id", organizationName: "org-name" },
              projectId: archivedProject.id,
            },
          ],
          [
            "scoped-project-session",
            {
              scope: { organizationId: "org-id", organizationName: "org-name" },
              projectId: scopedProject.id,
            },
          ],
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

  const allSessions = await service.list({
    placement: "all",
    scope: { organizationId: "org-id", organizationName: "org-name" },
  })
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
    (
      await service.list({
        placement: "project",
        scope: { organizationId: "org-id", organizationName: "org-name" },
      })
    ).map((session) => session.id),
    ["project-session"],
  )
  assert.deepEqual(
    (
      await service.list({
        placement: "task",
        scope: { organizationId: "org-id", organizationName: "org-name" },
      })
    ).map((session) => session.id),
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
    scope: { organizationId: "org-id", organizationName: "org-name" },
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
          [
            "archived-task",
            {
              archivedAt: 3_000,
              scope: { organizationId: "org-id", organizationName: "org-name" },
            },
          ],
          [
            "archived-project",
            {
              archivedAt: 4_000,
              scope: { organizationId: "org-id", organizationName: "org-name" },
              projectId: project.id,
            },
          ],
        ]),
      ),
      projectStore: projectStore(new Map([[project.id, project]])),
    },
  )

  assert.deepEqual(
    (
      await service.listArchived({
        placement: "task",
        scope: { organizationId: "org-id", organizationName: "org-name" },
      })
    ).map((session) => session.id),
    ["archived-task"],
  )
  assert.deepEqual(
    (
      await service.listArchived({
        placement: "project",
        scope: { organizationId: "org-id", organizationName: "org-name" },
      })
    ).map((session) => session.id),
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

  const scope = { organizationId: "aaa-id", organizationName: "aaa" }
  const created = await service.create({ scope, title: "Scoped" })

  assert.deepEqual(created.scope, scope)
  assert.deepEqual(await persistedMetadata.read(), new Map([["created", { scope }]]))
})

test("create removes the OpenCode session when local metadata persistence fails", async () => {
  const deleted: string[] = []
  const service = new SessionServiceImpl(
    {
      createSession: async () => ({ id: "created", title: "Created", createdAt: 1_000, updatedAt: 1_000 }),
      deleteSession: async (id: string) => {
        deleted.push(id)
      },
    } as unknown as AgentManager,
    {
      metadataStore: {
        read: async () => new Map(),
        write: async () => {
          throw new Error("metadata write failed")
        },
      } as unknown as SessionMetadataStore,
    },
  )

  await assert.rejects(service.create({ scope: testOrganizationScope }), /metadata write failed/)

  assert.deepEqual(deleted, ["created"])
})

test("createProject reuses an existing project in the same scope", async () => {
  const persistedProjects = projectStore()
  const service = new SessionServiceImpl(agentWithSessions([]), {
    projectStore: persistedProjects,
  })

  const first = await service.createProject({
    path: "/Users/example/code/wanta",
    scope: { organizationId: "org-id", organizationName: "org-name" },
  })
  const second = await service.createProject({
    path: "/Users/example/code/wanta/",
    scope: { organizationId: "org-id", organizationName: "org-name" },
  })

  assert.equal(first.id, second.id)
  assert.deepEqual(
    (await service.listProjects({ scope: testOrganizationScope })).map((project) => ({
      id: project.id,
      name: project.name,
      path: project.path,
    })),
    [{ id: first.id, name: "wanta", path: "/Users/example/code/wanta" }],
  )
})

test("createProject consumes a one-time native picker trust entry", async () => {
  const trustedProjectPaths = new Set(["/Users/example/code/trusted"])
  const service = new SessionServiceImpl(agentWithSessions([]), {
    projectStore: projectStore(),
    trustedProjectPaths,
  })

  await assert.rejects(
    service.createProject({ path: "/Users/example/code/untrusted", scope: testOrganizationScope }),
    /native directory picker/,
  )
  const created = await service.createProject({
    path: "/Users/example/code/trusted",
    scope: testOrganizationScope,
  })

  assert.equal(created.path, "/Users/example/code/trusted")
  assert.equal(trustedProjectPaths.size, 0)
})

test("createProject restores an archived project with the same path", async () => {
  const persistedProjects = projectStore(
    new Map([
      [
        "project",
        {
          id: "project",
          name: "Wanta",
          path: "/Users/example/code/wanta",
          archivedAt: 3_000,
          createdAt: 1_000,
          pinnedAt: 2_000,
          updatedAt: 1_000,
          scope: { organizationId: "org-id", organizationName: "org-name" },
        },
      ],
    ]),
  )
  const service = new SessionServiceImpl(agentWithSessions([]), {
    projectStore: persistedProjects,
  })

  const restored = await service.createProject({
    path: "/Users/example/code/wanta",
    scope: { organizationId: "org-id", organizationName: "org-name" },
  })

  assert.equal(restored.id, "project")
  assert.equal(restored.archivedAt, undefined)
  assert.equal(restored.pinnedAt, undefined)
  assert.equal((await persistedProjects.read()).get("project")?.archivedAt, undefined)
  assert.equal((await persistedProjects.read()).get("project")?.pinnedAt, undefined)
  assert.deepEqual(
    (await service.listProjects({ scope: testOrganizationScope })).map((project) => project.id),
    ["project"],
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
          scope: { organizationId: "org-id", organizationName: "org-name" },
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
          scope: { organizationId: "org-id", organizationName: "org-name" },
        },
      ],
    ]),
  )
  const service = new SessionServiceImpl(agentWithSessions([]), {
    projectStore: persistedProjects,
  })

  await service.renameProject({ id: "project-a", name: "Renamed" })
  await service.pinProject({ id: "project-a", pinned: true })

  const projects = await service.listProjects({ scope: testOrganizationScope })

  assert.equal(projects[0]?.id, "project-a")
  assert.equal(projects[0]?.name, "Renamed")
  assert.equal(typeof projects[0]?.pinnedAt, "number")
  assert.equal((await persistedProjects.read()).get("project-a")?.name, "Renamed")
})

test("archiveProject hides the project and archives assigned sessions", async () => {
  const persistedMetadata = metadataStore(
    new Map([
      [
        "session",
        {
          pinnedAt: 2_000,
          projectId: "project",
          scope: { organizationId: "org-id", organizationName: "org-name" },
        },
      ],
      ["task", { scope: { organizationId: "org-id", organizationName: "org-name" } }],
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
          scope: { organizationId: "org-id", organizationName: "org-name" },
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
    (await service.listProjects({ scope: testOrganizationScope })).map((project) => project.id),
    [],
  )
  assert.deepEqual(
    (await service.list({ scope: testOrganizationScope })).map((session) => session.id),
    ["task"],
  )
  assert.deepEqual(
    (await service.listArchived({ scope: testOrganizationScope })).map((session) => session.id),
    ["session"],
  )
  const archivedProject = (await persistedProjects.read()).get("project")
  assert.equal(typeof archivedProject?.archivedAt, "number")
  assert.equal(archivedProject?.pinnedAt, undefined)
  const archivedSessionMetadata = (await persistedMetadata.read()).get("session")
  assert.equal(typeof archivedSessionMetadata?.archivedAt, "number")
  assert.equal(archivedSessionMetadata?.pinnedAt, undefined)
})

test("unarchive restores the assigned project when it was archived with the session", async () => {
  const persistedMetadata = metadataStore(
    new Map([
      [
        "session",
        {
          archivedAt: 3_000,
          pinnedAt: 2_000,
          projectId: "project",
          scope: { organizationId: "org-id", organizationName: "org-name" },
        },
      ],
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
          archivedAt: 3_000,
          createdAt: 1_000,
          pinnedAt: 2_000,
          updatedAt: 1_000,
          scope: { organizationId: "org-id", organizationName: "org-name" },
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
      metadataStore: persistedMetadata,
      projectStore: persistedProjects,
    },
  )

  const restored = await service.unarchive("session")

  assert.equal(restored?.projectId, "project")
  assert.equal((await persistedMetadata.read()).get("session")?.archivedAt, undefined)
  assert.equal((await persistedMetadata.read()).get("session")?.pinnedAt, undefined)
  assert.equal((await persistedProjects.read()).get("project")?.archivedAt, undefined)
  assert.equal((await persistedProjects.read()).get("project")?.pinnedAt, undefined)
  assert.deepEqual(
    (await service.listProjects({ scope: testOrganizationScope })).map((project) => project.id),
    ["project"],
  )
})

test("archiveProject rolls back project state when metadata persistence fails", async () => {
  const persistedMetadata = metadataStore(
    new Map([
      [
        "session",
        {
          pinnedAt: 2_000,
          projectId: "project",
          scope: { organizationId: "org-id", organizationName: "org-name" },
        },
      ],
    ]),
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
          scope: { organizationId: "org-id", organizationName: "org-name" },
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

  const projects = await service.listProjects({ scope: testOrganizationScope })
  assert.equal(projects[0]?.archivedAt, undefined)
  assert.equal(projects[0]?.pinnedAt, 2_000)
  assert.deepEqual(
    (await service.list({ scope: testOrganizationScope })).map((session) => session.id),
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
    scope: { organizationId: "org-id", organizationName: "org-name" },
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

  const created = await service.create({
    projectId: "project",
    scope: { organizationId: "org-id", organizationName: "org-name" },
    title: "Scoped",
  })

  assert.equal(created.projectId, "project")
  assert.deepEqual(
    await persistedMetadata.read(),
    new Map([
      [
        "created",
        {
          scope: { organizationId: "org-id", organizationName: "org-name" },
          projectId: "project",
        },
      ],
    ]),
  )
})

test("assignSessionProject persists only projects in the session scope", async () => {
  const persistedMetadata = metadataStore(
    new Map([["session", { scope: { organizationId: "org-id", organizationName: "org-name" } }]]),
  )
  const archiveProject: SessionProject = {
    id: "archive-project",
    name: "Archive",
    path: "/Users/example/code/archive",
    createdAt: 1_000,
    updatedAt: 1_000,
    scope: { organizationId: "org-id", organizationName: "org-name" },
  }
  const organizationProject: SessionProject = {
    id: "organization-project",
    name: "Organization",
    path: "/Users/example/code/organization",
    createdAt: 5_000,
    updatedAt: 5_000,
    scope: { organizationId: "org", organizationName: "Org" },
  }
  const archivedProject: SessionProject = {
    id: "archived-project",
    name: "Archived",
    path: "/Users/example/code/archived",
    archivedAt: 6_000,
    createdAt: 6_000,
    updatedAt: 6_000,
    scope: { organizationId: "org-id", organizationName: "org-name" },
  }
  const persistedProjects = projectStore(
    new Map([
      [archiveProject.id, archiveProject],
      [organizationProject.id, organizationProject],
      [archivedProject.id, archivedProject],
    ]),
  )
  const service = new SessionServiceImpl(agentWithSessions([]), {
    metadataStore: persistedMetadata,
    projectStore: persistedProjects,
  })

  await service.assignSessionProject({ sessionId: "session", projectId: "archive-project" })

  assert.equal((await persistedMetadata.read()).get("session")?.projectId, "archive-project")
  assert.equal((await persistedProjects.read()).get("archive-project")?.updatedAt, archiveProject.updatedAt)

  await service.assignSessionProject({ sessionId: "session", projectId: "organization-project" })

  assert.deepEqual(
    await persistedMetadata.read(),
    new Map([["session", { scope: { organizationId: "org-id", organizationName: "org-name" } }]]),
  )
  assert.equal((await persistedProjects.read()).get("organization-project")?.updatedAt, organizationProject.updatedAt)

  await service.assignSessionProject({ sessionId: "session", projectId: "archived-project" })

  assert.deepEqual(
    await persistedMetadata.read(),
    new Map([["session", { scope: { organizationId: "org-id", organizationName: "org-name" } }]]),
  )
  assert.equal((await persistedProjects.read()).get("archived-project")?.updatedAt, archivedProject.updatedAt)
})

test("recordUseAndEmit keeps the assigned project's order unchanged", async () => {
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
          scope: { organizationId: "org-id", organizationName: "org-name" },
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
      metadataStore: metadataStore(
        new Map([
          [
            "session",
            {
              scope: { organizationId: "org-id", organizationName: "org-name" },
              projectId: "project",
            },
          ],
        ]),
      ),
      projectStore: persistedProjects,
    },
  )

  await service.recordUseAndEmit("session", 5_000)

  assert.equal((await persistedProjects.read()).get("project")?.updatedAt, 1_000)
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
      metadataStore: metadataStore(new Map([["session", { pinnedAt: 2_000, scope: testOrganizationScope }]])),
    },
  )

  await service.archive("session")

  assert.deepEqual(await service.list({ scope: testOrganizationScope }), [])
  const archivedSessions = await service.listArchived({ scope: testOrganizationScope })
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

test("runtime reset discards stale store loads before listing the replacement agent", async () => {
  const firstRead = deferred<Map<string, SessionMetadata>>()
  let metadataReadCount = 0
  let oldAgentListCount = 0
  let newAgentListCount = 0
  const persistedMetadata = {
    read: async () => {
      metadataReadCount += 1
      if (metadataReadCount === 1) {
        return firstRead.promise
      }
      return new Map([["new-session", { scope: testOrganizationScope }]])
    },
    write: async () => undefined,
  } as unknown as SessionMetadataStore
  const oldAgent = {
    listSessions: async () => {
      oldAgentListCount += 1
      return []
    },
  } as unknown as AgentManager
  const newAgent = {
    listSessions: async () => {
      newAgentListCount += 1
      return [{ id: "new-session", title: "New", createdAt: 1_000, updatedAt: 1_000 }]
    },
  } as unknown as AgentManager
  const service = new SessionServiceImpl(oldAgent, { metadataStore: persistedMetadata })

  const staleList = service.list({ scope: testOrganizationScope })
  assert.equal(metadataReadCount, 1)
  service.setAgent(null)
  service.setAgent(newAgent)
  firstRead.resolve(new Map([["old-session", { scope: testOrganizationScope }]]))

  assert.deepEqual(await staleList, [])
  assert.equal(oldAgentListCount, 0)
  assert.deepEqual(
    (await service.list({ scope: testOrganizationScope })).map((session) => session.id),
    ["new-session"],
  )
  assert.equal(metadataReadCount, 2)
  assert.equal(newAgentListCount, 1)
})

test("runtime reset rejects a queued mutation instead of running it on the replacement agent", async () => {
  const writeStarted = deferred<void>()
  const releaseWrite = deferred<void>()
  let oldCreateCount = 0
  let newCreateCount = 0
  const persistedMetadata = {
    read: async () => new Map<string, SessionMetadata>(),
    write: async () => {
      writeStarted.resolve(undefined)
      await releaseWrite.promise
    },
  } as unknown as SessionMetadataStore
  const oldAgent = {
    createSession: async () => {
      oldCreateCount += 1
      throw new Error("unexpected old agent create")
    },
  } as unknown as AgentManager
  const newAgent = {
    createSession: async () => {
      newCreateCount += 1
      throw new Error("unexpected new agent create")
    },
  } as unknown as AgentManager
  const service = new SessionServiceImpl(oldAgent, { metadataStore: persistedMetadata })

  const activeMutation = service.pin({ id: "session", pinned: true })
  await writeStarted.promise
  const queuedCreate = service.create({ scope: testOrganizationScope })
  service.setAgent(null)
  service.setAgent(newAgent)
  releaseWrite.resolve(undefined)

  await activeMutation
  await assert.rejects(queuedCreate, /Agent runtime changed/)
  assert.equal(oldCreateCount, 0)
  assert.equal(newCreateCount, 0)
})

test("runtime reset rolls back a remotely created session before local persistence", async () => {
  const createStarted = deferred<void>()
  const createResult = deferred<SessionInfo>()
  const deletedSessionIds: string[] = []
  const oldAgent = {
    createSession: async () => {
      createStarted.resolve(undefined)
      return createResult.promise
    },
    deleteSession: async (sessionId: string) => {
      deletedSessionIds.push(sessionId)
    },
  } as unknown as AgentManager
  const service = new SessionServiceImpl(oldAgent, { metadataStore: metadataStore() })

  const pendingCreate = service.create({ scope: testOrganizationScope })
  await createStarted.promise
  service.setAgent(null)
  service.setAgent(agentWithSessions([]))
  createResult.resolve({ id: "created", title: "Created", createdAt: 1_000, updatedAt: 1_000 })

  await assert.rejects(pendingCreate, /Agent runtime changed/)
  assert.deepEqual(deletedSessionIds, ["created"])
})
