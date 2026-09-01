import type { ChatPermissionRequest } from "./common.ts"

import assert from "node:assert/strict"
import path from "node:path"
import { test } from "vitest"
import {
  createProjectDevCommandSessionGrant,
  isLikelyProjectDevCommandRequest,
  isProjectDevCommandRequest,
  isStandardRegistryNodeDependencyInstallRequest,
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

test("standard registry Node dependency installs use scope and source instead of package popularity", () => {
  assert.equal(
    isStandardRegistryNodeDependencyInstallRequest(
      permission(`cd ${root} && npm install exceljs pdf-lib@latest -D`),
      root,
    ),
    true,
  )
  assert.equal(
    isStandardRegistryNodeDependencyInstallRequest(
      permission(`pnpm --dir=${root} add 'zod@^4' sharp --save-dev`),
      root,
    ),
    true,
  )
  assert.equal(
    isStandardRegistryNodeDependencyInstallRequest(permission(`yarn --cwd ${root} add pptxgenjs --exact`), root),
    true,
  )
  assert.equal(isStandardRegistryNodeDependencyInstallRequest(permission(`cd ${root} && npm install xlsx`), root), true)
  assert.equal(
    isStandardRegistryNodeDependencyInstallRequest(
      permission(`cd ${root} && npm install unreviewed-agent-package`),
      root,
    ),
    true,
  )
  assert.equal(
    isStandardRegistryNodeDependencyInstallRequest(
      permission(`SCRIPT_DIR="${root}"\ncd "$SCRIPT_DIR" && npm install marked 2>&1 | tail -5`),
      root,
    ),
    true,
  )
  assert.equal(
    isStandardRegistryNodeDependencyInstallRequest(
      permission(`SCRIPT_DIR="${root}"\ncd "$OTHER_DIR" && npm install marked 2>&1 | tail -5`),
      root,
    ),
    false,
  )
  assert.equal(
    isStandardRegistryNodeDependencyInstallRequest(
      permission(`SCRIPT_DIR="/tmp/outside"\ncd "$SCRIPT_DIR" && npm install marked 2>&1 | tail -5`),
      root,
    ),
    false,
  )
  assert.equal(
    isStandardRegistryNodeDependencyInstallRequest(permission(`cd ${root} && npm install marked | sh`), root),
    false,
  )
  assert.equal(isStandardRegistryNodeDependencyInstallRequest(permission(`cd ${root} && npm install`), root), true)
  assert.equal(isStandardRegistryNodeDependencyInstallRequest(permission(`cd ${root} && npm ci`), root), true)
  assert.equal(isStandardRegistryNodeDependencyInstallRequest(permission(`cd ${root} && pnpm update`), root), true)
  assert.equal(
    isStandardRegistryNodeDependencyInstallRequest(
      permission(`cd ${root} && npm install exceljs --registry https://example.test`),
      root,
    ),
    false,
  )
  assert.equal(
    isStandardRegistryNodeDependencyInstallRequest(permission(`cd ${root} && npm install github:vendor/exceljs`), root),
    false,
  )
  assert.equal(
    isStandardRegistryNodeDependencyInstallRequest(
      permission(`cd ${root} && npm install exceljs --unknown-option`),
      root,
    ),
    true,
  )
  assert.equal(
    isStandardRegistryNodeDependencyInstallRequest(
      permission(`npm --unknown-option --prefix ${root} install exceljs`),
      root,
    ),
    true,
  )
  assert.equal(isStandardRegistryNodeDependencyInstallRequest(permission("npm install exceljs"), root), false)
  assert.equal(isStandardRegistryNodeDependencyInstallRequest(permission("npm install exceljs"), root, root), true)
  assert.equal(
    isStandardRegistryNodeDependencyInstallRequest(
      permission(`cd ${root} && npm install marked > /tmp/install.log`),
      root,
    ),
    true,
  )
  assert.equal(
    isStandardRegistryNodeDependencyInstallRequest(
      permission(`cd ${root} && npm install marked > "$(touch /tmp/pwn)"`),
      root,
    ),
    false,
  )
  assert.equal(
    isStandardRegistryNodeDependencyInstallRequest(
      permission(`cd ${root} && npm install marked > /tmp/install.log;env`),
      root,
    ),
    false,
  )
  assert.equal(
    isStandardRegistryNodeDependencyInstallRequest(
      permission(`cd ${root} && npm install marked 2>&1 >/tmp/install.log`),
      root,
    ),
    true,
  )
  for (const packageName of [
    "playwright",
    "playwright-core",
    "@playwright/test",
    "puppeteer",
    "puppeteer-core",
    "canvas",
  ]) {
    assert.equal(
      isStandardRegistryNodeDependencyInstallRequest(permission(`cd ${root} && npm install ${packageName}`), root),
      true,
      packageName,
    )
  }
})
