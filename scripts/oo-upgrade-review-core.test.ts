import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import {
  detectOoSkillCommands,
  requiredOperationsForCommands,
  renderOoUpgradeMarkdown,
  unknownRequiredOperations,
  updateOoCliVersionSource,
} from "./oo-upgrade-review-core.ts"

test("detects reviewed and missing OO command domains from exported Skill text", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-oo-upgrade-review-"))
  try {
    await mkdir(path.join(root, "oo", "references"), { recursive: true })
    await writeFile(
      path.join(root, "oo", "SKILL.md"),
      "Run `oo search goal --json`, `oo connector run service`, and `oo future command`.",
    )
    const findings = await detectOoSkillCommands(root, ["SKILL.md"])
    expect(findings).toEqual([
      { availability: "enabled", command: "oo connector run", operation: "connector.run" },
      { availability: "missing", command: "oo future command", operation: "unrecognized" },
      { availability: "enabled", command: "oo search", operation: "capability.search" },
    ])
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("distinguishes granular Flow command domains", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-oo-upgrade-flow-"))
  try {
    await mkdir(path.join(root, "oo"), { recursive: true })
    await writeFile(
      path.join(root, "oo", "SKILL.md"),
      "`oo flow project current --json`\n`oo flow inspect demo --project project-a --json`\n`oo flow delete demo --yes`\n",
    )
    await expect(detectOoSkillCommands(root, ["SKILL.md"])).resolves.toEqual([
      { availability: "planned", command: "oo flow", operation: "flow" },
      { availability: "enabled", command: "oo flow inspect", operation: "flow.inspect" },
      { availability: "enabled", command: "oo flow project current", operation: "flow.project.current" },
    ])
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("renders a reviewable Markdown report", () => {
  const markdown = renderOoUpgradeMarkdown({
    actualVersion: "1.7.7",
    candidateVersion: "1.7.8",
    files: { added: ["references/new.md"], changed: ["SKILL.md"], removed: [] },
    commands: [{ availability: "planned", command: "oo file download", operation: "file.download" }],
  })
  expect(markdown).toContain("OOCLI 1.7.7 → 1.7.8")
  expect(markdown).toContain("references/new.md")
  expect(markdown).toContain("`file.download`")
})

test("rejects retained required operations that no longer exist in the contract", () => {
  expect(unknownRequiredOperations(["connector.run", "removed.operation"], new Set(["connector.run"]))).toEqual([
    "removed.operation",
  ])
})

test("handles a capability-only upgrade without forcing an OOCLI version change", () => {
  const source = 'export const OO_CLI_VERSION = "1.7.7"\n'
  expect(updateOoCliVersionSource(source, "1.7.7", "1.7.7")).toBe(source)
  expect(updateOoCliVersionSource(source, "1.7.7", "1.7.8")).toContain('OO_CLI_VERSION = "1.7.8"')
})

test("rebuilds required operations from the candidate instead of retaining history", () => {
  expect(
    requiredOperationsForCommands([
      { availability: "enabled", command: "oo search", operation: "capability.search" },
      { availability: "missing", command: "oo removed", operation: "unrecognized" },
    ]),
  ).toEqual(["capability.search"])
})
