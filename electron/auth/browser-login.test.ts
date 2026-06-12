import assert from "node:assert/strict"
import { test } from "vitest"
import { ooEndpoint } from "../domain.ts"
import {
  extractOomolTokenFromCookies,
  hubSigninUrl,
  normalizeDefaultApiKey,
  normalizeLoginProfile,
  parseSigninCallback,
} from "./browser-login.ts"

test("hubSigninUrl carries the deep-link protocol back to the hub", () => {
  assert.equal(hubSigninUrl("lumo"), `https://hub.${ooEndpoint}/signin-app?protocol=lumo`)
  assert.equal(hubSigninUrl("lumo-local"), `https://hub.${ooEndpoint}/signin-app?protocol=lumo-local`)
})

test("parseSigninCallback accepts <scheme>://signin?authID=", () => {
  assert.equal(parseSigninCallback("lumo://signin?authID=auth-1", "lumo"), "auth-1")
  assert.equal(parseSigninCallback("lumo://signin/?authID=auth-1", "lumo"), "auth-1")
  assert.equal(parseSigninCallback("lumo-local://signin?authID=a", "lumo-local"), "a")
})

test("parseSigninCallback rejects foreign/malformed URLs", () => {
  assert.equal(parseSigninCallback("lumo://other?authID=a", "lumo"), undefined)
  assert.equal(parseSigninCallback("lumo://signin/extra?authID=a", "lumo"), undefined)
  assert.equal(parseSigninCallback("oomol-desktop://signin?authID=a", "lumo"), undefined)
  assert.equal(parseSigninCallback("lumo://signin", "lumo"), undefined)
  assert.equal(parseSigninCallback("not a url", "lumo"), undefined)
})

test("extractOomolTokenFromCookies finds the session token", () => {
  assert.equal(extractOomolTokenFromCookies(["foo=bar; Path=/", "oomol-token=tok-123; HttpOnly; Secure"]), "tok-123")
  assert.equal(extractOomolTokenFromCookies(["foo=bar"]), undefined)
  assert.equal(extractOomolTokenFromCookies([]), undefined)
})

test("normalizeDefaultApiKey requires a non-empty string key", () => {
  assert.equal(normalizeDefaultApiKey({ key: "oo-key" }), "oo-key")
  assert.equal(normalizeDefaultApiKey({ key: "" }), undefined)
  assert.equal(normalizeDefaultApiKey({}), undefined)
})

test("normalizeLoginProfile prefers nickname and requires uid", () => {
  assert.deepEqual(normalizeLoginProfile({ uid: "u1", nickname: "Nick", username: "user" }), {
    id: "u1",
    name: "Nick",
  })
  assert.deepEqual(normalizeLoginProfile({ uid: "u1", username: "user" }), { id: "u1", name: "user" })
  assert.deepEqual(normalizeLoginProfile({ uid: "u1" }), { id: "u1", name: "u1" })
  assert.equal(normalizeLoginProfile({ nickname: "no-uid" }), undefined)
})
