import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "vitest"
import { configureDiagnosticsLog, flushDiagnosticsLog, logDiagnostic } from "./diagnostics-log.ts"

test("diagnostics logging tolerates circular, deep, and unreadable values", async () => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "wanta-diagnostics-"))
  const logPath = path.join(tempDirectory, "diagnostics.log")
  const circular: Record<string, unknown> = { label: "root" }
  circular.self = circular
  const causedError = new Error("outer")
  causedError.cause = causedError
  const unreadable: Record<string, unknown> = { visible: true }
  Object.defineProperty(unreadable, "secret", {
    enumerable: true,
    get: () => {
      throw new Error("getter failed")
    },
  })
  const deep: Record<string, unknown> = {}
  let cursor = deep
  for (let index = 0; index < 10; index += 1) {
    const next: Record<string, unknown> = {}
    cursor.next = next
    cursor = next
  }

  try {
    configureDiagnosticsLog(logPath)
    assert.doesNotThrow(() => {
      logDiagnostic("test", "normalize", { causedError, circular, deep, unreadable })
    })
    await flushDiagnosticsLog()

    const entry = JSON.parse((await readFile(logPath, "utf8")).trim()) as {
      fields: {
        causedError: { cause: string }
        circular: { self: string }
        deep: { next: unknown }
        unreadable: { secret: string; visible: boolean }
      }
    }
    assert.equal(entry.fields.causedError.cause, "[Circular]")
    assert.equal(entry.fields.circular.self, "[Circular]")
    assert.match(JSON.stringify(entry.fields.deep), /\[Max depth\]/)
    assert.deepEqual(entry.fields.unreadable, { secret: "[Unreadable: getter failed]", visible: true })
  } finally {
    await rm(tempDirectory, { force: true, recursive: true })
  }
})
