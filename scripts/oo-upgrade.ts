import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { downloadOoBinary, downloadOoBinaryVersion, OO_CLI_VERSION } from "./oo-cli.ts"
import { detectOoSkillCommands, renderOoUpgradeMarkdown } from "./oo-upgrade-review-core.ts"
import {
  bundledOoSkillHashes,
  bundledSkillsDir,
  exportBundledSkills,
  installBundledOoSkillsFromBinary,
  skillCompatibilityDir,
} from "./skills.ts"

interface Manifest {
  agentFormat: string
  files: Record<string, string>
  ooCliVersion: string
  requiredOperations: string[]
}

const dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(dirname, "..")
const candidateVersion = process.argv.slice(2).find((argument) => !argument.startsWith("-"))
if (!candidateVersion) throw new Error("usage: pnpm oo:upgrade <version> [--json] [--accept] [--output=<path>]")
const accept = process.argv.includes("--accept")
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
  const manifestPath = path.join(skillCompatibilityDir, "oo.json")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest
  const candidateHashes = await bundledOoSkillHashes(candidateSkills)
  const currentNames = Object.keys(manifest.files).sort()
  const candidateNames = Object.keys(candidateHashes).sort()
  const files = {
    added: candidateNames.filter((name) => manifest.files[name] === undefined),
    removed: currentNames.filter((name) => candidateHashes[name] === undefined),
    changed: candidateNames.filter(
      (name) => manifest.files[name] !== undefined && manifest.files[name] !== candidateHashes[name],
    ),
  }
  const commands = await detectOoSkillCommands(candidateSkills, candidateNames)
  const report = { actualVersion: OO_CLI_VERSION, candidateVersion, files, commands }
  const markdown = renderOoUpgradeMarkdown(report)
  const missing = commands.filter((finding) => finding.availability === "missing")

  if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  else process.stdout.write(markdown)
  if (outputPath) await writeFile(outputPath, json ? `${JSON.stringify(report, null, 2)}\n` : markdown, "utf8")

  if (accept) {
    if (missing.length > 0) {
      throw new Error(`cannot accept unrecognized OO commands: ${missing.map((item) => item.command).join(", ")}`)
    }
    const ooCliSourcePath = path.join(repoRoot, "scripts", "oo-cli.ts")
    const ooCliSource = await readFile(ooCliSourcePath, "utf8")
    const nextSource = ooCliSource.replace(
      /export const OO_CLI_VERSION = "[^"]+"/u,
      `export const OO_CLI_VERSION = "${candidateVersion}"`,
    )
    if (nextSource === ooCliSource) throw new Error("unable to update OO_CLI_VERSION")
    const requiredOperations = [
      ...new Set([
        ...manifest.requiredOperations,
        ...commands.filter((finding) => finding.operation !== "unrecognized").map((finding) => finding.operation),
      ]),
    ].sort()
    const nextManifest: Manifest = {
      ooCliVersion: candidateVersion,
      agentFormat: "universal",
      files: candidateHashes,
      requiredOperations,
    }
    await writeFile(ooCliSourcePath, nextSource, "utf8")
    await writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, "utf8")
    await rm(bundledSkillsDir, { force: true, recursive: true })
    await cp(candidateSkills, bundledSkillsDir, { recursive: true })
    process.stdout.write(`Accepted OOCLI ${candidateVersion}; review and commit the version and manifest changes.\n`)
  } else if (missing.length > 0) {
    process.exitCode = 2
  }
} finally {
  await rm(temporaryRoot, { force: true, recursive: true })
}
