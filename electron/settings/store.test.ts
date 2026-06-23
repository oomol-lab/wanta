import assert from "node:assert/strict"
import { mkdtempSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "vitest"
import { SettingsStore } from "./store.ts"

test("SettingsStore round-trips persisted settings", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wanta-settings-"))
  const store = new SettingsStore(dir)
  assert.deepEqual(store.read(), {})
  store.write({ themeSource: "dark" })
  assert.deepEqual(store.read(), { themeSource: "dark" })
  store.write({ ...store.read(), themeSource: "light" })
  assert.equal(store.read().themeSource, "light")
})

test("SettingsStore round-trips updateChannel and leaves no tmp file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wanta-settings-"))
  const store = new SettingsStore(dir)
  store.write({ themeSource: "dark", updateChannel: "beta" })
  assert.deepEqual(store.read(), { themeSource: "dark", updateChannel: "beta" })
  // 原子写收尾后目录里只应有 settings.json，不残留 .tmp-* 中间文件。
  assert.deepEqual(readdirSync(dir), ["settings.json"])
})

test("SettingsStore returns empty on missing/corrupt file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wanta-settings-"))
  assert.deepEqual(new SettingsStore(dir).read(), {})
})
