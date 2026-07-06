import type { ChatPermissionRequest } from "./common.ts"

import assert from "node:assert/strict"
import path from "node:path"
import { test } from "vitest"
import {
  isTrustedProjectPermissionAction,
  projectPermissionRequestInsideRoot,
  projectPermissionResourceInsideRoot,
} from "./project-permission.ts"

function permission(overrides: Partial<ChatPermissionRequest>): ChatPermissionRequest {
  return {
    id: "permission-1",
    sessionId: "session-1",
    action: "external_directory",
    resources: [],
    ...overrides,
  }
}

test("trusted project permission actions cover file access but not shell commands", () => {
  assert.equal(isTrustedProjectPermissionAction("external_directory"), true)
  assert.equal(isTrustedProjectPermissionAction("edit"), true)
  assert.equal(isTrustedProjectPermissionAction("write"), true)
  assert.equal(isTrustedProjectPermissionAction("file.read"), true)
  assert.equal(isTrustedProjectPermissionAction("bash"), false)
})

test("project permission resources must stay inside the trusted root", () => {
  const root = "/Users/example/code/wanta"

  assert.equal(projectPermissionResourceInsideRoot(path.join(root, "src/main.tsx"), root), true)
  assert.equal(projectPermissionResourceInsideRoot(`${root}/*`, root), true)
  assert.equal(projectPermissionResourceInsideRoot(`${root}/src/**/*.ts`, root), true)
  assert.equal(projectPermissionResourceInsideRoot(root, root), true)
  assert.equal(projectPermissionResourceInsideRoot("/Users/example/code/wanta-other/src/main.tsx", root), false)
  assert.equal(projectPermissionResourceInsideRoot(`${root}/../outside`, root), false)
  assert.equal(projectPermissionResourceInsideRoot(`${root}*`, root), false)
  assert.equal(projectPermissionResourceInsideRoot("src/main.tsx", root), false)
})

test("trusted project permission requests require every immediate resource to be inside root", () => {
  const root = "/Users/example/code/wanta"

  assert.equal(
    projectPermissionRequestInsideRoot(permission({ resources: [path.join(root, "src/main.tsx")], save: ["*"] }), root),
    true,
  )
  assert.equal(
    projectPermissionRequestInsideRoot(
      permission({
        resources: [path.join(root, "src/main.tsx"), "/Users/example/secrets.env"],
      }),
      root,
    ),
    false,
  )
  assert.equal(projectPermissionRequestInsideRoot(permission({ action: "bash", resources: [root] }), root), false)
  assert.equal(projectPermissionRequestInsideRoot(permission({ resources: [] }), root), false)
})
