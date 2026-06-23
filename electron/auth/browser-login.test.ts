import assert from "node:assert/strict"
import { test } from "vitest"
import { ooEndpoint } from "../domain.ts"
import {
  extractOomolTokenFromCookies,
  hubSigninUrl,
  normalizeLoginProfile,
  parseSigninCallback,
} from "./browser-login.ts"

test("hubSigninUrl carries the deep-link protocol back to the hub", () => {
  assert.equal(hubSigninUrl("wanta"), `https://hub.${ooEndpoint}/signin-app?protocol=wanta`)
  assert.equal(hubSigninUrl("wanta-local"), `https://hub.${ooEndpoint}/signin-app?protocol=wanta-local`)
})

test("parseSigninCallback accepts <scheme>://signin?authID=", () => {
  assert.equal(parseSigninCallback("wanta://signin?authID=auth-1", "wanta"), "auth-1")
  assert.equal(parseSigninCallback("wanta://signin/?authID=auth-1", "wanta"), "auth-1")
  assert.equal(parseSigninCallback("wanta-local://signin?authID=a", "wanta-local"), "a")
})

test("parseSigninCallback rejects foreign/malformed URLs", () => {
  assert.equal(parseSigninCallback("wanta://other?authID=a", "wanta"), undefined)
  assert.equal(parseSigninCallback("wanta://signin/extra?authID=a", "wanta"), undefined)
  assert.equal(parseSigninCallback("oomol-desktop://signin?authID=a", "wanta"), undefined)
  assert.equal(parseSigninCallback("wanta://signin", "wanta"), undefined)
  assert.equal(parseSigninCallback("not a url", "wanta"), undefined)
})

test("extractOomolTokenFromCookies finds the session token", () => {
  assert.equal(extractOomolTokenFromCookies(["foo=bar; Path=/", "oomol-token=tok-123; HttpOnly; Secure"]), "tok-123")
  assert.equal(extractOomolTokenFromCookies(["foo=bar"]), undefined)
  assert.equal(extractOomolTokenFromCookies([]), undefined)
})

test("normalizeLoginProfile prefers nickname and requires uid", () => {
  assert.deepEqual(
    normalizeLoginProfile({
      uid: "u1",
      nickname: "Nick",
      username: "user",
      avatar_url: "https://example.com/avatar.png",
    }),
    {
      id: "u1",
      name: "Nick",
      avatarUrl: "https://example.com/avatar.png",
    },
  )
  assert.deepEqual(normalizeLoginProfile({ uid: "u1", username: "user" }), { id: "u1", name: "user" })
  assert.deepEqual(normalizeLoginProfile({ uid: "u1", username: "user", avatar_url: "javascript:bad" }), {
    id: "u1",
    name: "user",
  })
  assert.deepEqual(normalizeLoginProfile({ uid: "u1", username: "user", url: "https://avatars.example.com/u1" }), {
    id: "u1",
    name: "user",
    avatarUrl: "https://avatars.example.com/u1",
  })
  assert.deepEqual(normalizeLoginProfile({ uid: "u1" }), { id: "u1", name: "u1" })
  assert.equal(normalizeLoginProfile({ nickname: "no-uid" }), undefined)
})
