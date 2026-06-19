import assert from "node:assert/strict"
import { test } from "vitest"
import { assertSafeResetPaths } from "./reset.ts"

test("assertSafeResetPaths rejects identical source and target", () => {
  assert.throws(() => assertSafeResetPaths("/tmp/example", "/tmp/example"))
})

test("assertSafeResetPaths rejects source and target containment", () => {
  assert.throws(() => assertSafeResetPaths("/tmp/example/source", "/tmp/example/source/target"))
  assert.throws(() => assertSafeResetPaths("/tmp/example/source/target", "/tmp/example/source"))
})
