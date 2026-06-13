import type { ManagedSkillGroup } from "./common.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import { buildSkillRepairPlan } from "./repair-plan.ts"

const groups: ManagedSkillGroup[] = [
  {
    hosts: [
      {
        agentId: "codex",
        agentName: "Codex",
        controlState: "modified",
        path: "/agent/codex/example",
        sourcePath: "/source/example",
        status: "installed",
      },
      {
        agentId: "claude",
        agentName: "Claude Code",
        controlState: "controlled",
        path: "/agent/claude/example",
        sourcePath: "/source/example",
        status: "installed",
      },
      {
        agentId: "hermes",
        agentName: "Hermes",
        controlState: "source-missing",
        path: "/agent/hermes/example",
        sourcePath: "/source/example",
        status: "installed",
      },
    ],
    id: "example",
    isBuiltIn: false,
    kind: "registry",
    name: "example",
    packageName: "@oomol/example",
    version: "1.0.0",
  },
]

test("buildSkillRepairPlan creates destructive reset plan for modified copies", () => {
  const plan = buildSkillRepairPlan(groups, {
    kind: "reset",
    skillId: "example",
  })

  assert.equal(plan.status, "ready")
  assert.equal(plan.isDestructive, true)
  assert.equal(plan.requiresConfirmation, true)
  assert.deepEqual(
    plan.targets.map((target) => target.agentId),
    ["codex"],
  )
})

test("buildSkillRepairPlan can target a single agent", () => {
  const plan = buildSkillRepairPlan(groups, {
    agentId: "claude",
    kind: "reset",
    skillId: "example",
  })

  assert.equal(plan.status, "not-needed")
  assert.equal(plan.targets.length, 0)
})

test("buildSkillRepairPlan creates source restore plan for source-missing copies", () => {
  const plan = buildSkillRepairPlan(groups, {
    kind: "restore-source",
    skillId: "example",
  })

  assert.equal(plan.status, "ready")
  assert.equal(plan.isDestructive, false)
  assert.equal(plan.requiresConfirmation, true)
  assert.equal(plan.targets[0]?.agentId, "hermes")
})

test("buildSkillRepairPlan reports missing skills", () => {
  const plan = buildSkillRepairPlan(groups, {
    kind: "reset",
    skillId: "missing",
  })

  assert.equal(plan.status, "not-found")
  assert.equal(plan.targets.length, 0)
})
