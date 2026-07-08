import type { ChatPermissionRequest } from "./common.ts"

import assert from "node:assert/strict"
import path from "node:path"
import { test } from "vitest"
import {
  createProjectDevCommandSessionGrant,
  isLikelyProjectDevCommandRequest,
  isProjectDevCommandRequest,
  requestMatchesProjectDevCommandSessionGrant,
} from "./project-dev-command.ts"

const root = "/Users/example/code/wanta"

function permission(command: string): ChatPermissionRequest {
  return {
    id: "permission-1",
    sessionId: "session-1",
    action: "bash",
    resources: [],
    metadata: { command },
  }
}

test("project dev command recognizes common project quality commands", () => {
  assert.equal(isProjectDevCommandRequest(permission("npm test"), root), true)
  assert.equal(isProjectDevCommandRequest(permission("npm run ts-check"), root), true)
  assert.equal(isProjectDevCommandRequest(permission("pnpm lint"), root), true)
  assert.equal(isProjectDevCommandRequest(permission("yarn run typecheck"), root), true)
  assert.equal(isProjectDevCommandRequest(permission("bun test"), root), true)
  assert.equal(isProjectDevCommandRequest(permission("pytest tests/unit"), root), true)
  assert.equal(isProjectDevCommandRequest(permission("python -m pytest ./tests"), root), true)
  assert.equal(isProjectDevCommandRequest(permission("go test ./..."), root), true)
  assert.equal(isProjectDevCommandRequest(permission("cargo test"), root), true)
  assert.equal(isProjectDevCommandRequest(permission("tsc --noEmit"), root), true)
  assert.equal(isProjectDevCommandRequest(permission("vitest run"), root), true)
})

test("project dev command supports explicit project cwd forms", () => {
  assert.equal(isProjectDevCommandRequest(permission(`cd ${root} && npm test`), root), true)
  assert.equal(isProjectDevCommandRequest(permission(`npm --prefix ${root} run lint`), root), true)
  assert.equal(isProjectDevCommandRequest(permission(`pnpm --dir=${root} run typecheck`), root), true)
  assert.equal(isProjectDevCommandRequest(permission(`yarn --cwd ${root} test`), root), true)
})

test("project dev command rejects unrelated, mutating, or unsafe commands", () => {
  assert.equal(isProjectDevCommandRequest(permission("npm install"), root), false)
  assert.equal(isProjectDevCommandRequest(permission("npm publish"), root), false)
  assert.equal(isProjectDevCommandRequest(permission("npx vitest"), root), false)
  assert.equal(isProjectDevCommandRequest(permission("vitest"), root), false)
  assert.equal(isProjectDevCommandRequest(permission("npm test && rm -rf /tmp/out"), root), false)
  assert.equal(isProjectDevCommandRequest(permission("npm run lint -- --fix"), root), false)
  assert.equal(isProjectDevCommandRequest(permission(`cd /tmp && npm test`), root), false)
  assert.equal(isProjectDevCommandRequest(permission(`npm --prefix /tmp run lint`), root), false)
  assert.equal(isProjectDevCommandRequest(permission("pytest /tmp/tests"), root), false)
  assert.equal(isProjectDevCommandRequest(permission("pytest --env-file .env"), root), false)
  assert.equal(isProjectDevCommandRequest(permission(`npm run lint -- ${path.join(root, ".npmrc")}`), root), false)
})

test("project dev command grants match related project dev commands in the same chat", () => {
  const grant = createProjectDevCommandSessionGrant(permission("npm test"), root)

  assert.ok(grant)
  assert.equal(requestMatchesProjectDevCommandSessionGrant(permission("pnpm lint"), grant, root), true)
  assert.equal(requestMatchesProjectDevCommandSessionGrant(permission("npm install"), grant, root), false)
  assert.equal(requestMatchesProjectDevCommandSessionGrant(permission("pytest /tmp/tests"), grant, root), false)
})

test("project dev command likely matcher is usable without project context for UI copy", () => {
  assert.equal(isLikelyProjectDevCommandRequest(permission(`cd ${root} && npm test`)), true)
  assert.equal(isLikelyProjectDevCommandRequest(permission("npm install")), false)
  assert.equal(isLikelyProjectDevCommandRequest(permission("rm -rf /tmp/out")), false)
})
