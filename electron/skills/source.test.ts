import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "vitest"
import { metadataFileName } from "./constants.ts"
import { readRegistrySkillSourceCandidates, resolveUsableRegistrySkillSourcePath } from "./source.ts"

async function writeRegistrySkill(rootPath: string, packageName: string): Promise<void> {
  await mkdir(rootPath, { recursive: true })
  await Promise.all([
    writeFile(path.join(rootPath, "SKILL.md"), "# Demo\n", "utf8"),
    writeFile(
      path.join(rootPath, metadataFileName),
      JSON.stringify({ kind: "registry", packageName, schemaVersion: 1, version: "1.0.0" }),
      "utf8",
    ),
  ])
}

test("readRegistrySkillSourceCandidates keeps canonical store as an explicit fallback", async () => {
  const homePath = await mkdtemp(path.join(os.tmpdir(), "wanta-skill-source-home-"))
  const cacheRoot = path.join(homePath, "wanta", "skills")

  try {
    assert.deepEqual(
      readRegistrySkillSourceCandidates({
        cacheSkillStoreRoot: cacheRoot,
        homeDirectory: homePath,
        includeCanonicalStore: true,
        platform: "darwin",
        skillId: " gpt-image-2 ",
      }),
      [
        path.join(cacheRoot, "registry", "gpt-image-2"),
        path.join(homePath, "Library", "Application Support", "oo", "skills", "registry", "gpt-image-2"),
      ],
    )
  } finally {
    await rm(homePath, { force: true, recursive: true })
  }
})

test("resolveUsableRegistrySkillSourcePath prefers Wanta cache over canonical oo store", async () => {
  const homePath = await mkdtemp(path.join(os.tmpdir(), "wanta-skill-source-prefer-"))
  const cacheRoot = path.join(homePath, "wanta", "skills")
  const isolatedSourcePath = path.join(cacheRoot, "registry", "gpt-image-2")
  const canonicalSourcePath = path.join(
    homePath,
    "Library",
    "Application Support",
    "oo",
    "skills",
    "registry",
    "gpt-image-2",
  )

  try {
    await Promise.all([
      writeRegistrySkill(isolatedSourcePath, "@alice/gpt-image-2"),
      writeRegistrySkill(canonicalSourcePath, "@alice/gpt-image-2"),
    ])

    assert.equal(
      await resolveUsableRegistrySkillSourcePath({
        cacheSkillStoreRoot: cacheRoot,
        homeDirectory: homePath,
        includeCanonicalStore: true,
        packageName: "@alice/gpt-image-2",
        platform: "darwin",
        skillId: "gpt-image-2",
      }),
      isolatedSourcePath,
    )
  } finally {
    await rm(homePath, { force: true, recursive: true })
  }
})

test("resolveUsableRegistrySkillSourcePath rejects canonical package mismatches", async () => {
  const homePath = await mkdtemp(path.join(os.tmpdir(), "wanta-skill-source-mismatch-"))
  const cacheRoot = path.join(homePath, "wanta", "skills")
  const canonicalSourcePath = path.join(
    homePath,
    "Library",
    "Application Support",
    "oo",
    "skills",
    "registry",
    "gpt-image-2",
  )

  try {
    await writeRegistrySkill(canonicalSourcePath, "@bob/gpt-image-2")

    assert.equal(
      await resolveUsableRegistrySkillSourcePath({
        cacheSkillStoreRoot: cacheRoot,
        homeDirectory: homePath,
        includeCanonicalStore: true,
        packageName: "@alice/gpt-image-2",
        platform: "darwin",
        skillId: "gpt-image-2",
      }),
      undefined,
    )
  } finally {
    await rm(homePath, { force: true, recursive: true })
  }
})
