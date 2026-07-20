import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(dirname, "..")
const packageJsonPath = path.join(repoRoot, "package.json")
const packageLockPath = path.join(repoRoot, "package-lock.json")

interface PackageManifest {
  bugs?: { url?: string }
  engines?: { node?: string }
  homepage?: string
  license?: string
  packageManager?: string
  repository?: { type?: string; url?: string }
  scripts?: Record<string, string>
}

describe("open-source installation contract", () => {
  const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageManifest
  const lockfile = readFileSync(packageLockPath, "utf8")

  test("declares public project and toolchain metadata", () => {
    expect(manifest.license).toBe("Apache-2.0")
    expect(manifest.repository).toEqual({
      type: "git",
      url: "git+https://github.com/oomol-lab/wanta.git",
    })
    expect(manifest.homepage).toBe("https://wanta.ai/")
    expect(manifest.bugs?.url).toBe("https://github.com/oomol-lab/wanta/issues")
    expect(manifest.engines?.node).toBe(">=22.22.2")
    expect(manifest.packageManager).toBe("npm@10.9.4")
  })

  test("does not depend on a repository-local private npm registry", () => {
    expect(existsSync(path.join(repoRoot, ".npmrc"))).toBe(false)
    expect(lockfile).not.toContain("npm.pkg.github.com")
    expect(lockfile).not.toContain("_authToken")
    expect(lockfile).toContain("https://registry.npmjs.org/@oomol/connection/-/")
    expect(lockfile).toContain("https://registry.npmjs.org/@oomol/connection-electron-adapter/-/")
  })

  test("keeps oo in the default install and packaging paths", () => {
    expect(manifest.scripts?.postinstall).toContain("scripts/download-oo.ts")
    expect(manifest.scripts?.predev).toContain("scripts/check-oo.ts")
    expect(manifest.scripts?.["prepare:binaries"]).toContain("scripts/prepare-binaries.ts")
    for (const scriptName of ["build:electron", "build:mac", "build:win", "build:linux"]) {
      expect(manifest.scripts?.[scriptName]).toContain("npm run prepare:binaries")
    }
  })
})
