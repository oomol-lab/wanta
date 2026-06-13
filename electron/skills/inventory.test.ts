import type { ManagedSkillGroup } from "./common.ts"
import type { InstalledSkill, SkillManifestStore } from "./types.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import { manifestSchemaVersion } from "./constants.ts"
import { buildSummary, groupInstalledSkills, resolveMyPublishedSkillInstallState } from "./inventory.ts"

const agents = [
  {
    cliCommands: ["codex"],
    homeRoot: ".codex",
    id: "codex",
    name: "Codex",
    ooCliAgentId: "codex",
  },
  {
    cliCommands: ["claude"],
    homeRoot: ".claude",
    id: "claude",
    name: "Claude Code",
    ooCliAgentId: "claude",
  },
]

const installedSkills: InstalledSkill[] = [
  {
    agent: agents[0],
    hash: "hash-a",
    metadata: {
      description: "Use OOMOL hosted capabilities",
      kind: "bundled",
      version: "1.0.0",
    },
    name: "oo",
    path: "/codex/skills/oo",
    sourceHash: "hash-b",
    sourcePath: "/oo/skills/bundled/codex/oo",
  },
  {
    agent: agents[1],
    hash: "hash-c",
    metadata: {
      description: "Example registry skill",
      icon: ":lucide:captions:",
      kind: "registry",
      packageName: "@oomol/example",
      version: "1.0.0",
    },
    name: "example",
    path: "/claude/skills/example",
    sourceHash: "hash-c",
    sourcePath: "/oo/skills/registry/example",
  },
]

const manifestStore: SkillManifestStore = {
  schemaVersion: manifestSchemaVersion,
  records: [],
}

test("groupInstalledSkills includes built-in groups and agent coverage", () => {
  const groups = groupInstalledSkills(installedSkills, manifestStore, agents)
  const oo = groups.find((group) => group.id === "oo")
  const example = groups.find((group) => group.id === "example")

  assert.equal(oo?.isBuiltIn, true)
  assert.equal(oo?.description, "Use OOMOL hosted capabilities")
  assert.equal(oo?.hosts.length, 2)
  assert.equal(oo?.hosts[0]?.controlState, "modified")
  assert.equal(example?.packageName, "@oomol/example")
  assert.equal(example?.icon, ":lucide:captions:")
  assert.equal(example?.description, "Example registry skill")
  assert.equal(example?.hosts[1]?.controlState, "controlled")
  assert.deepEqual(
    groups.slice(0, 4).map((group) => group.id),
    ["oo", "oo-find-skills", "oo-create-skill", "oo-publish-skill"],
  )
  assert.deepEqual(
    groups.slice(0, 4).map((group) => group.icon),
    [":lucide:sparkles:", ":lucide:search:", ":lucide:wand-sparkles:", ":lucide:upload-cloud:"],
  )
})

test("buildSummary counts built-in coverage and attention hosts", () => {
  const groups = groupInstalledSkills(installedSkills, manifestStore, agents)
  const summary = buildSummary(groups, [
    {
      agentId: "codex",
      agentName: "Codex",
      description: "Publishable project",
      id: "codex:publishable",
      name: "publishable",
      path: "/codex/skills/publishable",
    },
  ])

  assert.equal(summary.builtInTotal, 4)
  assert.equal(summary.builtInInstalled, 1)
  assert.equal(summary.managedSkills, 2)
  assert.equal(summary.modifiedHosts, 1)
  assert.equal(summary.needsAttention, 4)
  assert.equal(summary.publishableSkills, 1)
  assert.equal(summary.registrySkills, 1)
  assert.deepEqual(
    summary.nonBuiltInSkills.map((skill) => skill.id),
    ["example"],
  )
  assert.equal(summary.nonBuiltInSkills[0]?.modifiedHosts, 0)
  assert.equal(summary.nonBuiltInSkills[0]?.icon, ":lucide:captions:")
  assert.equal(summary.nonBuiltInSkills[0]?.sourceMissingHosts, 0)
  assert.equal(summary.nonBuiltInSkills[0]?.unknownHosts, 0)
})

test("buildSummary keeps mixed-kind same-id skills in one unknown group", () => {
  const mixedInstalledSkills: InstalledSkill[] = [
    {
      agent: agents[0],
      hash: "hash-local",
      metadata: {
        kind: "local",
        packageName: "@alice/example",
        version: "1.0.0",
      },
      name: "mixed-skill",
      path: "/codex/skills/mixed-skill",
      sourceHash: "hash-local",
      sourcePath: "/workspace/mixed-skill",
    },
    {
      agent: agents[1],
      hash: "hash-registry",
      metadata: {
        kind: "registry",
        packageName: "@oomol/mixed-skill",
        version: "2.0.0",
      },
      name: "mixed-skill",
      path: "/claude/skills/mixed-skill",
      sourceHash: "hash-registry",
      sourcePath: "/oo/skills/registry/mixed-skill",
    },
  ]
  const groups = groupInstalledSkills(mixedInstalledSkills, manifestStore, agents)
  const group = groups.find((item) => item.id === "mixed-skill")
  const summary = buildSummary(groups)

  assert.equal(group?.kind, "unknown")
  assert.equal(summary.localSkills, 0)
  assert.equal(summary.registrySkills, 0)
  assert.deepEqual(
    summary.nonBuiltInSkills.map((skill) => skill.id),
    ["mixed-skill"],
  )
  assert.equal(summary.nonBuiltInSkills[0]?.kind, "unknown")
})

test("buildSummary does not report built-in missing when no agent is discovered", () => {
  const groups = groupInstalledSkills([], manifestStore, [])
  const summary = buildSummary(groups)

  assert.equal(summary.builtInTotal, 4)
  assert.equal(summary.builtInInstalled, 0)
  assert.equal(summary.builtInMissing, 0)
  assert.equal(summary.needsAttention, 0)
  assert.deepEqual(
    summary.builtInSkills.map((skill) => skill.status),
    ["unknown", "unknown", "unknown", "unknown"],
  )
})

test("resolveMyPublishedSkillInstallState recognizes installed registry skills", () => {
  const inventory = {
    groups: [
      createManagedSkillGroup({
        id: "cloudflare-worker-connect",
        kind: "registry",
        packageName: "@alice/cloudflare-worker-connect",
        version: "0.0.2",
      }),
    ],
  }

  assert.deepEqual(
    resolveMyPublishedSkillInstallState(inventory, {
      packageName: "@alice/cloudflare-worker-connect",
      skillId: "cloudflare-worker-connect",
    }),
    {
      installed: true,
      installedVersion: "0.0.2",
      installState: "installed",
    },
  )
})

test("resolveMyPublishedSkillInstallState reports same-name local conflicts", () => {
  const inventory = {
    groups: [
      createManagedSkillGroup({
        id: "cloudflare-worker-connect",
        kind: "local",
      }),
    ],
  }

  assert.deepEqual(
    resolveMyPublishedSkillInstallState(inventory, {
      packageName: "@alice/cloudflare-worker-connect",
      skillId: "cloudflare-worker-connect",
    }),
    {
      conflictingSkill: {
        id: "cloudflare-worker-connect",
        installedHosts: 1,
        kind: "local",
        name: "cloudflare-worker-connect",
        totalHosts: 1,
      },
      installed: false,
      installState: "name-conflict",
    },
  )
})

test("resolveMyPublishedSkillInstallState leaves missing names installable", () => {
  assert.deepEqual(
    resolveMyPublishedSkillInstallState(
      {
        groups: [],
      },
      {
        packageName: "@alice/cloudflare-worker-connect",
        skillId: "cloudflare-worker-connect",
      },
    ),
    {
      installed: false,
      installState: "installable",
    },
  )
})

function createManagedSkillGroup(options: {
  id: string
  kind: ManagedSkillGroup["kind"]
  packageName?: string
  version?: string
}): ManagedSkillGroup {
  const host: ManagedSkillGroup["hosts"][number] = {
    agentId: "codex",
    agentName: "Codex",
    kind: options.kind,
    status: "installed",
  }
  if (options.packageName) {
    host.packageName = options.packageName
  }
  if (options.version) {
    host.version = options.version
  }

  const group: ManagedSkillGroup = {
    hosts: [host],
    id: options.id,
    isBuiltIn: false,
    kind: options.kind,
    name: options.id,
  }
  if (options.packageName) {
    group.packageName = options.packageName
  }
  if (options.version) {
    group.version = options.version
  }

  return group
}
