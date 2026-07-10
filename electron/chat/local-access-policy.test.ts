import type { ChatPermissionRequest } from "./common.ts"

import assert from "node:assert/strict"
import path from "node:path"
import { test } from "vitest"
import { evaluateLocalAccessRequest, localAccessGrantForRequest } from "./local-access-policy.ts"

function permission(overrides: Partial<ChatPermissionRequest>): ChatPermissionRequest {
  return {
    id: "permission-1",
    sessionId: "session-1",
    action: "bash",
    resources: [],
    ...overrides,
  }
}

test("local access policy allows ordinary commands in default mode", () => {
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: "npm test" } }), { permissionMode: "default" }),
    { type: "allow", reason: "default_command", kind: "command", highRisk: false },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: "oo connector apps posthog 2>&1 | head -80" } }), {
      permissionMode: "default",
    }),
    { type: "allow", reason: "default_command", kind: "command", highRisk: false },
  )
})

test("local access policy allows pure oo commands without a renderer prompt", () => {
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: 'oo search "gmail" --json' } }), {
      permissionMode: "default",
    }),
    { type: "allow", reason: "oo_cli", kind: "command", highRisk: false },
  )
})

test("local access policy allows trusted project read-only commands", () => {
  const root = "/Users/example/code/wanta"

  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: `rg "permissionMode" ${root}` } }), {
      permissionMode: "default",
      trustedProjectRoot: root,
    }),
    { type: "allow", reason: "project_read_command", kind: "command", highRisk: false },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: "npm test" } }), {
      permissionMode: "default",
      trustedProjectRoot: root,
    }),
    { type: "allow", reason: "default_command", kind: "command", highRisk: false },
  )
})

test("local access policy allows ordinary file requests and protects sensitive paths", () => {
  const root = "/Users/example/code/wanta"

  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ action: "external_directory", resources: [path.join(root, "src")] }), {
      permissionMode: "default",
      trustedProjectRoot: root,
    }),
    { type: "allow", reason: "trusted_project", kind: "path", highRisk: false },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ action: "external_directory", resources: ["/Users/example/Desktop"] }), {
      permissionMode: "default",
      trustedProjectRoot: root,
    }),
    { type: "allow", reason: "default_local", kind: "path", highRisk: false },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ action: "external_directory", resources: ["/Users/example/.ssh"] }), {
      permissionMode: "default",
      trustedProjectRoot: root,
    }),
    { type: "prompt", kind: "path", highRisk: false },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ action: "edit", resources: [path.join(root, ".env")] }), {
      permissionMode: "default",
      trustedProjectRoot: root,
    }),
    { type: "prompt", kind: "edit", highRisk: false },
  )
})

test("local access policy prompts high-risk commands in default mode", () => {
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: "npm install" } }), { permissionMode: "default" }),
    { type: "prompt", kind: "command", highRisk: true },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: "cat ~/.ssh/id_rsa" } }), {
      permissionMode: "default",
    }),
    { type: "prompt", kind: "command", highRisk: true },
  )
})

test("task-scoped managed Python grants only cover the approved packages in the task environment", () => {
  const processRoot = "/tmp/wanta-process/task-1"
  const grant = localAccessGrantForRequest(
    permission({
      metadata: { command: `${processRoot}/.wanta-python/bin/python -m pip install openpyxl fpdf2` },
    }),
    { managedPythonProcessRoot: processRoot },
  )

  assert.deepEqual(grant, {
    action: "bash",
    kind: "python_dependency_install",
    patterns: ["openpyxl", "fpdf2"],
    processRoot,
  })
  assert.deepEqual(
    evaluateLocalAccessRequest(
      permission({ metadata: { command: `${processRoot}/.wanta-python/bin/python -m pip install openpyxl` } }),
      { permissionMode: "default", sessionGrants: [grant] },
    ),
    { type: "allow", reason: "session_grant", kind: "command", highRisk: true },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(
      permission({ metadata: { command: `${processRoot}/.wanta-python/bin/python -m pip install requests` } }),
      { permissionMode: "default", sessionGrants: [grant] },
    ),
    { type: "prompt", kind: "command", highRisk: true },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(
      permission({ metadata: { command: `pip3 install --break-system-packages --user openpyxl` } }),
      { permissionMode: "default", sessionGrants: [grant] },
    ),
    { type: "prompt", kind: "command", highRisk: true },
  )
})

test("local access policy allows requests in full access mode", () => {
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: "rm -rf /tmp/wanta-test" } }), {
      permissionMode: "full_access",
    }),
    { type: "allow", reason: "full_access", kind: "command", highRisk: true },
  )
})

test("local access policy allows requests covered by a session grant", () => {
  const grant = localAccessGrantForRequest(
    permission({ action: "external_directory", resources: ["/Users/example/.ssh"] }),
  )

  assert.ok(grant)
  assert.deepEqual(
    evaluateLocalAccessRequest(
      permission({ action: "external_directory", resources: ["/Users/example/.ssh/config"] }),
      {
        permissionMode: "default",
        sessionGrants: [grant],
      },
    ),
    { type: "allow", reason: "session_grant", kind: "path", highRisk: false },
  )
})

test("local access policy keeps project dev grants compatible but prompts unsafe package mutations", () => {
  const root = "/Users/example/code/wanta"
  const grant = localAccessGrantForRequest(permission({ metadata: { command: "npm test" } }), {
    trustedProjectRoot: root,
  })

  assert.ok(grant)
  assert.equal(grant.kind, "project_dev_command")
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: "pnpm lint" } }), {
      permissionMode: "default",
      sessionGrants: [grant],
      trustedProjectRoot: root,
    }),
    { type: "allow", reason: "session_grant", kind: "command", highRisk: false },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: "npm install" } }), {
      permissionMode: "default",
      sessionGrants: [grant],
      trustedProjectRoot: root,
    }),
    { type: "prompt", kind: "command", highRisk: true },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: "pnpm lint" } }), {
      permissionMode: "default",
      sessionGrants: [grant],
    }),
    { type: "allow", reason: "default_command", kind: "command", highRisk: false },
  )
})
