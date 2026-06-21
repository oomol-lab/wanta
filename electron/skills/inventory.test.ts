import type { InstalledSkill, SkillManifestStore } from "./types.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import { manifestSchemaVersion } from "./constants.ts"
import { buildSummary, groupInstalledSkills } from "./inventory.ts"

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
      description: "Local workflow skill",
      kind: "local",
      version: "1.0.0",
    },
    name: "alpha",
    path: "/codex/skills/alpha",
    sourceHash: "hash-b",
    sourcePath: "/workspace/alpha",
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

test("groupInstalledSkills groups installed skills with agent coverage and no built-in seeding", () => {
  const groups = groupInstalledSkills(installedSkills, manifestStore, agents)
  const alpha = groups.find((group) => group.id === "alpha")
  const example = groups.find((group) => group.id === "example")

  assert.equal(alpha?.kind, "local")
  assert.equal(alpha?.description, "Local workflow skill")
  assert.equal(alpha?.hosts.length, 2)
  assert.equal(alpha?.externalHosts.length, 2)
  assert.equal(alpha?.runtimeHosts.length, 0)
  assert.equal(alpha?.hosts[0]?.controlState, "modified")
  assert.equal(example?.packageName, "@oomol/example")
  assert.equal(example?.icon, ":lucide:captions:")
  assert.equal(example?.description, "Example registry skill")
  assert.equal(example?.hosts[1]?.controlState, "controlled")
  // 只出现实际安装的 skill，不再用内置 skill id 预置任何分组。
  assert.deepEqual(
    groups.map((group) => group.id),
    ["alpha", "example"],
  )
})

test("buildSummary counts managed skills and attention hosts", () => {
  const groups = groupInstalledSkills(installedSkills, manifestStore, agents)
  const summary = buildSummary(groups)

  assert.equal(summary.managedSkills, 2)
  assert.equal(summary.modifiedHosts, 1)
  assert.equal(summary.needsAttention, 1)
  assert.equal(summary.localSkills, 1)
  assert.equal(summary.registrySkills, 1)
  assert.equal(summary.publishableSkills, 1)
  assert.deepEqual(
    summary.skills.map((skill) => skill.id),
    ["alpha", "example"],
  )
  assert.equal(summary.skills[1]?.modifiedHosts, 0)
  assert.equal(summary.skills[1]?.icon, ":lucide:captions:")
  assert.equal(summary.skills[1]?.sourceMissingHosts, 0)
  assert.equal(summary.skills[1]?.unknownHosts, 0)
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
    summary.skills.map((skill) => skill.id),
    ["mixed-skill"],
  )
  assert.equal(summary.skills[0]?.kind, "unknown")
})

test("buildSummary reports an empty inventory with no managed skills", () => {
  const summary = buildSummary(groupInstalledSkills([], manifestStore, []))

  assert.equal(summary.managedSkills, 0)
  assert.equal(summary.needsAttention, 0)
  assert.deepEqual(summary.skills, [])
})
