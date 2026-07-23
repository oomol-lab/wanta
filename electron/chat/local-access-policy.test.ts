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
      linkRuntime: "oomol",
      permissionMode: "default",
    }),
    { type: "allow", reason: "oo_cli", kind: "command", highRisk: false },
  )
})

test("local access policy prompts for direct and wrapped oo commands under OpenConnector", () => {
  for (const command of [
    "oo connector apps --json",
    "bash -c 'oo connector apps --json'",
    "/bin/bash -c 'oo connector apps --json'",
    "sh -lc 'oo connector apps --json'",
    "zsh -c 'cd /tmp && oo connector apps --json'",
    'cmd.exe /c "oo connector apps --json"',
    "cmd /c oo connector apps --json",
    'pwsh -Command "oo connector apps --json"',
  ]) {
    assert.deepEqual(
      evaluateLocalAccessRequest(permission({ metadata: { command } }), {
        linkRuntime: "openconnector",
        permissionMode: "full_access",
      }),
      { type: "prompt", kind: "command", highRisk: false },
      command,
    )
  }
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: "oo connector run gmail list --json" } }), {
      linkRuntime: "openconnector",
      permissionMode: "default",
    }),
    { type: "prompt", kind: "command", highRisk: false },
  )
})

test("local access policy prompts when shell wrapper syntax is not fully modeled", () => {
  for (const command of [
    "bash -c'oo auth login'",
    "bash -c $'oo auth login'",
    `bash -c "$(printf 'oo auth login')"`,
    "bash -c '$SHELL_COMMAND'",
    "bash -ec 'oo auth login'",
    "bash script.sh",
    "cmd /c %SHELL_COMMAND%",
  ]) {
    assert.deepEqual(
      evaluateLocalAccessRequest(permission({ metadata: { command } }), {
        linkRuntime: "openconnector",
        permissionMode: "full_access",
      }),
      { type: "prompt", kind: "command", highRisk: false },
      command,
    )
  }
})

test("local access policy rejects OpenConnector credential and configuration commands", () => {
  for (const command of [
    "oo connector login https://connector.example.test",
    "oo connector logout",
    "oo config set endpoint https://other.example.test",
    "oo connector apps --endpoint https://other.example.test",
    "oo connector apps --endpoint=https://other.example.test",
    "oo connector apps && oo connector logout",
    "bash -c 'oo connector login https://connector.example.test'",
    "bash -c '$WANTA_OO_BIN config set endpoint https://other.example.test'",
    "sh -lc 'oo config set endpoint https://other.example.test'",
    "zsh -c 'cd /tmp && oo connector apps --connector-token secret'",
    'cmd /c "oo connector logout"',
    "cmd /c oo auth login",
    "cmd.exe /k oo connector logout",
    'powershell.exe -Command "oo config set endpoint https://other.example.test"',
    "powershell -Command oo config set endpoint https://other.example.test",
    "pwsh -c oo connector apps --connector-token secret",
    "OO_CONNECTOR_URL=https://other.example.test oo connector apps",
    "printenv",
    "bash -lc 'env'",
    "echo $OO_CONNECTOR_TOKEN",
    "echo ${OO_API_KEY}",
  ]) {
    assert.deepEqual(
      evaluateLocalAccessRequest(permission({ metadata: { command } }), {
        linkRuntime: "openconnector",
        permissionMode: "full_access",
      }),
      { type: "deny", kind: "command", highRisk: false },
      command,
    )
  }

  assert.equal(
    evaluateLocalAccessRequest(permission({ metadata: { command: "some-tool --data-dir /tmp/output" } }), {
      linkRuntime: "openconnector",
      permissionMode: "full_access",
    }).type,
    "allow",
  )
  assert.equal(
    evaluateLocalAccessRequest(permission({ metadata: { command: "bash -c 'printf ok'" } }), {
      linkRuntime: "openconnector",
      permissionMode: "full_access",
    }).type,
    "allow",
  )
  assert.equal(
    evaluateLocalAccessRequest(permission({ metadata: { command: "cmd /c echo ok" } }), {
      linkRuntime: "openconnector",
      permissionMode: "full_access",
    }).type,
    "allow",
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

test("local access policy separates dependency confirmation from genuinely high-risk commands", () => {
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: "npm install" } }), { permissionMode: "default" }),
    { type: "prompt", kind: "command", highRisk: false },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: "cat ~/.ssh/id_rsa" } }), {
      permissionMode: "default",
    }),
    { type: "prompt", kind: "command", highRisk: true },
  )
})

test("default access auto-approves direct PyPI requirements only in the active task environment", () => {
  const processRoot = "/tmp/wanta-process/task-1"
  assert.deepEqual(
    evaluateLocalAccessRequest(
      permission({
        metadata: {
          command: `${processRoot}/.wanta-python/bin/python -m pip install --upgrade 'pandas>=2' 'markitdown[pdf,docx,pptx,xlsx]'`,
        },
      }),
      { permissionMode: "default", taskProcessRoot: processRoot },
    ),
    { type: "allow", reason: "trusted_dependency", kind: "command", highRisk: false },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(
      permission({
        metadata: { command: `${processRoot}/.wanta-python/bin/python -m pip install fitz` },
      }),
      { permissionMode: "default", taskProcessRoot: processRoot },
    ),
    { type: "allow", reason: "trusted_dependency", kind: "command", highRisk: false },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(
      permission({
        metadata: { command: "/tmp/other/.wanta-python/bin/python -m pip install pandas" },
      }),
      { permissionMode: "default", taskProcessRoot: processRoot },
    ),
    { type: "prompt", kind: "command", highRisk: false },
  )
})

test("default access auto-approves standard registry Node dependencies in bounded task or project roots", () => {
  const processRoot = "/tmp/wanta-process/task-1"
  const projectRoot = "/Users/example/code/customer-project"
  assert.deepEqual(
    evaluateLocalAccessRequest(
      permission({ metadata: { command: `cd ${processRoot} && npm install exceljs pdf-lib` } }),
      {
        permissionMode: "default",
        taskProcessRoot: processRoot,
      },
    ),
    { type: "allow", reason: "trusted_dependency", kind: "command", highRisk: false },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: `pnpm --dir ${projectRoot} add zod sharp` } }), {
      permissionMode: "default",
      trustedProjectRoot: projectRoot,
    }),
    { type: "allow", reason: "trusted_dependency", kind: "command", highRisk: false },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: `cd ${processRoot} && npm install xlsx` } }), {
      permissionMode: "default",
      taskProcessRoot: processRoot,
    }),
    { type: "allow", reason: "trusted_dependency", kind: "command", highRisk: false },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(
      permission({
        metadata: {
          command: `SCRIPT_DIR="${processRoot}"\ncd "$SCRIPT_DIR" && npm install marked 2>&1 | tail -5`,
        },
      }),
      {
        permissionMode: "default",
        taskProcessRoot: processRoot,
      },
    ),
    { type: "allow", reason: "trusted_dependency", kind: "command", highRisk: false },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(
      permission({ metadata: { command: `cd ${processRoot} && npm install any-standard-registry-package` } }),
      {
        permissionMode: "default",
        taskProcessRoot: processRoot,
      },
    ),
    { type: "allow", reason: "trusted_dependency", kind: "command", highRisk: false },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(
      permission({ metadata: { command: `cd ${processRoot} && npm install exceljs --registry https://example.test` } }),
      {
        permissionMode: "default",
        taskProcessRoot: processRoot,
      },
    ),
    { type: "prompt", kind: "command", highRisk: true },
  )
  for (const packageName of ["playwright", "playwright-core", "puppeteer", "puppeteer-core"]) {
    assert.deepEqual(
      evaluateLocalAccessRequest(
        permission({ metadata: { command: `cd ${processRoot} && npm install ${packageName}` } }),
        {
          permissionMode: "default",
          taskProcessRoot: processRoot,
        },
      ),
      { type: "prompt", kind: "command", highRisk: true },
      packageName,
    )
  }
})

test("default access allows package runners unless they cross an explicit confirmation boundary", () => {
  const prettierProbe =
    'which pandoc 2>/dev/null; which wkhtmltopdf 2>/dev/null; which weasyprint 2>/dev/null; which prince 2>/dev/null; echo "---"; npm list -g @marp-team/marp-cli 2>/dev/null; npx --yes prettier 2>/dev/null; echo "---"; python3 -c "import markdown; print(\'markdown ok\')" 2>/dev/null; python3 -c "import weasyprint; print(\'weasyprint ok\')" 2>/dev/null; echo "---"; brew list pandoc 2>/dev/null | head -3'
  const markdownPdfProbe =
    'which pandoc 2>/dev/null; which wkhtmltopdf 2>/dev/null; which weasyprint 2>/dev/null; which pdfkit 2>/dev/null; npx --yes markdown-pdf --version 2>/dev/null; echo "---"; brew list pandoc 2>/dev/null; pip3 list 2>/dev/null | grep -i -E "weasy|pdf|markdown"'
  for (const command of [
    prettierProbe,
    markdownPdfProbe,
    "npx --yes unknown-package",
    "npx --yes prettier --write .",
    "pnpm dlx markdown-pdf --version",
    'cd "/Users/test/Library/Application Support/wanta/agent/process/task" && npx md-to-pdf ' +
      '"/Users/test/Library/Application Support/wanta/agent/artifacts/report.md" ' +
      '--stylesheet "/Users/test/Library/Application Support/wanta/agent/process/task/pdf-style.css" ' +
      '--output "/Users/test/Library/Application Support/wanta/agent/artifacts/report.pdf" 2>&1',
  ]) {
    assert.deepEqual(
      evaluateLocalAccessRequest(permission({ metadata: { command } }), {
        permissionMode: "default",
      }),
      { type: "allow", reason: "default_command", kind: "command", highRisk: false },
      command,
    )
  }
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: "npx --yes playwright --version" } }), {
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
    { type: "allow", reason: "session_grant", kind: "command", highRisk: false },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(
      permission({ metadata: { command: `${processRoot}/.wanta-python/bin/python -m pip install requests` } }),
      { permissionMode: "default", sessionGrants: [grant] },
    ),
    { type: "prompt", kind: "command", highRisk: false },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(
      permission({ metadata: { command: `pip3 install --break-system-packages --user openpyxl` } }),
      { permissionMode: "default", sessionGrants: [grant] },
    ),
    { type: "prompt", kind: "command", highRisk: false },
  )
})

test("task-scoped project dependency grants cover only the active project task", () => {
  const root = "/Users/example/code/wanta"
  const grant = localAccessGrantForRequest(permission({ metadata: { command: `cd ${root} && pnpm install` } }), {
    projectDependencyGenerationId: "turn-1",
    trustedProjectRoot: root,
  })

  assert.deepEqual(grant, {
    action: "bash",
    generationId: "turn-1",
    kind: "project_dependency_install",
    patterns: ["project_dependency_install"],
    projectRoot: root,
  })
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: `cd ${root} && pnpm install` } }), {
      activeGenerationId: "turn-1",
      permissionMode: "default",
      sessionGrants: grant ? [grant] : [],
      trustedProjectRoot: root,
    }),
    { type: "allow", reason: "session_grant", kind: "command", highRisk: false },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: `cd ${root} && pnpm install` } }), {
      activeGenerationId: "turn-2",
      permissionMode: "default",
      sessionGrants: grant ? [grant] : [],
      trustedProjectRoot: root,
    }),
    { type: "prompt", kind: "command", highRisk: false },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(
      permission({ metadata: { command: `cd ${root} && pnpm add left-pad --registry https://example.test` } }),
      {
        activeGenerationId: "turn-1",
        permissionMode: "default",
        sessionGrants: grant ? [grant] : [],
        trustedProjectRoot: root,
      },
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
    permission({ action: "external_directory", resources: ["/Users/example/Documents/finance"] }),
  )

  assert.ok(grant)
  assert.deepEqual(
    evaluateLocalAccessRequest(
      permission({ action: "external_directory", resources: ["/Users/example/Documents/finance/report.xlsx"] }),
      {
        permissionMode: "default",
        sessionGrants: [grant],
      },
    ),
    { type: "allow", reason: "session_grant", kind: "path", highRisk: false },
  )
})

test("generic folder grants do not cover sensitive descendants", () => {
  const grant = localAccessGrantForRequest(permission({ action: "external_directory", resources: ["/Users/example"] }))

  assert.ok(grant)
  assert.deepEqual(
    evaluateLocalAccessRequest(
      permission({ action: "external_directory", resources: ["/Users/example/Documents/report.pdf"] }),
      { permissionMode: "default", sessionGrants: [grant] },
    ),
    { type: "allow", reason: "session_grant", kind: "path", highRisk: false },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(
      permission({ action: "external_directory", resources: ["/Users/example/.ssh/id_ed25519"] }),
      { permissionMode: "default", sessionGrants: [grant] },
    ),
    { type: "prompt", kind: "path", highRisk: false },
  )
})

test("generic folder grants do not cover high-risk shell commands", () => {
  const grant = localAccessGrantForRequest(
    permission({ action: "bash", metadata: { command: "find ~/Documents -type f" }, save: ["find *"] }),
  )

  assert.ok(grant)
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: "find ~/Documents -exec cat {} \\;" } }), {
      permissionMode: "default",
      sessionGrants: [grant],
    }),
    { type: "prompt", kind: "command", highRisk: true },
  )
})

test("local access policy prompts broad shell scans but keeps specific ordinary reads smooth", () => {
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: "find ~ -type f" } }), { permissionMode: "default" }),
    { type: "prompt", kind: "command", highRisk: false },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: "cat /Users/example/Documents/brief.md" } }), {
      permissionMode: "default",
    }),
    { type: "allow", reason: "default_command", kind: "command", highRisk: false },
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
    { type: "prompt", kind: "command", highRisk: false },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: "pnpm lint" } }), {
      permissionMode: "default",
      sessionGrants: [grant],
    }),
    { type: "allow", reason: "default_command", kind: "command", highRisk: false },
  )
})
