import type { ChatPermissionRequest } from "./common.ts"

import assert from "node:assert/strict"
import path from "node:path"
import { test } from "vitest"
import { isProjectReadOnlyCommandRequest } from "./project-read-command.ts"

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

test("project read-only command allows common project inspection commands", () => {
  assert.equal(isProjectReadOnlyCommandRequest(permission(`ls -la ${root}`), root), true)
  assert.equal(isProjectReadOnlyCommandRequest(permission(`rg "permissionMode" ${path.join(root, "src")}`), root), true)
  assert.equal(
    isProjectReadOnlyCommandRequest(permission(`sed -n '1,80p' ${path.join(root, "package.json")}`), root),
    true,
  )
  assert.equal(isProjectReadOnlyCommandRequest(permission(`find ${root} -maxdepth 2 -type f`), root), true)
  assert.equal(isProjectReadOnlyCommandRequest(permission(`git -C ${root} status --short`), root), true)
})

test("project read-only command rejects paths outside the trusted project", () => {
  assert.equal(isProjectReadOnlyCommandRequest(permission("cat /Users/example/.ssh/id_rsa"), root), false)
  assert.equal(isProjectReadOnlyCommandRequest(permission(`ls ${root} /tmp`), root), false)
  assert.equal(isProjectReadOnlyCommandRequest(permission("git -C /tmp status --short"), root), false)
})

test("project read-only command rejects sensitive files inside the trusted project", () => {
  assert.equal(isProjectReadOnlyCommandRequest(permission(`cat ${path.join(root, ".env")}`), root), false)
  assert.equal(isProjectReadOnlyCommandRequest(permission(`cat ${path.join(root, ".npmrc")}`), root), false)
  assert.equal(isProjectReadOnlyCommandRequest(permission(`ls ${path.join(root, ".ssh")}`), root), false)
})

test("project read-only command rejects shell composition and write-capable forms", () => {
  assert.equal(
    isProjectReadOnlyCommandRequest(permission(`cat ${path.join(root, "package.json")} > /tmp/out`), root),
    false,
  )
  assert.equal(isProjectReadOnlyCommandRequest(permission(`rg todo ${root} && rm -rf /tmp/x`), root), false)
  assert.equal(isProjectReadOnlyCommandRequest(permission(`find ${root} -delete`), root), false)
  assert.equal(
    isProjectReadOnlyCommandRequest(permission(`sed -i 's/a/b/' ${path.join(root, "package.json")}`), root),
    false,
  )
})

test("project read-only command does not allow project dev commands", () => {
  assert.equal(isProjectReadOnlyCommandRequest(permission("npm test"), root), false)
  assert.equal(isProjectReadOnlyCommandRequest(permission("pnpm lint"), root), false)
})
