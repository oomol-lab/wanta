import assert from "node:assert/strict"
import { test } from "vitest"
import { updateOoIdentitySettings } from "./oo-identity.ts"

test("updateOoIdentitySettings escapes TOML basic strings directly", () => {
  const updated = updateOoIdentitySettings("", 'team "quoted"\\line\nnext\t\u0001')

  assert.equal(updated, '[identity]\nteam = "team \\"quoted\\"\\\\line\\nnext\\t\\u0001"\n')
})

test("updateOoIdentitySettings migrates a retired organization key to the CLI team key", () => {
  const updated = updateOoIdentitySettings('[identity]\norganization = "old"\nnote = "keep"\n', "new")

  assert.equal(updated, '[identity]\nteam = "new"\nnote = "keep"\n')
})

test("updateOoIdentitySettings collapses every selector regardless of key order", () => {
  assert.equal(
    updateOoIdentitySettings('[identity]\nteam = "legacy"\norganization = "current"\nnote = "keep"\n', "new"),
    '[identity]\nteam = "new"\nnote = "keep"\n',
  )
  assert.equal(
    updateOoIdentitySettings('[identity]\norganization = "current"\nteam = "legacy"\nnote = "keep"\n', "new"),
    '[identity]\nteam = "new"\nnote = "keep"\n',
  )
})

test("updateOoIdentitySettings removes every selector when clearing identity", () => {
  const source = '[identity]\norganization = "current"\nnote = "keep"\nteam = "legacy"\n'
  assert.equal(updateOoIdentitySettings(source, undefined), '[identity]\nnote = "keep"\n')
})
