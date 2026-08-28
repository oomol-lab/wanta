import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { detectOoSkillCommands, renderOoUpgradeMarkdown } from "./oo-upgrade-review-core.ts"

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
      { availability: "enabled", command: "oo search goal", operation: "capability.search" },
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
