import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "vitest"
import { manifestSchemaVersion } from "./constants.ts"
import { hashTextFiles } from "./hash.ts"
import { readManifestStore, writeManifestStore } from "./manifest.ts"
import { reconcileExternalRuntimeSkillMirrors } from "./runtime-mirrors.ts"

test("reconcileExternalRuntimeSkillMirrors removes inactive managed mirrors", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-runtime-mirrors-"))
  try {
    const externalRoot = path.join(root, "codex", "skills")
    const sharedRoot = path.join(root, "wanta", "skills")
    const targetPath = path.join(sharedRoot, "example")
    const manifestPath = path.join(root, "manifest.json")
    await mkdir(targetPath, { recursive: true })
    await writeFile(path.join(targetPath, "SKILL.md"), "# Example\n")
    const hash = await hashTextFiles(targetPath)
    assert.ok(hash)
    await writeManifestStore(manifestPath, {
      schemaVersion: manifestSchemaVersion,
      records: [
        {
          agentId: "wanta",
          hash,
          installedPath: targetPath,
          scannedAt: new Date().toISOString(),
          skillName: "example",
          sourcePath: path.join(externalRoot, "example"),
        },
      ],
    })

    const result = await reconcileExternalRuntimeSkillMirrors({
      activeTargetPaths: new Set(),
      externalSkillRoots: [externalRoot],
      manifestPath,
      sharedSkillRoot: sharedRoot,
    })

    assert.equal(result.changed, true)
    assert.deepEqual(result.skipped, [])
    assert.equal((await readManifestStore(manifestPath)).records.length, 0)
    await assert.rejects(() => readFile(path.join(targetPath, "SKILL.md")))
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("reconcileExternalRuntimeSkillMirrors preserves modified and active targets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-runtime-mirrors-preserve-"))
  try {
    const externalRoot = path.join(root, "codex", "skills")
    const sharedRoot = path.join(root, "wanta", "skills")
    const modifiedTarget = path.join(sharedRoot, "modified")
    const activeTarget = path.join(sharedRoot, "active")
    const unscannedSource = path.join(externalRoot, "temporarily-unscanned")
    const unscannedTarget = path.join(sharedRoot, "temporarily-unscanned")
    const manifestPath = path.join(root, "manifest.json")
    await mkdir(modifiedTarget, { recursive: true })
    await mkdir(activeTarget, { recursive: true })
    await mkdir(unscannedSource, { recursive: true })
    await mkdir(unscannedTarget, { recursive: true })
    await writeFile(path.join(modifiedTarget, "SKILL.md"), "# Original\n")
    await writeFile(path.join(activeTarget, "SKILL.md"), "# Active\n")
    await writeFile(path.join(unscannedSource, "SKILL.md"), "# Source still exists\n")
    await writeFile(path.join(unscannedTarget, "SKILL.md"), "# Source still exists\n")
    const modifiedHash = await hashTextFiles(modifiedTarget)
    const activeHash = await hashTextFiles(activeTarget)
    const unscannedHash = await hashTextFiles(unscannedTarget)
    assert.ok(modifiedHash)
    assert.ok(activeHash)
    assert.ok(unscannedHash)
    await writeManifestStore(manifestPath, {
      schemaVersion: manifestSchemaVersion,
      records: [
        {
          agentId: "wanta",
          hash: modifiedHash,
          installedPath: modifiedTarget,
          scannedAt: new Date().toISOString(),
          skillName: "modified",
          sourcePath: path.join(externalRoot, "modified"),
        },
        {
          agentId: "wanta",
          hash: activeHash,
          installedPath: activeTarget,
          scannedAt: new Date().toISOString(),
          skillName: "active",
          sourcePath: path.join(externalRoot, "active"),
        },
        {
          agentId: "wanta",
          hash: unscannedHash,
          installedPath: unscannedTarget,
          scannedAt: new Date().toISOString(),
          skillName: "temporarily-unscanned",
          sourcePath: unscannedSource,
        },
      ],
    })
    await writeFile(path.join(modifiedTarget, "SKILL.md"), "# User modified\n")

    const result = await reconcileExternalRuntimeSkillMirrors({
      activeTargetPaths: new Set([activeTarget]),
      externalSkillRoots: [externalRoot],
      manifestPath,
      sharedSkillRoot: sharedRoot,
    })

    assert.equal(result.changed, true)
    assert.equal(await readFile(path.join(modifiedTarget, "SKILL.md"), "utf8"), "# User modified\n")
    assert.equal(await readFile(path.join(activeTarget, "SKILL.md"), "utf8"), "# Active\n")
    assert.equal(await readFile(path.join(unscannedTarget, "SKILL.md"), "utf8"), "# Source still exists\n")
    assert.deepEqual(
      (await readManifestStore(manifestPath)).records.map((record) => record.skillName),
      ["active", "temporarily-unscanned"],
    )
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
