import assert from "node:assert/strict"
import { test } from "vitest"
import { createConnectorOAuthReturnUri, parseConnectionOAuthCallback } from "./domain.ts"

test("createConnectorOAuthReturnUri carries the app protocol for browser callback launch", () => {
  assert.equal(
    createConnectorOAuthReturnUri("https://console.oomol.com", "wanta"),
    "https://console.oomol.com/app-connections/callback?protocol=wanta",
  )
  assert.equal(
    createConnectorOAuthReturnUri("https://console.oomol.com/", "wanta-local"),
    "https://console.oomol.com/app-connections/callback?protocol=wanta-local",
  )
})

test("parseConnectionOAuthCallback accepts the connections callback deep link", () => {
  assert.deepEqual(
    parseConnectionOAuthCallback("wanta://connections/oauth-callback?service=figma&status=success", "wanta"),
    {
      service: "figma",
      status: "success",
    },
  )
})

test("parseConnectionOAuthCallback rejects foreign or unsuccessful callbacks", () => {
  assert.equal(
    parseConnectionOAuthCallback("wanta://connections/oauth-callback?service=figma&status=error", "wanta"),
    undefined,
  )
  assert.equal(
    parseConnectionOAuthCallback("wanta-local://connections/oauth-callback?service=figma&status=success", "wanta"),
    undefined,
  )
  assert.equal(parseConnectionOAuthCallback("wanta://signin?authID=auth-1", "wanta"), undefined)
  assert.equal(parseConnectionOAuthCallback("not a url", "wanta"), undefined)
})
