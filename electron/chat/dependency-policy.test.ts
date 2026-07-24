import assert from "node:assert/strict"
import { test } from "vitest"
import {
  canonicalRegistryNodePackageName,
  dependencyCommandRequiresConfirmation,
  isDependencyMutationCommand,
} from "./dependency-policy.ts"

test("registry package parsing accepts names and versions but rejects alternate sources", () => {
  assert.equal(canonicalRegistryNodePackageName("xlsx"), "xlsx")
  assert.equal(canonicalRegistryNodePackageName("unknown-package@^3"), "unknown-package")
  assert.equal(canonicalRegistryNodePackageName("@scope/tool@latest"), "@scope/tool")
  assert.equal(canonicalRegistryNodePackageName("github:vendor/tool"), undefined)
  assert.equal(canonicalRegistryNodePackageName("https://example.test/tool.tgz"), undefined)
  assert.equal(canonicalRegistryNodePackageName("../local-tool"), undefined)
})

test("package names and package runners do not create confirmation boundaries", () => {
  assert.equal(dependencyCommandRequiresConfirmation("npx --yes playwright --version"), false)
  assert.equal(dependencyCommandRequiresConfirmation("npx playwright-core install chromium"), false)
  assert.equal(dependencyCommandRequiresConfirmation("npm x playwright --version"), false)
  assert.equal(dependencyCommandRequiresConfirmation("bun x playwright --version"), false)
  assert.equal(dependencyCommandRequiresConfirmation("pnpm dlx puppeteer --help"), false)
  assert.equal(dependencyCommandRequiresConfirmation("npm exec --package=@playwright/test playwright test"), false)
  assert.equal(dependencyCommandRequiresConfirmation("npx --package=playwright node -e 'console.log(1)'"), false)
  assert.equal(dependencyCommandRequiresConfirmation("npx md-to-pdf playwright --output report.pdf"), false)
  assert.equal(dependencyCommandRequiresConfirmation("npm list playwright"), false)
  assert.equal(dependencyCommandRequiresConfirmation("npm install puppeteer"), false)
  assert.equal(dependencyCommandRequiresConfirmation("npm install puppeteer-core"), false)
  assert.equal(dependencyCommandRequiresConfirmation("npm install playwright"), false)
  assert.equal(dependencyCommandRequiresConfirmation("npm install playwright-core"), false)
  assert.equal(dependencyCommandRequiresConfirmation("npx --yes markdown-pdf --version"), false)
  assert.equal(dependencyCommandRequiresConfirmation("yarn global add eslint"), true)
  assert.equal(dependencyCommandRequiresConfirmation("npx --registry https://example.test markdown-pdf"), true)
  assert.equal(dependencyCommandRequiresConfirmation("npx github:vendor/tool"), true)
  assert.equal(dependencyCommandRequiresConfirmation("npx --package=https://example.test/tool.tgz tool"), true)
  assert.equal(dependencyCommandRequiresConfirmation("npm --prefix /tmp/project publish"), true)
  assert.equal(dependencyCommandRequiresConfirmation("poetry --no-interaction publish"), true)
})

test("package runner arguments are not mistaken for alternate package sources", () => {
  const fileArguments =
    '"/Users/test/Library/Application Support/wanta/agent/artifacts/report.md" ' +
    '--stylesheet "/Users/test/Library/Application Support/wanta/agent/process/task/pdf-style.css" ' +
    '--output "/Users/test/Library/Application Support/wanta/agent/artifacts/report.pdf"'
  for (const runner of [
    "npx md-to-pdf",
    "npm exec md-to-pdf --",
    "npm x md-to-pdf --",
    "pnpm dlx md-to-pdf",
    "yarn dlx md-to-pdf",
    "bunx md-to-pdf",
    "bun x md-to-pdf",
  ]) {
    const command = `cd "/Users/test/Library/Application Support/wanta/agent/process/task" && ${runner} ${fileArguments} 2>&1`
    assert.equal(dependencyCommandRequiresConfirmation(command), false, runner)
  }
  for (const command of [
    "npx ./local-tool input.md --output output.pdf",
    "npm exec https://example.test/tool.tgz -- input.md",
    "npm x https://example.test/tool.tgz -- input.md",
    "pnpm dlx github:vendor/tool input.md",
    "yarn dlx ../local-tool input.md",
    "bunx file:../local-tool input.md",
    "bun x file:../local-tool input.md",
    "npx -p https://example.test/tool.tgz tool ./input.md",
  ]) {
    assert.equal(dependencyCommandRequiresConfirmation(command), true, command)
  }
  for (const command of [
    "npx md-to-pdf ./input.md --output ./output.pdf",
    "npx md-to-pdf input.md --registry ./document-metadata.json",
    "npm exec md-to-pdf -- input.md --registry https://example.test",
    "pnpm dlx md-to-pdf input.md --package=playwright",
  ]) {
    assert.equal(dependencyCommandRequiresConfirmation(command), false, command)
  }
  for (const command of [
    "npx --registry https://example.test md-to-pdf input.md",
    "npm exec --registry=https://example.test md-to-pdf -- input.md",
    "pnpm --registry https://example.test dlx md-to-pdf input.md",
  ]) {
    assert.equal(dependencyCommandRequiresConfirmation(command), true, command)
  }
})

test("dependency mutations are classified independently from shell composition", () => {
  assert.equal(isDependencyMutationCommand("npm install xlsx"), true)
  assert.equal(isDependencyMutationCommand("cd /tmp && pnpm add unknown-package | tail -5"), true)
  assert.equal(isDependencyMutationCommand("python3 -m pip install weasyprint"), true)
  assert.equal(isDependencyMutationCommand("uv pip install markdown"), true)
  assert.equal(isDependencyMutationCommand("npm test"), false)
  assert.equal(isDependencyMutationCommand("npx --yes markdown-pdf --version"), false)
  assert.equal(dependencyCommandRequiresConfirmation("npm --global install eslint"), true)
})

test("dependency option values are not mistaken for package sources or costly packages", () => {
  for (const command of [
    "npm --prefix /tmp/project install xlsx",
    "npm install xlsx --cache /tmp/npm-cache",
    "pnpm add xlsx --store-dir /tmp/pnpm-store",
    "yarn add xlsx --cache-dir /tmp/yarn-cache",
    "pip install weasyprint --target /tmp/python-target",
    "python3 -m pip install weasyprint --report /tmp/install-report.json",
    "uv pip install weasyprint --python /tmp/venv/bin/python",
  ]) {
    assert.equal(isDependencyMutationCommand(command), true, command)
    assert.equal(dependencyCommandRequiresConfirmation(command), false, command)
  }
  assert.equal(dependencyCommandRequiresConfirmation("npm install xlsx --prefix playwright"), false)
  assert.equal(dependencyCommandRequiresConfirmation("pip install /tmp/local-package --target /tmp/target"), true)
  assert.equal(dependencyCommandRequiresConfirmation("pnpm --dir /tmp/project add ../local-package"), true)
  assert.equal(dependencyCommandRequiresConfirmation("npm --registry https://example.test install xlsx"), true)
  assert.equal(dependencyCommandRequiresConfirmation("pip --index-url https://example.test/simple install xlsx"), true)
})

test("command composition and environment prefixes do not hide dependency boundaries", () => {
  assert.equal(isDependencyMutationCommand("NODE_ENV=test npm --prefix /tmp/project install xlsx"), true)
  assert.equal(isDependencyMutationCommand("env NODE_ENV=test pnpm --dir /tmp/project add xlsx"), true)
  assert.equal(isDependencyMutationCommand("echo ready & npm install xlsx"), true)
  assert.equal(dependencyCommandRequiresConfirmation("echo ready & npm --global install eslint"), true)
  assert.equal(dependencyCommandRequiresConfirmation("bash -lc 'npm --global install eslint'"), true)
  assert.equal(isDependencyMutationCommand("zsh -c 'python3 -m pip install weasyprint'"), true)
  assert.equal(dependencyCommandRequiresConfirmation("node -e 'console.log(\"npm publish\")'"), false)
  assert.equal(dependencyCommandRequiresConfirmation("npm exec echo -- publish"), false)
  assert.equal(dependencyCommandRequiresConfirmation("bun exec 'echo playwright'"), false)
})
