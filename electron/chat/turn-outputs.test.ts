import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "vitest"
import { ArtifactBundleStore } from "./artifact-bundles.ts"
import { publicTurnOutputRecord, recordTurnOutput, TurnOutputStore } from "./turn-outputs.ts"

test("TurnOutputStore round trips records and strips diffs from public records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-turn-outputs-"))
  try {
    const store = new TurnOutputStore(root)
    const records = new Map()
    recordTurnOutput(records, {
      sessionId: "session-1",
      messageId: "message-1",
      createdAt: 1,
      completedAt: 2,
      processRoot: "/tmp/process",
      files: [
        {
          path: "/tmp/process/create.js",
          name: "create.js",
          role: "process",
          changeKind: "added",
          mime: "text/plain",
          additions: 1,
          deletions: 0,
          diff: {
            kind: "text",
            path: "/tmp/process/create.js",
            mime: "text/plain",
            additions: 1,
            deletions: 0,
            patch: "+console.log(1)",
          },
        },
      ],
      summary: { processFileCount: 1, changedFileCount: 0, additions: 1, deletions: 0 },
    })

    await store.write(records)
    const restored = await store.read()
    const record = restored.get("session-1")?.get("message-1")

    assert.equal(record?.files[0]?.diff.patch, "+console.log(1)")
    assert.deepEqual(publicTurnOutputRecord(record as NonNullable<typeof record>).files[0], {
      path: "/tmp/process/create.js",
      name: "create.js",
      role: "process",
      changeKind: "added",
      mime: "text/plain",
      additions: 1,
      deletions: 0,
    })
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("TurnOutputStore removes records for a deleted session", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-turn-outputs-"))
  try {
    const store = new TurnOutputStore(root)
    const records = new Map()
    const baseRecord = {
      createdAt: 1,
      completedAt: 2,
      files: [],
      summary: { processFileCount: 0, changedFileCount: 0, additions: 0, deletions: 0 },
    }
    recordTurnOutput(records, {
      ...baseRecord,
      sessionId: "session-1",
      messageId: "message-1",
    })
    recordTurnOutput(records, {
      ...baseRecord,
      sessionId: "session-2",
      messageId: "message-2",
    })

    await store.write(records)
    await store.removeSession("session-1")
    await store.record({
      ...baseRecord,
      sessionId: "session-3",
      messageId: "message-3",
    })

    const next = await new TurnOutputStore(root).read()
    assert.equal(next.has("session-1"), false)
    assert.equal(next.get("session-2")?.has("message-2"), true)
    assert.equal(next.get("session-3")?.has("message-3"), true)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("TurnOutputStore migrates legacy artifact files into ArtifactBundleStore", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-turn-output-migration-"))
  const artifactRoot = path.join(root, "legacy-artifacts")
  try {
    await mkdir(artifactRoot)
    const reportPath = path.join(artifactRoot, "report.pdf")
    await writeFile(reportPath, "pdf")
    await writeFile(
      path.join(root, "turn-outputs.json"),
      JSON.stringify({
        version: 1,
        sessions: {
          "session-1": {
            "message-1": {
              sessionId: "session-1",
              messageId: "message-1",
              artifactRoot,
              createdAt: 1,
              completedAt: 2,
              files: [
                {
                  path: reportPath,
                  name: "report.pdf",
                  role: "artifact",
                  changeKind: "added",
                  mime: "application/pdf",
                  additions: 0,
                  deletions: 0,
                  diff: {
                    kind: "binary",
                    path: reportPath,
                    mime: "application/pdf",
                    additions: 0,
                    deletions: 0,
                  },
                },
              ],
              summary: { artifactCount: 1, processFileCount: 0, changedFileCount: 0, additions: 0, deletions: 0 },
            },
          },
        },
      }),
    )
    const artifactStore = new ArtifactBundleStore(root)
    const turnStore = new TurnOutputStore(root, artifactStore)

    const records = await turnStore.read()
    const bundle = (await artifactStore.read()).get("session-1")?.get("message-1")

    assert.deepEqual(records.get("session-1")?.get("message-1")?.files, [])
    assert.equal(bundle?.rootPath, artifactRoot)
    assert.equal(bundle?.items[0]?.path, reportPath)
    assert.equal((await readFile(path.join(root, "turn-outputs.json"), "utf8")).includes("artifactRoot"), false)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
