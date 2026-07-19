import type { OoCommandResult } from "../oo-command.ts"
import type { SkillCliVersionCheck, SkillInventory, SkillVersionReport } from "./common.ts"

import { normalizeOoCliVersion } from "../oo-command.ts"
import {
  createCliCheckUpdateArgs,
  createFailedRegistrySkillVersionCheck,
  createFailedSkillVersionCheck,
  createRegistrySkillCheckUpdateArgs,
  createRegistrySkillVersionCheckFromUpdateResult,
  normalizeCliCheckUpdateResult,
  normalizeRegistrySkillCheckUpdateResults,
} from "./actions.ts"

export type RunSkillOoCommand = (args: string[], options: { rejectOnFailure?: boolean }) => Promise<OoCommandResult>

export async function readSkillVersionReport(
  inventory: SkillInventory,
  runCommand: RunSkillOoCommand,
): Promise<SkillVersionReport> {
  const installedGroups = inventory.groups.filter((group) => group.hosts.some((host) => host.status === "installed"))
  const shouldCheckRegistrySkills = installedGroups.some(
    (group) => group.kind === "registry" && Boolean(group.packageName),
  )
  const registryCheckCommand = createRegistrySkillCheckUpdateArgs()
  const currentCliVersion = await readCurrentOoCliVersion(runCommand)
  const [cli, registryChecksResult] = await Promise.all([
    readCliVersionCheck(runCommand, currentCliVersion),
    shouldCheckRegistrySkills
      ? readRegistrySkillVersionChecks(runCommand)
      : Promise.resolve({
          ok: true as const,
          command: registryCheckCommand,
          results: [] as ReturnType<typeof normalizeRegistrySkillCheckUpdateResults>,
        }),
  ])
  const checks = await Promise.all(
    installedGroups.map(async (group) => {
      if (group.kind === "registry") {
        if (!group.packageName) {
          return createFailedSkillVersionCheck(group, "Registry Skill is missing packageName.")
        }

        if (!registryChecksResult.ok) {
          return createFailedRegistrySkillVersionCheck(group, registryChecksResult.error, registryChecksResult.command)
        }

        return createRegistrySkillVersionCheckFromUpdateResult(
          group,
          registryChecksResult.results,
          registryChecksResult.command,
        )
      }

      return {
        currentVersion: group.version,
        id: group.id,
        kind: group.kind,
        name: group.name,
        packageName: group.packageName,
        skillId: group.id,
        status: "not-checkable" as const,
      }
    }),
  )
  const summary = {
    cliUpdates: cli.status === "update-available" ? 1 : 0,
    errors: checks.filter((check) => check.status === "failed").length + (cli.status === "failed" ? 1 : 0),
    registrySkillUpdates: checks.filter((check) => check.kind === "registry" && check.status === "update-available")
      .length,
    totalUpdates: 0,
  }
  summary.totalUpdates = summary.cliUpdates + summary.registrySkillUpdates
  return {
    checkedAt: new Date().toISOString(),
    cli,
    skills: checks,
    summary,
  }
}

async function readCurrentOoCliVersion(runCommand: RunSkillOoCommand): Promise<string | undefined> {
  const result = await runCommand(["version", "--json"], {
    rejectOnFailure: false,
  })

  if (!result.ok) {
    return undefined
  }

  return normalizeOoCliVersion(result.stdout || result.stderr)
}

async function readCliVersionCheck(
  runCommand: RunSkillOoCommand,
  currentVersion?: string,
): Promise<SkillCliVersionCheck> {
  const command = createCliCheckUpdateArgs()
  const result = await runCommand(command, {
    rejectOnFailure: false,
  })

  if (!result.ok) {
    return {
      command,
      currentVersion,
      error: result.message ?? result.stderr,
      raw: result.stdout || result.stderr,
      status: "failed" as const,
    }
  }

  try {
    return normalizeCliCheckUpdateResult(result.stdout, currentVersion)
  } catch (cause) {
    return {
      command,
      currentVersion,
      error: cause instanceof Error ? cause.message : String(cause),
      raw: result.stdout || result.stderr,
      status: "failed",
    }
  }
}

async function readRegistrySkillVersionChecks(
  runCommand: RunSkillOoCommand,
): Promise<
  | { ok: true; command: string[]; results: ReturnType<typeof normalizeRegistrySkillCheckUpdateResults> }
  | { ok: false; command: string[]; error: string }
> {
  const command = createRegistrySkillCheckUpdateArgs()
  const result = await runCommand(command, {
    rejectOnFailure: false,
  })

  if (!result.ok) {
    return { ok: false, command, error: result.message ?? result.stderr }
  }

  try {
    return { ok: true, command, results: normalizeRegistrySkillCheckUpdateResults(result.stdout) }
  } catch (cause) {
    return { ok: false, command, error: cause instanceof Error ? cause.message : String(cause) }
  }
}
