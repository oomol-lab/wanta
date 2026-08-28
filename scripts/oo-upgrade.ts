import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { EXTERNAL_OO_OPERATIONS } from "../electron/agent/external/oo-capability-contract.ts"
import { downloadOoBinary, downloadOoBinaryVersion, OO_CLI_VERSION } from "./oo-cli.ts"
import {
  detectOoSkillCommands,
  requiredOperationsForCommands,
  renderOoUpgradeMarkdown,
  unknownRequiredOperations,
  updateOoCliVersionSource,
} from "./oo-upgrade-review-core.ts"
import {
  bundledOoSkillHashes,
  bundledSkillsDir,
  exportBundledSkills,
  installBundledOoSkillsFromBinary,
  skillLockDir,
} from "./skills.ts"

interface OoSkillLock {
  agentFormat: string
  files: Record<string, string>
  lockVersion: number
  ooCliVersion: string
  requiredOperations: string[]
}

const dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(dirname, "..")
const candidateVersion = process.argv.slice(2).find((argument) => !argument.startsWith("-"))
if (!candidateVersion) throw new Error("usage: pnpm oo:upgrade <version> [--dry-run] [--json] [--output=<path>]")
const dryRun = process.argv.includes("--dry-run")
const json = process.argv.includes("--json")
const outputArgument = process.argv.find((argument) => argument.startsWith("--output="))
const outputPath = outputArgument ? path.resolve(repoRoot, outputArgument.slice("--output=".length)) : undefined
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), `wanta-oo-${candidateVersion}-`))

try {
  const binary =
    candidateVersion === OO_CLI_VERSION
      ? await downloadOoBinary()
      : await downloadOoBinaryVersion(candidateVersion, path.join(temporaryRoot, "bin"))
  const candidateSkills = path.join(temporaryRoot, "skills")
  await exportBundledSkills(candidateSkills, (directory) => installBundledOoSkillsFromBinary(binary, directory))
  const lockPath = path.join(skillLockDir, "oo.json")
  const lock = JSON.parse(await readFile(lockPath, "utf8")) as OoSkillLock
  const candidateHashes = await bundledOoSkillHashes(candidateSkills)
  const currentNames = Object.keys(lock.files).sort()
  const candidateNames = Object.keys(candidateHashes).sort()
  const files = {
    added: candidateNames.filter((name) => lock.files[name] === undefined),
    removed: currentNames.filter((name) => candidateHashes[name] === undefined),
    changed: candidateNames.filter(
      (name) => lock.files[name] !== undefined && lock.files[name] !== candidateHashes[name],
    ),
  }
  const commands = await detectOoSkillCommands(candidateSkills, candidateNames)
  const report = { actualVersion: OO_CLI_VERSION, candidateVersion, files, commands }
  const markdown = renderOoUpgradeMarkdown(report)
  const missing = commands.filter((finding) => finding.availability === "missing")

  if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  else process.stdout.write(markdown)
  if (outputPath) await writeFile(outputPath, json ? `${JSON.stringify(report, null, 2)}\n` : markdown, "utf8")

  if (missing.length > 0) {
    throw new Error(`cannot upgrade with unrecognized OO commands: ${missing.map((item) => item.command).join(", ")}`)
  }

  if (!dryRun) {
    const ooCliSourcePath = path.join(repoRoot, "electron", "agent", "oo-version.ts")
    const ooCliSource = await readFile(ooCliSourcePath, "utf8")
    const nextSource = updateOoCliVersionSource(ooCliSource, OO_CLI_VERSION, candidateVersion)
    const requiredOperations = requiredOperationsForCommands(commands)
    const knownOperationIds = new Set<string>(EXTERNAL_OO_OPERATIONS.map((operation) => operation.id))
    const unknownOperations = unknownRequiredOperations(requiredOperations, knownOperationIds)
    if (unknownOperations.length > 0) {
      throw new Error(`cannot upgrade with unknown required operations: ${unknownOperations.join(", ")}`)
    }
    const nextLock: OoSkillLock = {
      lockVersion: 1,
      ooCliVersion: candidateVersion,
      agentFormat: "universal",
      files: candidateHashes,
      requiredOperations,
    }
    await writeFile(ooCliSourcePath, nextSource, "utf8")
    await writeFile(lockPath, `${JSON.stringify(nextLock, null, 2)}\n`, "utf8")
    await rm(bundledSkillsDir, { force: true, recursive: true })
    await cp(candidateSkills, bundledSkillsDir, { recursive: true })
    process.stdout.write(
      `Upgraded OOCLI to ${candidateVersion}; review and commit the version and Skill lock changes.\n`,
    )
  } else {
    process.stdout.write(`Dry run only; OOCLI remains pinned at ${OO_CLI_VERSION}.\n`)
  }
} finally {
  await rm(temporaryRoot, { force: true, recursive: true })
}
