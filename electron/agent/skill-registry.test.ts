import { mkdir, symlink, writeFile } from "node:fs/promises"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, expect, test } from "vitest"
import { HostCapabilityKernel } from "./host-capability.ts"
import { createSkillHostCapability, SKILL_SNAPSHOT_BINDING } from "./skill-host-capability.ts"
import { listSkillSnapshot, readSkillSnapshotFile, SkillRegistry } from "./skill-registry.ts"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

test("SkillRegistry creates a deterministic, precedence-aware turn snapshot", async () => {
  const root = await temporaryRoot()
  const primary = path.join(root, "primary")
  const fallback = path.join(root, "fallback")
  await writeSkill(primary, "alpha", "Primary", "primary description")
  await writeSkill(fallback, "alpha", "Fallback", "fallback description")
  await writeSkill(fallback, "beta", "Beta", "beta description")

  const snapshot = await new SkillRegistry([primary, fallback]).snapshot()

  expect(listSkillSnapshot(snapshot)).toEqual([
    {
      description: "primary description",
      id: "alpha",
      name: "Primary",
      source: { id: "legacy-0", kind: "managed" },
    },
    {
      description: "beta description",
      id: "beta",
      name: "Beta",
      source: { id: "legacy-1", kind: "managed" },
    },
  ])
  expect(snapshot.diagnostics).toContainEqual({
    code: "duplicate_id",
    severity: "warning",
    skillId: "alpha",
    sourceId: "legacy-1",
  })
})

test("skill host tools load complete instructions and keep referenced files inside the snapshot root", async () => {
  const root = await temporaryRoot()
  await writeSkill(root, "alpha", "Alpha", "description")
  await mkdir(path.join(root, "alpha", "references"))
  await writeFile(path.join(root, "alpha", "references", "guide.md"), "full guide", "utf8")
  await writeFile(path.join(root, "secret.txt"), "secret", "utf8")
  await symlink(path.join(root, "secret.txt"), path.join(root, "alpha", "references", "escape.md"))
  const snapshot = await new SkillRegistry([root]).snapshot()
  const kernel = new HostCapabilityKernel()
  kernel.register(createSkillHostCapability())
  const context = {
    bindings: { [SKILL_SNAPSHOT_BINDING]: snapshot },
    sessionId: "session-1",
  }

  const loadedSkill = (await kernel.execute("skills", "load_skill", context, { skillId: "alpha" })).text
  expect(loadedSkill).toContain("<wanta_execution_policy>")
  expect(loadedSkill).toContain("follow the Skill's oo connector schema/run workflow")
  expect(loadedSkill).toContain("Wanta's managed guard")
  expect(loadedSkill).toContain("# Alpha")
  expect(
    (await kernel.execute("skills", "read_skill_file", context, { skillId: "alpha", path: "references/guide.md" }))
      .text,
  ).toBe("full guide")
  await expect(
    kernel.execute("skills", "read_skill_file", context, { skillId: "alpha", path: "references/escape.md" }),
  ).rejects.toThrow(/escapes the skill root/)
})

test("a turn snapshot does not gain skills installed after issuance", async () => {
  const root = await temporaryRoot()
  await writeSkill(root, "alpha", "Alpha", "description")
  const registry = new SkillRegistry([root])
  const first = await registry.snapshot()
  await writeSkill(root, "beta", "Beta", "description")

  expect(first.entries.has("beta")).toBe(false)
  expect((await registry.snapshot()).entries.has("beta")).toBe(true)
  await expect(readSkillSnapshotFile(first, "beta")).rejects.toThrow(/not present in this turn/)
})

test("SkillRegistry labels explicit sources, reports portability issues, and rejects embedded credentials", async () => {
  const root = await temporaryRoot()
  await writeSkill(root, "portable", "Portable", "description")
  await writeFile(
    path.join(root, "portable", "SKILL.md"),
    "---\nname: Portable\ndescription: description\n---\nRead [guide](references/missing.md) from /Users/alice/project and .opencode/tools.\n",
    "utf8",
  )
  await writeSkill(root, "unsafe", "Unsafe", "description")
  await writeFile(
    path.join(root, "unsafe", "SKILL.md"),
    "---\nname: Unsafe\ndescription: description\n---\napi_key = 'abcdefghijklmnop1234'\n",
    "utf8",
  )

  const snapshot = await new SkillRegistry([{ id: "user-skills", kind: "user", root }]).snapshot()

  expect(snapshot.entries.get("portable")?.source).toEqual({ id: "user-skills", kind: "user" })
  expect(snapshot.entries.has("unsafe")).toBe(false)
  expect(snapshot.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
    expect.arrayContaining(["hardcoded_agent_path", "hardcoded_workspace", "missing_reference", "embedded_secret"]),
  )
})

test("SkillRegistry preserves source precedence when the first duplicate fails linting", async () => {
  const root = await temporaryRoot()
  const primary = path.join(root, "primary")
  const fallback = path.join(root, "fallback")
  await writeSkill(primary, "duplicate", "Unsafe primary", "description")
  await writeFile(
    path.join(primary, "duplicate", "SKILL.md"),
    "---\nname: Unsafe primary\ndescription: description\n---\napi_key = 'abcdefghijklmnop1234'\n",
    "utf8",
  )
  await writeSkill(fallback, "duplicate", "Fallback", "description")

  const snapshot = await new SkillRegistry([primary, fallback]).snapshot()

  expect(snapshot.entries.has("duplicate")).toBe(false)
  expect(snapshot.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "embedded_secret", sourceId: "legacy-0" }),
      expect.objectContaining({ code: "duplicate_id", sourceId: "legacy-1" }),
    ]),
  )
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "wanta-skills-"))
  temporaryDirectories.push(root)
  return root
}

async function writeSkill(root: string, id: string, name: string, description: string): Promise<void> {
  const directory = path.join(root, id)
  await mkdir(directory, { recursive: true })
  await writeFile(
    path.join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\nComplete instructions.\n`,
    "utf8",
  )
}
