import assert from "node:assert/strict"
import { mkdtemp, readdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "vitest"
import {
  RemovedSkillStore,
  createRemovedSkillKey,
  emptyRemovedSkillStore,
  isSkillRemovedByUser,
  readRemovedSkillStore,
  removeRemovedSkillRecord,
  removedSkillStoreSchemaVersion,
  upsertRemovedSkillRecord,
} from "./removed-store.ts"

test("RemovedSkillStore round-trips records atomically", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-removed-skills-"))
  const store = new RemovedSkillStore(dir)
  const removedAt = "2026-07-05T00:00:00.000Z"

  await store.write(
    upsertRemovedSkillRecord(emptyRemovedSkillStore(), {
      packageName: "@oomol/example",
      removedAt,
      scope: "local-machine",
      skillId: "example",
    }),
  )

  assert.deepEqual(await store.read(), {
    records: [
      {
        packageName: "@oomol/example",
        removedAt,
        scope: "local-machine",
        skillId: "example",
      },
    ],
    schemaVersion: removedSkillStoreSchemaVersion,
  })
  assert.deepEqual(await readdir(path.join(dir, "skills")), ["removed.json"])
})

test("upsertRemovedSkillRecord replaces matching package and skill", () => {
  const first = upsertRemovedSkillRecord(emptyRemovedSkillStore(), {
    packageName: "@oomol/example",
    removedAt: "first",
    scope: "local-machine",
    skillId: "example",
  })
  const next = upsertRemovedSkillRecord(first, {
    packageName: "@oomol/example",
    removedAt: "second",
    scope: "local-machine",
    skillId: "example",
  })

  assert.equal(next.records.length, 1)
  assert.equal(next.records[0]?.removedAt, "second")
  assert.equal(createRemovedSkillKey(next.records[0]!), "@oomol/example\u0000example")
})

test("isSkillRemovedByUser matches package-specific and skill-wide records", () => {
  const packageSpecific = upsertRemovedSkillRecord(emptyRemovedSkillStore(), {
    packageName: "@oomol/example",
    removedAt: "now",
    scope: "local-machine",
    skillId: "example",
  })
  const skillWide = upsertRemovedSkillRecord(emptyRemovedSkillStore(), {
    removedAt: "now",
    scope: "local-machine",
    skillId: "example",
  })

  assert.equal(isSkillRemovedByUser(packageSpecific, { packageName: "@oomol/example", skillId: "example" }), true)
  assert.equal(isSkillRemovedByUser(packageSpecific, { packageName: "@other/example", skillId: "example" }), false)
  assert.equal(isSkillRemovedByUser(skillWide, { packageName: "@other/example", skillId: "example" }), true)
})

test("removeRemovedSkillRecord clears matching records for reinstall", () => {
  const store = upsertRemovedSkillRecord(emptyRemovedSkillStore(), {
    packageName: "@oomol/example",
    removedAt: "now",
    scope: "local-machine",
    skillId: "example",
  })

  assert.deepEqual(removeRemovedSkillRecord(store, { packageName: "@oomol/example", skillId: "example" }).records, [])
})

test("readRemovedSkillStore ignores unsupported records", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-removed-skills-"))
  const file = path.join(dir, "removed.json")
  await writeFile(
    file,
    JSON.stringify({
      records: [
        {
          packageName: "@oomol/example",
          removedAt: "now",
          scope: "local-machine",
          skillId: "example",
        },
        {
          removedAt: "now",
          scope: "other",
          skillId: "broken",
        },
      ],
      schemaVersion: removedSkillStoreSchemaVersion,
    }),
    "utf8",
  )

  const store = await readRemovedSkillStore(file)

  assert.deepEqual(
    store.records.map((record) => createRemovedSkillKey(record)),
    ["@oomol/example\u0000example"],
  )
})
