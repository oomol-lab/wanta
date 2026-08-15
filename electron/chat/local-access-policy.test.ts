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
      linkRuntime: "oomol",
      permissionMode: "default",
    }),
    { type: "allow", reason: "oo_cli", kind: "command", highRisk: false },
  )
})

test("OpenCode, Claude, and ACP agents share the guarded OOCLI allow path", () => {
  const command =
    'oo connector run "posthog" --action "list_projects" --data \'{}\' --json --team "OOMOL-Internal" 2>&1 | head -100'
  const requests = [
    permission({ metadata: { command } }),
    permission({ action: "Bash", metadata: { toolInput: { command } } }),
    permission({ action: "Run command", metadata: { rawInput: { command } } }),
  ]

  assert.deepEqual(evaluateLocalAccessRequest(requests[0]!, { linkRuntime: "oomol", permissionMode: "default" }), {
    type: "allow",
    reason: "oo_cli",
    kind: "command",
    highRisk: false,
  })
  for (const request of requests.slice(1)) {
    assert.deepEqual(
      evaluateLocalAccessRequest(request, {
        isExternalSession: true,
        linkRuntime: "oomol",
        permissionMode: "default",
      }),
      { type: "allow", reason: "oo_cli", kind: "command", highRisk: false },
    )
  }
})

test("external-agent OOCLI parity stays narrow and fails closed", () => {
  for (const command of [
    "oo auth login",
    "oo connector logout",
    "oo connector apps --connector-token secret",
    'oo connector run "posthog" --action "list_projects" --json | tee /tmp/projects.json',
    'oo connector run "posthog" --action "list_projects" --json && echo done',
    'oo connector run "posthog" --action "list_projects" --json > /tmp/projects.json',
    'oo connector run "posthog" --action "list_projects" --json | cat ~/.ssh/id_rsa',
  ]) {
    assert.equal(
      evaluateLocalAccessRequest(permission({ metadata: { command } }), {
        isExternalSession: true,
        linkRuntime: "oomol",
        permissionMode: "default",
      }).type,
      "prompt",
      command,
    )
  }
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: "oo connector apps --json | head -20" } }), {
      isExternalSession: true,
      permissionMode: "default",
    }),
    { type: "prompt", kind: "command", highRisk: false },
  )
})

test("external-agent oo_cli auto-approve requires an active Link runtime, not the truthy 'none'", () => {
  // "none" is the production default when no Link runtime is connected and is a
  // truthy string; it must NOT satisfy the oo_cli gate, or a BYOA agent could run
  // the user's own unguarded oo binary with no approval card.
  assert.deepEqual(
    evaluateLocalAccessRequest(
      permission({ metadata: { command: "oo connector run gmail --action send_email --json" } }),
      { isExternalSession: true, linkRuntime: "none", permissionMode: "default" },
    ),
    { type: "prompt", kind: "command", highRisk: false },
  )
  // With a real runtime the same command still auto-approves (parity preserved).
  assert.equal(
    evaluateLocalAccessRequest(
      permission({ metadata: { command: "oo connector run gmail --action send_email --json" } }),
      { isExternalSession: true, linkRuntime: "oomol", permissionMode: "default" },
    ).type,
    "allow",
  )
})

test("external agents auto-approve Wanta host MCP dispatch without weakening native local permissions", () => {
  assert.deepEqual(
    evaluateLocalAccessRequest(
      permission({ action: "permission", metadata: { toolCallId: "call-1", wantaHostTool: "call_action" } }),
      { isExternalSession: true, permissionMode: "default" },
    ),
    { type: "allow", reason: "wanta_host_tool", kind: "local", highRisk: false },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(
      permission({
        action: "mcp.wanta_link.call_action",
        metadata: {
          rawInput: {
            server: "wanta_link",
            tool: "call_action",
            arguments: { service: "posthog", action: "list_projects" },
          },
        },
      }),
      { isExternalSession: true, permissionMode: "default" },
    ),
    { type: "prompt", kind: "local", highRisk: false },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ action: "permission", metadata: { rawInput: { tool: "call_action" } } }), {
      isExternalSession: true,
      permissionMode: "default",
    }),
    { type: "prompt", kind: "local", highRisk: false },
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

test("local access policy allows direct and standard wrapped oo commands under OpenConnector", () => {
  for (const command of [
    "oo connector apps --json",
    "bash -c 'oo connector apps --json'",
    "/bin/bash -c 'oo connector apps --json'",
    "sh -lc 'oo connector apps --json'",
    'cmd.exe /c "oo connector apps --json"',
    "cmd /c oo connector apps --json",
    'pwsh -Command "oo connector apps --json"',
  ]) {
    assert.deepEqual(
      evaluateLocalAccessRequest(permission({ metadata: { command } }), {
        linkRuntime: "openconnector",
        permissionMode: "full_access",
      }),
      { type: "allow", reason: "oo_cli", kind: "command", highRisk: false },
      command,
    )
  }
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: "oo connector run gmail list --json" } }), {
      linkRuntime: "openconnector",
      permissionMode: "default",
    }),
    { type: "allow", reason: "oo_cli", kind: "command", highRisk: false },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: "zsh -c 'cd /tmp && oo connector apps --json'" } }), {
      linkRuntime: "openconnector",
      permissionMode: "default",
    }),
    { type: "allow", reason: "default_command", kind: "command", highRisk: false },
  )
  for (const command of ["oo connector apps --json 2>&1", "oo connector apps --json 2>&1 | head -80"]) {
    assert.deepEqual(
      evaluateLocalAccessRequest(permission({ metadata: { command } }), {
        linkRuntime: "openconnector",
        permissionMode: "default",
      }),
      { type: "allow", reason: "oo_cli", kind: "command", highRisk: false },
      command,
    )
  }
})

test("local access policy does not prompt only because shell wrapper syntax is not fully modeled", () => {
  for (const command of ["bash -c '$SHELL_COMMAND'", "bash script.sh", "cmd /c %SHELL_COMMAND%"]) {
    assert.deepEqual(
      evaluateLocalAccessRequest(permission({ metadata: { command } }), {
        linkRuntime: "openconnector",
        permissionMode: "full_access",
      }),
      { type: "allow", reason: "full_access", kind: "command", highRisk: false },
      command,
    )
  }
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: "bash script.sh" } }), {
      linkRuntime: "openconnector",
      permissionMode: "default",
    }),
    { type: "allow", reason: "default_command", kind: "command", highRisk: false },
  )
})

test("full access auto-approves local oo commands even without an active Link runtime", () => {
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: "oo connector apps --json" } }), {
      permissionMode: "full_access",
    }),
    { type: "allow", reason: "full_access", kind: "command", highRisk: false },
  )
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
    "bash -ec 'oo auth login'",
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

test("default access auto-approves direct Python requirements in bounded task or project environments", () => {
  const processRoot = "/tmp/wanta-process/task-1"
  const projectRoot = "/Users/example/code/customer-project"
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
        metadata: {
          command:
            `python3 -m venv "${processRoot}/.wanta-python" 2>&1 && ` +
            `"${processRoot}/.wanta-python/bin/python" -m pip install python-docx`,
        },
      }),
      { permissionMode: "default", taskProcessRoot: processRoot },
    ),
    { type: "allow", reason: "trusted_dependency", kind: "command", highRisk: false },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(
      permission({
        metadata: {
          command:
            `python3 -m venv "${processRoot}/.wanta-python" && ` +
            `"${processRoot}/.wanta-python/bin/python" -m pip install python-docx 2>&1`,
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
  for (const command of [
    `${projectRoot}/.venv/bin/python -m pip install --compile 'pandas>=2'`,
    `${projectRoot}/venv/bin/python3 -m pip install --use-feature fast-deps weasyprint`,
    `uv pip install --python ${projectRoot}/.venv/bin/python pypdf`,
    `uv pip install --python=${projectRoot}/venv/bin/python3 reportlab`,
  ]) {
    assert.deepEqual(
      evaluateLocalAccessRequest(permission({ metadata: { command } }), {
        permissionMode: "default",
        trustedProjectRoot: projectRoot,
      }),
      { type: "allow", reason: "trusted_dependency", kind: "command", highRisk: false },
      command,
    )
  }
  assert.deepEqual(
    evaluateLocalAccessRequest(
      permission({
        metadata: {
          command:
            `cd "${projectRoot}" && python3 -m venv .venv && ` + `.venv/bin/python -m pip install python-docx 2>&1`,
        },
      }),
      { permissionMode: "default", trustedProjectRoot: projectRoot },
    ),
    { type: "allow", reason: "trusted_dependency", kind: "command", highRisk: false },
  )
  for (const command of [
    "pip install pandas",
    "python3 -m pip install pandas",
    `${projectRoot}/.venv/bin/python -m pip install --user pandas`,
    `${projectRoot}/.venv/bin/python -m pip install -r requirements.txt`,
    `${projectRoot}/.venv/bin/python -m pip install git+https://example.test/package.git`,
    `uv pip install --python /tmp/other/.venv/bin/python pandas`,
  ]) {
    assert.deepEqual(
      evaluateLocalAccessRequest(permission({ metadata: { command } }), {
        permissionMode: "default",
        trustedProjectRoot: projectRoot,
      }),
      {
        type: "prompt",
        kind: "command",
        highRisk: command.includes("git+"),
      },
      command,
    )
  }
})

test("bounded Python bootstrap approval preserves the nearest protected boundaries", () => {
  const processRoot = "/tmp/wanta-process/task-1"
  const environment = `${processRoot}/.wanta-python`
  const context = { permissionMode: "default" as const, taskProcessRoot: processRoot }
  const promptCommands = [
    `python3 -m venv "${processRoot}/other" && "${environment}/bin/python" -m pip install python-docx`,
    `python3 -m venv "${environment}" && python3 -m pip install python-docx`,
    `"${environment}/bin/python" -m pip install python-docx > /tmp/install.log`,
  ]
  for (const command of promptCommands) {
    assert.deepEqual(
      evaluateLocalAccessRequest(permission({ metadata: { command } }), context),
      { type: "prompt", kind: "command", highRisk: false },
      command,
    )
  }

  const alternateSource =
    `python3 -m venv "${environment}" && ` +
    `"${environment}/bin/python" -m pip install python-docx --index-url https://example.test/simple`
  assert.deepEqual(evaluateLocalAccessRequest(permission({ metadata: { command: alternateSource } }), context), {
    type: "prompt",
    kind: "command",
    highRisk: true,
  })

  const destructiveSuffix =
    `python3 -m venv "${environment}" && ` +
    `"${environment}/bin/python" -m pip install python-docx && rm -rf /tmp/install-work`
  assert.deepEqual(evaluateLocalAccessRequest(permission({ metadata: { command: destructiveSuffix } }), context), {
    type: "prompt",
    kind: "command",
    highRisk: true,
  })
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
  for (const packageName of [
    "playwright",
    "playwright-core",
    "@playwright/test",
    "puppeteer",
    "puppeteer-core",
    "canvas",
  ]) {
    assert.deepEqual(
      evaluateLocalAccessRequest(
        permission({ metadata: { command: `cd ${processRoot} && npm install ${packageName} 2>&1 | tail -5` } }),
        {
          permissionMode: "default",
          taskProcessRoot: processRoot,
        },
      ),
      { type: "allow", reason: "trusted_dependency", kind: "command", highRisk: false },
      packageName,
    )
  }
})

test("default access applies one scope-and-boundary policy across Node.js and Python", () => {
  const projectRoot = "/Users/example/code/customer-project"
  const context = { permissionMode: "default" as const, trustedProjectRoot: projectRoot }
  for (const command of [
    `cd ${projectRoot} && npm install --unknown-option report-tool`,
    `${projectRoot}/.venv/bin/python -m pip install --compile report-tool`,
    `cd ${projectRoot} && .venv/bin/python -m pip install report-tool 2>&1 | tail -5`,
    `uv --no-progress pip install --python=${projectRoot}/.venv/bin/python report-tool 2>&1 | tail -5`,
  ]) {
    assert.deepEqual(
      evaluateLocalAccessRequest(permission({ metadata: { command } }), context),
      { type: "allow", reason: "trusted_dependency", kind: "command", highRisk: false },
      command,
    )
  }
  for (const command of ["npm install report-tool", "pip install report-tool"]) {
    assert.deepEqual(
      evaluateLocalAccessRequest(permission({ metadata: { command } }), context),
      { type: "prompt", kind: "command", highRisk: false },
      command,
    )
  }
  for (const command of ["pipx install black", "uv tool install ruff"]) {
    assert.deepEqual(
      evaluateLocalAccessRequest(permission({ metadata: { command } }), context),
      { type: "prompt", kind: "command", highRisk: false },
      command,
    )
  }
  for (const command of [
    `cd ${projectRoot} && npm install report-tool --registry https://example.test`,
    `${projectRoot}/.venv/bin/python -m pip install report-tool --index-url https://example.test/simple`,
  ]) {
    assert.deepEqual(
      evaluateLocalAccessRequest(permission({ metadata: { command } }), context),
      { type: "prompt", kind: "command", highRisk: true },
      command,
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
    "uvx ruff --version",
    "pipx run black --version",
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
    { type: "allow", reason: "default_command", kind: "command", highRisk: false },
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

test("local access policy allows requests in full access mode", () => {
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: "rm -rf /tmp/wanta-test" } }), {
      permissionMode: "full_access",
    }),
    { type: "allow", reason: "full_access", kind: "command", highRisk: true },
  )
})

test("default access auto-approves low-consequence generated-output cleanup", () => {
  const taskProcessRoot = "/tmp/wanta/process/turn-1"
  const trustedProjectRoot = "/Users/example/code/app"
  for (const command of [
    `rm -rf ${taskProcessRoot}/scratch`,
    `cd ${trustedProjectRoot} && rm -rf dist`,
    `rm -rf ${trustedProjectRoot}/node_modules`,
  ]) {
    assert.deepEqual(
      evaluateLocalAccessRequest(permission({ metadata: { command } }), {
        permissionMode: "default",
        taskProcessRoot,
        trustedProjectRoot,
      }),
      { type: "allow", reason: "bounded_cleanup", kind: "command", highRisk: true },
      command,
    )
  }

  for (const command of [`rm -rf ${trustedProjectRoot}`, `rm -rf ${trustedProjectRoot}/src`]) {
    assert.deepEqual(
      evaluateLocalAccessRequest(permission({ metadata: { command } }), {
        permissionMode: "default",
        taskProcessRoot,
        trustedProjectRoot,
      }),
      { type: "prompt", kind: "command", highRisk: true },
      command,
    )
  }
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

test("generic folder grants distinguish read-only and destructive find execution", () => {
  const grant = localAccessGrantForRequest(
    permission({ action: "bash", metadata: { command: "find ~/Documents -type f" }, save: ["find *"] }),
  )

  assert.ok(grant)
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: "find ~/Documents -exec cat {} \\;" } }), {
      permissionMode: "default",
      sessionGrants: [grant],
    }),
    { type: "allow", reason: "session_grant", kind: "command", highRisk: false },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: "find ~/Documents -exec rm -rf {} \\;" } }), {
      permissionMode: "default",
      sessionGrants: [grant],
    }),
    { type: "prompt", kind: "command", highRisk: true },
  )
})

test("local access policy auto-approves broad non-sensitive reads", () => {
  for (const command of [
    "find ~ -type f",
    "find ~ | head -20",
    "ls -R ~ | head -20",
    'bash -lc "find ~ -maxdepth 2"',
  ]) {
    assert.deepEqual(
      evaluateLocalAccessRequest(permission({ metadata: { command } }), { permissionMode: "default" }),
      { type: "allow", reason: "default_command", kind: "command", highRisk: false },
      command,
    )
  }
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: "ls ~ | head -20" } }), {
      permissionMode: "default",
    }),
    { type: "allow", reason: "default_command", kind: "command", highRisk: false },
  )
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ metadata: { command: "cat /Users/example/Documents/brief.md" } }), {
      permissionMode: "default",
    }),
    { type: "allow", reason: "default_command", kind: "command", highRisk: false },
  )
})

test("local access policy allows broad path reads but still prompts broad edits", () => {
  for (const resource of [
    "/home",
    "/home/alice",
    "/root",
    "/var",
    "C:\\Users",
    "C:\\Users\\Alice",
    "C:\\Windows",
    "D:\\Program Files",
  ]) {
    assert.deepEqual(
      evaluateLocalAccessRequest(permission({ action: "external_directory", resources: [resource] }), {
        permissionMode: "default",
      }),
      { type: "allow", reason: "default_local", kind: "path", highRisk: false },
      resource,
    )
  }

  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ action: "edit", resources: ["/Users/example"] }), {
      permissionMode: "default",
    }),
    { type: "prompt", kind: "edit", highRisk: false },
  )

  assert.deepEqual(
    evaluateLocalAccessRequest(
      permission({ action: "external_directory", resources: ["C:\\Users\\Alice\\Documents"] }),
      { permissionMode: "default" },
    ),
    { type: "allow", reason: "default_local", kind: "path", highRisk: false },
  )
})

test("local access policy auto-approves the two recorded PostHog report heredoc workflows", () => {
  const processRoot = "/Users/example/Library/Application Support/wanta/agent/process/session-1/turn-1"
  const artifactRoot = "/Users/example/Library/Application Support/wanta/agent/artifacts/session-1/turn-1"
  for (const command of [
    `cd "${processRoot}/queries" && python3 <<'EOF'\n# model = monthly_new / (1 - retention)\nnew_share = 10000 / total_active\nEOF`,
    `cat > "${processRoot}/gen_retention_report.py" <<'PYEOF'\nsummary = "fetch_emails / create_page / query"\nratio = "25% / 5%"\nout = "${artifactRoot}/report.html"\nPYEOF\npython3 "${processRoot}/gen_retention_report.py"`,
  ]) {
    assert.deepEqual(
      evaluateLocalAccessRequest(permission({ metadata: { command } }), {
        permissionMode: "default",
        taskProcessRoot: processRoot,
      }),
      { type: "allow", reason: "default_command", kind: "command", highRisk: false },
      command,
    )
  }
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

// External (BYOA) sessions: permission policy is owned by the agent's own
// CLI (linkcode-style pass-through). Every ask the agent surfaces reaches the
// user; the only automatic answers are the user's explicit session grants.

const EXTERNAL_ROOT = path.join("/tmp", "wanta-agent-external", "claude-code", "uuid-1")

test("external sessions prompt for file writes even inside the scratch cwd", () => {
  // The agent asking means its own policy wants explicit approval; Wanta must
  // not answer on its behalf, not even inside the session's working directory.
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ action: "Write", resources: [path.join(EXTERNAL_ROOT, "hello.txt")] }), {
      permissionMode: "default",
      isExternalSession: true,
    }),
    { type: "prompt", kind: "edit", highRisk: false },
  )
})

test("external sessions prompt for edits inside the trusted project root", () => {
  const projectRoot = path.join("/tmp", "my-project")
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ action: "Edit", resources: [path.join(projectRoot, "src", "index.ts")] }), {
      permissionMode: "default",
      isExternalSession: true,
      trustedProjectRoot: projectRoot,
    }),
    { type: "prompt", kind: "edit", highRisk: false },
  )
})

test("external sessions prompt for commands instead of the blanket default allow", () => {
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ action: "Bash", metadata: { command: "echo hi > ~/anywhere" } }), {
      permissionMode: "default",
      isExternalSession: true,
    }),
    { type: "prompt", kind: "command", highRisk: false },
  )
})

test("external Bash cannot spoof a Wanta host tool through raw MCP metadata", () => {
  assert.deepEqual(
    evaluateLocalAccessRequest(
      permission({
        action: "Bash",
        metadata: { command: "echo hi", rawInput: { server: "wanta_link", tool: "call_action" } },
      }),
      { permissionMode: "default", isExternalSession: true },
    ),
    { type: "prompt", kind: "command", highRisk: false },
  )
})

test("external sessions prompt even in full access mode", () => {
  // full_access projects onto the agent's own bypass mode, so the agent stops
  // asking on its own; an ask that still arrives is surfaced, never answered.
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ action: "Bash", metadata: { command: "echo hi" } }), {
      permissionMode: "full_access",
      isExternalSession: true,
    }),
    { type: "prompt", kind: "command", highRisk: false },
  )
})

test("external sessions honor the user's explicit session grants", () => {
  const request = permission({ action: "Write", resources: [path.join(EXTERNAL_ROOT, "hello.txt")] })
  const grant = localAccessGrantForRequest(request)
  assert.ok(grant)
  assert.deepEqual(
    evaluateLocalAccessRequest(request, {
      permissionMode: "default",
      isExternalSession: true,
      sessionGrants: [grant],
    }),
    { type: "allow", reason: "session_grant", kind: "edit", highRisk: false },
  )
})

test("external session grants cannot cross sensitive or high-risk boundaries", () => {
  const sensitive = permission({ action: "Read", resources: ["/Users/someone/.aws/credentials"] })
  const sensitiveGrant = localAccessGrantForRequest(sensitive)
  assert.ok(sensitiveGrant)
  assert.deepEqual(
    evaluateLocalAccessRequest(sensitive, {
      permissionMode: "default",
      isExternalSession: true,
      sessionGrants: [sensitiveGrant],
    }),
    { type: "prompt", kind: "local", highRisk: false },
  )

  const highRisk = permission({ action: "Bash", metadata: { command: "rm -rf /Users/someone/project" } })
  const highRiskGrant = localAccessGrantForRequest(highRisk)
  assert.ok(highRiskGrant)
  assert.deepEqual(
    evaluateLocalAccessRequest(highRisk, {
      permissionMode: "default",
      isExternalSession: true,
      sessionGrants: [highRiskGrant],
    }),
    { type: "prompt", kind: "command", highRisk: true },
  )
})

test("external sessions with no resolvable context still fail closed to a prompt", () => {
  assert.deepEqual(
    evaluateLocalAccessRequest(permission({ action: "Write", resources: ["/tmp/anywhere.txt"] }), {
      permissionMode: "default",
      isExternalSession: true,
    }),
    { type: "prompt", kind: "edit", highRisk: false },
  )
})
