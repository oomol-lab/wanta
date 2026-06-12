import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "vitest"
import { SettingsStore } from "./store.ts"

test("SettingsStore round-trips persisted settings", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lumo-settings-"))
  const store = new SettingsStore(dir)
  assert.deepEqual(store.read(), {})
  store.write({ themeSource: "dark" })
  assert.deepEqual(store.read(), { themeSource: "dark" })
  store.write({ ...store.read(), themeSource: "light" })
  assert.equal(store.read().themeSource, "light")
})

test("SettingsStore returns empty on missing/corrupt file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lumo-settings-"))
  assert.deepEqual(new SettingsStore(dir).read(), {})
})
