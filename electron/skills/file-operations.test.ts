import assert from "node:assert/strict"
import { access, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "vitest"
import { metadataFileName } from "./constants.ts"
import { removeSkillDirectoryIfSafe } from "./file-operations.ts"

async function exists(pathname: string): Promise<boolean> {
  try {
    await access(pathname)
    return true
  } catch {
    return false
  }
}

async function writeRegistrySkill(root: string, skillId: string, packageName: string): Promise<string> {
  const skillPath = path.join(root, skillId)
  await mkdir(skillPath, { recursive: true })
  await writeFile(path.join(skillPath, "SKILL.md"), `---\nname: ${skillId}\n---\n`, "utf8")
  await writeFile(
    path.join(skillPath, metadataFileName),
    JSON.stringify({
      kind: "registry",
      packageName,
      schemaVersion: 1,
      version: "1.0.0",
    }),
    "utf8",
  )
  return skillPath
}

test("removeSkillDirectoryIfSafe removes a matching registry skill directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-skill-remove-"))
  const skillPath = await writeRegistrySkill(root, "example", "@oomol/example")

  const result = await removeSkillDirectoryIfSafe({
    allowedRoots: [root],
    packageName: "@oomol/example",
    path: skillPath,
    skillId: "example",
  })

  assert.equal(result.status, "removed")
  assert.equal(await exists(skillPath), false)
})

test("removeSkillDirectoryIfSafe rejects paths outside allowed roots", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-skill-remove-"))
  const outside = await mkdtemp(path.join(os.tmpdir(), "wanta-skill-outside-"))
  const skillPath = await writeRegistrySkill(outside, "example", "@oomol/example")

  const result = await removeSkillDirectoryIfSafe({
    allowedRoots: [root],
    packageName: "@oomol/example",
    path: skillPath,
    skillId: "example",
  })

  assert.equal(result.status, "skipped")
  assert.equal(result.reason, "outside-allowed-roots")
  assert.equal(await exists(skillPath), true)
})

test("removeSkillDirectoryIfSafe rejects basename mismatches", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-skill-remove-"))
  const skillPath = await writeRegistrySkill(root, "different", "@oomol/example")

  const result = await removeSkillDirectoryIfSafe({
    allowedRoots: [root],
    packageName: "@oomol/example",
    path: skillPath,
    skillId: "example",
  })

  assert.equal(result.status, "skipped")
  assert.equal(result.reason, "basename-mismatch")
  assert.equal(await exists(skillPath), true)
})

test("removeSkillDirectoryIfSafe rejects registry package mismatches", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-skill-remove-"))
  const skillPath = await writeRegistrySkill(root, "example", "@oomol/example")

  const result = await removeSkillDirectoryIfSafe({
    allowedRoots: [root],
    packageName: "@other/example",
    path: skillPath,
    skillId: "example",
  })

  assert.equal(result.status, "skipped")
  assert.equal(result.reason, "package-name-mismatch")
  assert.equal(await exists(skillPath), true)
})

test("removeSkillDirectoryIfSafe rejects missing paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-skill-remove-"))
  const skillPath = path.join(root, "example")

  const result = await removeSkillDirectoryIfSafe({
    allowedRoots: [root],
    packageName: "@oomol/example",
    path: skillPath,
    skillId: "example",
  })

  assert.equal(result.status, "skipped")
  assert.equal(result.reason, "missing")
})

test("removeSkillDirectoryIfSafe rejects non-directory targets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-skill-remove-"))
  const skillPath = path.join(root, "example")
  await writeFile(skillPath, "not a directory", "utf8")

  const result = await removeSkillDirectoryIfSafe({
    allowedRoots: [root],
    packageName: "@oomol/example",
    path: skillPath,
    skillId: "example",
  })

  assert.equal(result.status, "skipped")
  assert.equal(result.reason, "not-directory")
  assert.equal(await exists(skillPath), true)
})

test("removeSkillDirectoryIfSafe rejects directories without skill definitions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-skill-remove-"))
  const skillPath = path.join(root, "example")
  await mkdir(skillPath, { recursive: true })

  const result = await removeSkillDirectoryIfSafe({
    allowedRoots: [root],
    path: skillPath,
    skillId: "example",
  })

  assert.equal(result.status, "skipped")
  assert.equal(result.reason, "skill-definition-missing")
  assert.equal(await exists(skillPath), true)
})

test("removeSkillDirectoryIfSafe rejects registry package checks when metadata is missing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-skill-remove-"))
  const skillPath = path.join(root, "example")
  await mkdir(skillPath, { recursive: true })
  await writeFile(path.join(skillPath, "SKILL.md"), "---\nname: example\n---\n", "utf8")

  const result = await removeSkillDirectoryIfSafe({
    allowedRoots: [root],
    packageName: "@oomol/example",
    path: skillPath,
    skillId: "example",
  })

  assert.equal(result.status, "skipped")
  assert.equal(result.reason, "package-name-mismatch")
  assert.equal(await exists(skillPath), true)
})

test("removeSkillDirectoryIfSafe rejects symlinks pointing outside allowed roots", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-skill-remove-"))
  const outside = await mkdtemp(path.join(os.tmpdir(), "wanta-skill-outside-"))
  const outsideSkillPath = await writeRegistrySkill(outside, "example", "@oomol/example")
  const linkPath = path.join(root, "example")
  await symlink(outsideSkillPath, linkPath)

  const result = await removeSkillDirectoryIfSafe({
    allowedRoots: [root],
    packageName: "@oomol/example",
    path: linkPath,
    skillId: "example",
  })

  assert.equal(result.status, "skipped")
  assert.equal(result.reason, "symlink-target-outside-allowed-roots")
  assert.equal(await exists(linkPath), true)
  assert.equal(await exists(outsideSkillPath), true)
})
