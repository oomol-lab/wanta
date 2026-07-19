import assert from "node:assert/strict"
import { test } from "vitest"
import {
  apiBaseUrl,
  connectorBaseUrl,
  consoleBaseUrl,
  consoleServerBaseUrl,
  llmBaseUrl,
  ooEndpoint,
  teamControlBaseUrl,
  packageAssetsBaseUrl,
  staticBaseUrl,
} from "./domain.ts"

test("ooEndpoint is a bare host injected at build time", () => {
  // 由 vite/vitest define 注入（缺省 oomol.com，可由 .env.local 覆盖）；这里只校验形态。
  assert.match(ooEndpoint, /^[a-z0-9.-]+$/)
})

test("all base URLs derive from the single injected endpoint", () => {
  assert.equal(llmBaseUrl, `https://llm.${ooEndpoint}/v1`)
  assert.equal(connectorBaseUrl, `https://connector.${ooEndpoint}`)
  assert.equal(teamControlBaseUrl, `https://org-control.${ooEndpoint}`)
  assert.equal(consoleBaseUrl, `https://console.${ooEndpoint}`)
  assert.equal(consoleServerBaseUrl, `https://console-server.${ooEndpoint}`)
  assert.equal(apiBaseUrl, `https://api.${ooEndpoint}`)
  assert.match(packageAssetsBaseUrl, /^https:\/\/[a-z0-9.-]+$/)
  assert.equal(staticBaseUrl, `https://static.${ooEndpoint}`)
})
