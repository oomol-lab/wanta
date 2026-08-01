import assert from "node:assert/strict"
import { test } from "vitest"
import { updateOoIdentitySettings } from "./oo-identity.ts"

test("updateOoIdentitySettings escapes TOML basic strings directly", () => {
  const updated = updateOoIdentitySettings("", 'team "quoted"\\line\nnext\t\u0001')

  assert.equal(updated, '[identity]\nteam = "team \\"quoted\\"\\\\line\\nnext\\t\\u0001"\n')
})

test("updateOoIdentitySettings migrates the legacy organization key to team", () => {
  const updated = updateOoIdentitySettings('[identity]\norganization = "old"\nnote = "keep"\n', "new")

  assert.equal(updated, '[identity]\nteam = "new"\nnote = "keep"\n')
})
