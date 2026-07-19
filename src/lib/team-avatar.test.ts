import assert from "node:assert/strict"
import { test } from "vitest"
import { teamAvatarPalette, teamAvatarStyle, teamInitials } from "./team-avatar.ts"

test("teamAvatarPalette provides enough distinct fallback colors", () => {
  assert.equal(teamAvatarPalette.length, 20)
  assert.equal(new Set(teamAvatarPalette.map((tone) => tone.backgroundColor)).size, 20)
})

test("teamAvatarStyle is stable for the same team seed", () => {
  assert.deepEqual(
    teamAvatarStyle("019eddb2-7587-7e98-88a6-975c65b672b"),
    teamAvatarStyle("019eddb2-7587-7e98-88a6-975c65b672b"),
  )
  assert.deepEqual(teamAvatarStyle(" Netless "), teamAvatarStyle("netless"))
})

test("teamInitials uses the first two visible characters", () => {
  assert.equal(teamInitials("netless"), "NE")
  assert.equal(teamInitials(" 团队 "), "团队")
  assert.equal(teamInitials(""), "OR")
})
