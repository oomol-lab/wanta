import type { ChatPermissionRequest } from "./common.ts"

import assert from "node:assert/strict"
import path from "node:path"
import { test } from "vitest"
import {
  createProjectDependencyInstallTaskGrant,
  createProjectDevCommandSessionGrant,
  isCommonNodeDependencyInstallRequest,
  isLikelyProjectDependencyInstallRequest,
  isLikelyProjectDevCommandRequest,
  isProjectDependencyInstallRequest,
  isProjectDevCommandRequest,
  requestMatchesProjectDependencyInstallTaskGrant,
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

test("project dependency installs require an explicit, bounded project target", () => {
  assert.equal(isProjectDependencyInstallRequest(permission(`cd ${root} && pnpm install`), root), true)
  assert.equal(isProjectDependencyInstallRequest(permission(`npm --prefix ${root} add zod`), root), true)
  assert.equal(isProjectDependencyInstallRequest(permission("npm install"), root), false)
  assert.equal(isProjectDependencyInstallRequest(permission(`cd ${root} && npm install --global eslint`), root), false)
  assert.equal(
    isProjectDependencyInstallRequest(permission(`cd ${root} && npm install --location=global eslint`), root),
    false,
  )
  assert.equal(
    isProjectDependencyInstallRequest(permission(`cd ${root} && npm install --location global eslint`), root),
    false,
  )
  assert.equal(
    isProjectDependencyInstallRequest(permission(`cd ${root} && npm install --registry https://example.test`), root),
    false,
  )
  assert.equal(isProjectDependencyInstallRequest(permission("cd /tmp && npm install"), root), false)
  assert.equal(isLikelyProjectDependencyInstallRequest(permission(`cd ${root} && yarn add vite`)), true)
  assert.equal(isLikelyProjectDependencyInstallRequest(permission("npm install")), false)
})

test("common Node dependency installs allow only curated registry packages in an explicit target", () => {
  assert.equal(
    isCommonNodeDependencyInstallRequest(permission(`cd ${root} && npm install exceljs pdf-lib@latest -D`), root),
    true,
  )
  assert.equal(
    isCommonNodeDependencyInstallRequest(permission(`pnpm --dir=${root} add 'zod@^4' sharp --save-dev`), root),
    true,
  )
  assert.equal(isCommonNodeDependencyInstallRequest(permission(`yarn --cwd ${root} add pptxgenjs --exact`), root), true)
  assert.equal(isCommonNodeDependencyInstallRequest(permission(`cd ${root} && npm install xlsx`), root), false)
  assert.equal(
    isCommonNodeDependencyInstallRequest(permission(`cd ${root} && npm install exceljs unknown-package`), root),
    false,
  )
  assert.equal(isCommonNodeDependencyInstallRequest(permission(`cd ${root} && npm install`), root), false)
  assert.equal(
    isCommonNodeDependencyInstallRequest(
      permission(`cd ${root} && npm install exceljs --registry https://example.test`),
      root,
    ),
    false,
  )
  assert.equal(
    isCommonNodeDependencyInstallRequest(permission(`cd ${root} && npm install github:vendor/exceljs`), root),
    false,
  )
  assert.equal(
    isCommonNodeDependencyInstallRequest(permission(`cd ${root} && npm install exceljs --unknown-option`), root),
    false,
  )
  assert.equal(
    isCommonNodeDependencyInstallRequest(permission(`npm --unknown-option --prefix ${root} install exceljs`), root),
    false,
  )
  assert.equal(isCommonNodeDependencyInstallRequest(permission("npm install exceljs"), root), false)
})

test("project dependency grants expire with the current task generation", () => {
  const grant = createProjectDependencyInstallTaskGrant(permission(`cd ${root} && pnpm install`), root, "turn-1")

  assert.deepEqual(grant, {
    action: "bash",
    generationId: "turn-1",
    kind: "project_dependency_install",
    patterns: ["project_dependency_install"],
    projectRoot: root,
  })
  assert.ok(grant)
  assert.equal(
    requestMatchesProjectDependencyInstallTaskGrant(permission(`cd ${root} && pnpm add zod`), grant, root, "turn-1"),
    true,
  )
  assert.equal(
    requestMatchesProjectDependencyInstallTaskGrant(permission(`cd ${root} && pnpm add zod`), grant, root, "turn-2"),
    false,
  )
  assert.equal(
    requestMatchesProjectDependencyInstallTaskGrant(
      permission(`cd ${root} && pnpm add zod --registry https://example.test`),
      grant,
      root,
      "turn-1",
    ),
    false,
  )
})
