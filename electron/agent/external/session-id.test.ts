import assert from "node:assert/strict"
import { test } from "vitest"
import {
  externalAgentKindForSessionId,
  externalSessionUuid,
  isAgentKind,
  parseExternalSessionIdentity,
} from "./session-id.ts"

const uuid = "123e4567-e89b-12d3-a456-426614174000"

test("external session identity parsing is registry-independent but strict", () => {
  assert.deepEqual(parseExternalSessionIdentity(`wanta-ext:future-agent:${uuid}`), {
    kind: "future-agent",
    uuid,
  })
  assert.equal(externalAgentKindForSessionId(`wanta-ext:future-agent:${uuid}`), undefined)
  assert.equal(externalSessionUuid(`wanta-ext:future-agent:${uuid}`), uuid)
  assert.equal(parseExternalSessionIdentity("wanta-ext:codex:not-a-uuid"), undefined)
  assert.equal(parseExternalSessionIdentity(`wanta-ext:bad_kind:${uuid}`), undefined)
})

test("prototype property names are never accepted as registered agents", () => {
  assert.equal(isAgentKind("constructor"), false)
  assert.equal(isAgentKind("toString"), false)
  assert.equal(externalAgentKindForSessionId(`wanta-ext:constructor:${uuid}`), undefined)
  assert.equal(externalAgentKindForSessionId(`wanta-ext:toString:${uuid}`), undefined)
  assert.equal(externalAgentKindForSessionId(`wanta-ext:codex:${uuid}`), "codex")
})
