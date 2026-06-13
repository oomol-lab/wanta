import type { InstalledSkill, SkillManifestStore } from "./types.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import { manifestSchemaVersion } from "./constants.ts"
import { areManifestStoresEqual, readControlState, upsertManifestRecords } from "./manifest.ts"

const installedSkill: InstalledSkill = {
  agent: {
    cliCommands: ["agent"],
    homeRoot: ".agent",
    id: "agent",
    name: "Agent",
    ooCliAgentId: "agent",
  },
  hash: "hash-a",
  metadata: {
    kind: "registry",
    packageName: "@oomol/example",
    version: "1.0.0",
  },
  name: "example",
  path: "/agent/skills/example",
  sourcePath: "/oo/skills/registry/example",
}

test("upsertManifestRecords creates records for newly seen skills", () => {
  const store = upsertManifestRecords({ schemaVersion: manifestSchemaVersion, records: [] }, [installedSkill])

  assert.equal(store.records.length, 1)
  assert.equal(store.records[0]?.agentId, "agent")
  assert.equal(store.records[0]?.installedPath, "/agent/skills/example")
})

test("areManifestStoresEqual ignores scan timestamp churn", () => {
  const store = upsertManifestRecords({ schemaVersion: manifestSchemaVersion, records: [] }, [installedSkill])
  const nextStore: SkillManifestStore = {
    ...store,
    records: store.records.map((record) => ({ ...record, scannedAt: "later" })),
  }

  assert.equal(areManifestStoresEqual(store, nextStore), true)
})

test("readControlState compares source hash when available", () => {
  assert.equal(readControlState({ ...installedSkill, sourceHash: "hash-a" }, emptyStore), "controlled")
  assert.equal(readControlState({ ...installedSkill, sourceHash: "hash-b" }, emptyStore), "modified")
})

test("readControlState falls back to manifest record", () => {
  const store = upsertManifestRecords({ schemaVersion: manifestSchemaVersion, records: [] }, [installedSkill])

  assert.equal(readControlState(installedSkill, store), "controlled")
  assert.equal(readControlState({ ...installedSkill, hash: "changed" }, store), "modified")
  assert.equal(readControlState({ ...installedSkill, sourcePath: "/missing" }, store), "source-missing")
})

const emptyStore: SkillManifestStore = {
  schemaVersion: manifestSchemaVersion,
  records: [],
}
