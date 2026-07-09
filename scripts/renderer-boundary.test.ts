import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "vitest"

const dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(dirname, "..")
const srcDir = path.join(rootDir, "src")

const rendererElectronAllowlist = new Set([
  "electron/agent/mode.ts",
  "electron/agent/reasoning.ts",
  "electron/app-command.ts",
  "electron/attachment-picker.ts",
  "electron/branding.ts",
  "electron/chat/authorization-signal.ts",
  "electron/chat/error.ts",
  "electron/chat/permission-request.ts",
  "electron/connections/domain.ts",
  "electron/connections/executions.ts",
  "electron/connections/federated.ts",
  "electron/connections/summary-model.ts",
  "electron/connections/summary.ts",
  "electron/connections/usage.ts",
  "electron/domain.ts",
  "electron/models/builtin.ts",
  "electron/models/limits.ts",
  "electron/session/title.ts",
  "electron/skills/actions.ts",
])

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        return collectSourceFiles(fullPath)
      }
      return /\.(?:ts|tsx)$/.test(entry.name) && !/\.test\.(?:ts|tsx)$/.test(entry.name) ? [fullPath] : []
    }),
  )
  return files.flat()
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  const importPattern =
    /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g
  for (const match of source.matchAll(importPattern)) {
    specifiers.push(match[1] ?? match[2] ?? "")
  }
  return specifiers.filter(Boolean)
}

function relativeRepoPath(filePath: string): string {
  return path.relative(rootDir, filePath).split(path.sep).join("/")
}

function rendererElectronTarget(filePath: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) {
    return null
  }
  const resolved = path.relative(rootDir, path.resolve(path.dirname(filePath), specifier))
  const normalized = resolved.split(path.sep).join("/")
  return normalized.startsWith("electron/") ? normalized : null
}

function isAllowedRendererElectronTarget(target: string): boolean {
  return /^electron\/[^/]+\/common\.ts$/.test(target) || rendererElectronAllowlist.has(target)
}

test("renderer imports only explicit pure electron modules", async () => {
  const violations: string[] = []
  const importedElectronTargets = new Set<string>()
  for (const file of await collectSourceFiles(srcDir)) {
    const source = await readFile(file, "utf-8")
    for (const specifier of importSpecifiers(source)) {
      if (specifier === "electron" || specifier.startsWith("node:")) {
        violations.push(`${relativeRepoPath(file)} imports runtime module ${specifier}`)
      }
      const target = rendererElectronTarget(file, specifier)
      if (!target) {
        continue
      }
      importedElectronTargets.add(target)
      if (!isAllowedRendererElectronTarget(target)) {
        violations.push(`${relativeRepoPath(file)} imports ${target}`)
      }
    }
  }

  assert.deepEqual(violations, [])

  const impureImports: string[] = []
  for (const target of [...importedElectronTargets].sort()) {
    const source = await readFile(path.join(rootDir, target), "utf-8")
    for (const specifier of importSpecifiers(source)) {
      if (specifier === "electron" || specifier.startsWith("node:")) {
        impureImports.push(`${target} imports ${specifier}`)
      }
    }
  }

  assert.deepEqual(impureImports, [])
})
