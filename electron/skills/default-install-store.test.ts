import assert from "node:assert/strict"
import { mkdtemp, readdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "vitest"
import {
  DefaultSkillInstallStore,
  createDefaultSkillKey,
  defaultSkillInstallSchemaVersion,
  emptyDefaultSkillInstallStore,
  readDefaultSkillInstallRecord,
  readDefaultSkillInstallStore,
  upsertDefaultSkillInstallRecord,
} from "./default-install-store.ts"
import { defaultRegistrySkillSetVersion } from "./default-registry-skills.ts"

test("DefaultSkillInstallStore round-trips records atomically", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-default-skills-"))
  const store = new DefaultSkillInstallStore(dir)
  const now = "2026-06-21T00:00:00.000Z"

  await store.write(
    upsertDefaultSkillInstallRecord(emptyDefaultSkillInstallStore(), {
      packageName: "@oomol/example",
      skillId: "example",
      status: "installed",
      updatedAt: now,
    }),
  )

  assert.deepEqual(await store.read(), {
    records: [
      {
        packageName: "@oomol/example",
        skillId: "example",
        status: "installed",
        updatedAt: now,
      },
    ],
    schemaVersion: defaultSkillInstallSchemaVersion,
    skillSetVersion: defaultRegistrySkillSetVersion,
  })
  assert.deepEqual(await readdir(path.join(dir, "skills")), ["default-install.json"])
})

test("upsertDefaultSkillInstallRecord replaces matching package and skill", () => {
  const initial = upsertDefaultSkillInstallRecord(emptyDefaultSkillInstallStore(), {
    packageName: "@oomol/example",
    skillId: "example",
    status: "failed",
    updatedAt: "first",
  })
  const next = upsertDefaultSkillInstallRecord(initial, {
    packageName: "@oomol/example",
    skillId: "example",
    status: "removed-by-user",
    updatedAt: "second",
  })

  assert.equal(next.records.length, 1)
  assert.equal(next.records[0]?.status, "removed-by-user")
  assert.equal(
    readDefaultSkillInstallRecord(next, { packageName: "@oomol/example", skillId: "example" })?.updatedAt,
    "second",
  )
})

test("readDefaultSkillInstallStore ignores unsupported records", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-default-skills-"))
  const file = path.join(dir, "default-install.json")
  await writeFile(
    file,
    JSON.stringify({
      schemaVersion: defaultSkillInstallSchemaVersion,
      skillSetVersion: defaultRegistrySkillSetVersion,
      records: [
        {
          packageName: "@oomol/example",
          skillId: "example",
          status: "installed",
          updatedAt: "now",
        },
        {
          packageName: "",
          skillId: "broken",
          status: "installed",
          updatedAt: "now",
        },
      ],
    }),
    "utf8",
  )

  const store = await readDefaultSkillInstallStore(file)

  assert.deepEqual(
    store.records.map((record) => createDefaultSkillKey(record)),
    ["@oomol/example\u0000example"],
  )
})

test("readDefaultSkillInstallStore returns empty store for missing file", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-default-skills-"))

  assert.deepEqual(await readDefaultSkillInstallStore(path.join(dir, "missing.json")), emptyDefaultSkillInstallStore())
})
