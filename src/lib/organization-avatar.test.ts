import assert from "node:assert/strict"
import { test } from "vitest"
import { organizationAvatarPalette, organizationAvatarStyle, organizationInitials } from "./organization-avatar.ts"

test("organizationAvatarPalette provides enough distinct fallback colors", () => {
  assert.equal(organizationAvatarPalette.length, 20)
  assert.equal(new Set(organizationAvatarPalette.map((tone) => tone.backgroundColor)).size, 20)
})

test("organizationAvatarStyle is stable for the same organization seed", () => {
  assert.deepEqual(
    organizationAvatarStyle("019eddb2-7587-7e98-88a6-975c65b672b"),
    organizationAvatarStyle("019eddb2-7587-7e98-88a6-975c65b672b"),
  )
  assert.deepEqual(organizationAvatarStyle(" Netless "), organizationAvatarStyle("netless"))
})

test("organizationInitials uses the first two visible characters", () => {
  assert.equal(organizationInitials("netless"), "NE")
  assert.equal(organizationInitials(" 组织 "), "组织")
  assert.equal(organizationInitials(""), "OR")
})
