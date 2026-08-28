import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { EXTERNAL_OO_OPERATIONS } from "../electron/agent/external/oo-capability-contract.ts"
import { OO_CLI_VERSION } from "./oo-cli.ts"
import { bundledOoSkillHashes, bundledSkillsDir, skillCompatibilityDir } from "./skills.ts"

interface Manifest {
  agentFormat: string
  files: Record<string, string>
  ooCliVersion: string
  requiredOperations: string[]
}

const dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(dirname, "..")
const manifestPath = path.join(skillCompatibilityDir, "oo.json")
const accept = process.argv.includes("--accept")
const json = process.argv.includes("--json")

const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest
const actualFiles = await bundledOoSkillHashes(bundledSkillsDir)
const expectedNames = Object.keys(manifest.files).sort()
const actualNames = Object.keys(actualFiles).sort()
const added = actualNames.filter((name) => !manifest.files[name])
const removed = expectedNames.filter((name) => !actualFiles[name])
const changed = actualNames.filter(
  (name) => manifest.files[name] !== undefined && manifest.files[name] !== actualFiles[name],
)
const knownOperations = new Map<string, (typeof EXTERNAL_OO_OPERATIONS)[number]>(
  EXTERNAL_OO_OPERATIONS.map((operation) => [operation.id, operation]),
)
const operations = manifest.requiredOperations.map((id) => ({
  id,
  availability: knownOperations.get(id)?.availability ?? "missing",
}))
const missingOperations = operations.filter((operation) => operation.availability === "missing")
const versionChanged = manifest.ooCliVersion !== OO_CLI_VERSION || manifest.agentFormat !== "universal"
const compatible =
  !versionChanged &&
  added.length === 0 &&
  removed.length === 0 &&
  changed.length === 0 &&
  missingOperations.length === 0
const report = {
  compatible,
  expected: { agentFormat: manifest.agentFormat, ooCliVersion: manifest.ooCliVersion },
  actual: { agentFormat: "universal", ooCliVersion: OO_CLI_VERSION },
  files: { added, changed, removed },
  operations,
}

if (accept) {
  if (missingOperations.length > 0) {
    throw new Error(`cannot accept unknown required operations: ${missingOperations.map((item) => item.id).join(", ")}`)
  }
  const next: Manifest = {
    ooCliVersion: OO_CLI_VERSION,
    agentFormat: "universal",
    files: actualFiles,
    requiredOperations: manifest.requiredOperations,
  }
  await writeFile(manifestPath, `${JSON.stringify(next, null, 2)}\n`, "utf8")
  process.stdout.write(
    `Accepted OO Skill compatibility for ${OO_CLI_VERSION} at ${path.relative(repoRoot, manifestPath)}\n`,
  )
  process.exit(0)
}

if (json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} else {
  process.stdout.write(`OO Skill compatibility: ${compatible ? "compatible" : "review required"}\n`)
  process.stdout.write(`Version: ${manifest.ooCliVersion} -> ${OO_CLI_VERSION}\n`)
  if (added.length > 0) process.stdout.write(`Added files: ${added.join(", ")}\n`)
  if (removed.length > 0) process.stdout.write(`Removed files: ${removed.join(", ")}\n`)
  if (changed.length > 0) process.stdout.write(`Changed files: ${changed.join(", ")}\n`)
  process.stdout.write("Required operations:\n")
  for (const operation of operations) process.stdout.write(`- ${operation.id}: ${operation.availability}\n`)
}
if (!compatible) process.exitCode = 1
