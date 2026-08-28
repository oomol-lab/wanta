import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(dirname, "..")
const packageJsonPath = path.join(repoRoot, "package.json")
const pnpmLockPath = path.join(repoRoot, "pnpm-lock.yaml")

interface PackageManifest {
  bugs?: { url?: string }
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  engines?: { node?: string }
  homepage?: string
  license?: string
  packageManager?: string
  repository?: { type?: string; url?: string }
  scripts?: Record<string, string>
}

describe("open-source installation contract", () => {
  const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageManifest
  const lockfile = readFileSync(pnpmLockPath, "utf8")

  test("declares public project and toolchain metadata", () => {
    expect(manifest.license).toBe("Apache-2.0")
    expect(manifest.repository).toEqual({
      type: "git",
      url: "git+https://github.com/oomol-lab/wanta.git",
    })
    expect(manifest.homepage).toBe("https://wanta.ai/")
    expect(manifest.bugs?.url).toBe("https://github.com/oomol-lab/wanta/issues")
    expect(manifest.engines?.node).toBe(">=22.22.2")
    expect(manifest.packageManager).toBe("pnpm@11.23.0")
  })

  test("does not depend on a repository-local private npm registry", () => {
    const npmrc = readFileSync(path.join(repoRoot, ".npmrc"), "utf8")
    expect(npmrc).not.toContain("npm.pkg.github.com")
    expect(npmrc).not.toContain("_authToken")
    expect(npmrc).toContain("@oomol:registry=https://registry.npmjs.org/")
    expect(existsSync(path.join(repoRoot, "package-lock.json"))).toBe(false)
    expect(lockfile).not.toContain("npm.pkg.github.com")
    expect(lockfile).not.toContain("_authToken")
    expect(lockfile).toContain("@oomol/connection@0.2.28")
    expect(lockfile).toContain("@oomol/connection-electron-adapter@0.2.12(@oomol/connection@0.2.28)")
    expect(lockfile).toContain("resolution: {integrity:")
  })

  test("keeps oo in the default install and packaging paths", () => {
    expect(manifest.scripts?.postinstall).toContain("scripts/download-oo.ts")
    expect(manifest.scripts?.predev).toContain("scripts/check-oo.ts")
    expect(manifest.scripts?.["prepare:binaries"]).toContain("scripts/prepare-binaries.ts")
    for (const scriptName of ["build:electron", "build:mac", "build:win", "build:linux"]) {
      expect(manifest.scripts?.[scriptName]).toContain("pnpm run prepare:binaries")
    }
  })

  test("documents OpenCode and packages release notices", () => {
    const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8")
    const notices = readFileSync(path.join(repoRoot, "THIRD_PARTY_NOTICES.md"), "utf8")
    const builderConfig = readFileSync(path.join(repoRoot, "electron-builder.ts"), "utf8")

    expect(manifest.devDependencies?.["opencode-ai"]).toBe("1.18.21")
    expect(manifest.devDependencies?.["@opencode-ai/plugin"]).toBe("1.18.21")
    expect(manifest.dependencies?.["@opencode-ai/sdk"]).toBe("1.18.21")
    expect(readme).toContain("Agent Engine: OpenCode")
    expect(readme).toContain("opencode-ai@1.18.21")
    expect(notices).toContain("@opencode-ai/sdk@1.18.21")
    expect(notices).toContain("@agentclientprotocol/codex-acp@1.6.2")
    expect(notices).toContain("@agentclientprotocol/claude-agent-acp@0.70.0")
    expect(notices).toContain("@oomol-lab/oo-cli@1.7.12")
    for (const fileName of ["LICENSE", "NOTICE", "TRADEMARKS.md", "THIRD_PARTY_NOTICES.md"]) {
      expect(existsSync(path.join(repoRoot, fileName))).toBe(true)
      expect(builderConfig).toContain(`from: "${fileName}"`)
    }
  })
})
