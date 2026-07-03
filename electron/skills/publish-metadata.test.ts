import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "vitest"
import {
  createDefaultSkillPackageName,
  ensureSkillPublishMetadata,
  ensureSkillPublishMetadataContent,
} from "./publish-metadata.ts"

test("createDefaultSkillPackageName creates a scoped package from account and skill names", () => {
  assert.equal(createDefaultSkillPackageName("Shaun", "Baseline UI"), "@shaun/baseline-ui")
  assert.equal(createDefaultSkillPackageName("alice.dev", "demo_skill"), "@alice.dev/demo_skill")
})

test("ensureSkillPublishMetadataContent adds packageName and version under metadata", () => {
  const result = ensureSkillPublishMetadataContent(
    [
      "---",
      "name: baseline-ui",
      "description: Demo",
      "metadata:",
      "  icon: ':lucide:wrench:'",
      "  title: Baseline Ui",
      "---",
      "",
      "# Baseline UI",
      "",
    ].join("\n"),
    { accountName: "Shaun", fallbackSkillName: "baseline-ui" },
  )

  assert.equal(result.packageName, "@shaun/baseline-ui")
  assert.equal(result.version, "0.0.1")
  assert.equal(result.updated, true)
  assert.match(
    result.content,
    /metadata:\n  icon: ':lucide:wrench:'\n  title: Baseline Ui\n  packageName: '@shaun\/baseline-ui'\n  version: 0\.0\.1/,
  )
})

test("ensureSkillPublishMetadataContent keeps existing publish metadata for the current account", () => {
  const content = [
    "---",
    "name: demo",
    "metadata:",
    "  packageName: '@shaun/demo'",
    "  version: 0.2.0",
    "---",
    "# Demo",
    "",
  ].join("\n")

  assert.deepEqual(ensureSkillPublishMetadataContent(content, { accountName: "Shaun", fallbackSkillName: "demo" }), {
    content,
    packageName: "@shaun/demo",
    updated: false,
    version: "0.2.0",
  })
})

test("ensureSkillPublishMetadataContent rewrites a foreign package scope to the current account", () => {
  const result = ensureSkillPublishMetadataContent(
    [
      "---",
      "name: mineru-document-extraction",
      "metadata:",
      "  packageName: '@shaun/mineru-document-extraction'",
      "  version: 0.0.1",
      "---",
      "# MinerU",
      "",
    ].join("\n"),
    { accountName: "alwaysmavs", fallbackSkillName: "mineru-document-extraction" },
  )

  assert.equal(result.packageName, "@alwaysmavs/mineru-document-extraction")
  assert.equal(result.updated, true)
  assert.match(result.content, /packageName: '@alwaysmavs\/mineru-document-extraction'/)
})

test("ensureSkillPublishMetadataContent can use an explicit registry package scope", () => {
  const result = ensureSkillPublishMetadataContent(
    [
      "---",
      "name: guizang-ppt-skill",
      "metadata:",
      "  packageName: '@shaun/guizang-ppt-skill'",
      "  version: 0.0.1",
      "---",
      "# PPT",
      "",
    ].join("\n"),
    { accountName: "Shaun", fallbackSkillName: "guizang-ppt-skill", packageScope: "@alwaysmavs" },
  )

  assert.equal(result.packageName, "@alwaysmavs/guizang-ppt-skill")
  assert.equal(result.updated, true)
})

test("ensureSkillPublishMetadata writes SKILL.md metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-skill-publish-"))
  const skillPath = path.join(root, "demo")
  await mkdir(skillPath, { recursive: true })
  await writeFile(
    path.join(skillPath, "SKILL.md"),
    ["---", "name: demo", "metadata:", "  title: Demo", "---", "# Demo", ""].join("\n"),
    "utf8",
  )

  const result = await ensureSkillPublishMetadata({ accountName: "Shaun", skillPath })
  const content = await readFile(path.join(skillPath, "SKILL.md"), "utf8")

  assert.deepEqual(result, {
    packageName: "@shaun/demo",
    updated: true,
    version: "0.0.1",
  })
  assert.match(content, /packageName: '@shaun\/demo'/)
})
