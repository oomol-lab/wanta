import assert from "node:assert/strict"
import { test } from "vitest"
import { updateOoIdentitySettings } from "./oo-identity.ts"

test("updateOoIdentitySettings escapes TOML basic strings directly", () => {
  const updated = updateOoIdentitySettings("", 'team "quoted"\\line\nnext\t\u0001')

  assert.equal(updated, '[identity]\norganization = "team \\"quoted\\"\\\\line\\nnext\\t\\u0001"\n')
})

test("updateOoIdentitySettings migrates an ignored team key to the CLI organization key", () => {
  const updated = updateOoIdentitySettings('[identity]\nteam = "old"\nnote = "keep"\n', "new")

  assert.equal(updated, '[identity]\norganization = "new"\nnote = "keep"\n')
})
