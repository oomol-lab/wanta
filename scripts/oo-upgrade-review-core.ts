import { readFile } from "node:fs/promises"
import path from "node:path"
import { resolveExternalOoOperation } from "../electron/agent/external/oo-capability-contract.ts"

export interface OoUpgradeCommandFinding {
  availability: string
  command: string
  operation: string
}

export interface OoUpgradeReport {
  actualVersion: string
  candidateVersion: string
  commands: OoUpgradeCommandFinding[]
  files: { added: string[]; changed: string[]; removed: string[] }
}

export function unknownRequiredOperations(
  requiredOperations: string[],
  knownOperationIds: ReadonlySet<string>,
): string[] {
  return requiredOperations.filter((operation) => !knownOperationIds.has(operation))
}

export async function detectOoSkillCommands(
  skillsRoot: string,
  relativePaths: string[],
): Promise<OoUpgradeCommandFinding[]> {
  const findings = new Map<string, OoUpgradeCommandFinding>()
  for (const relativePath of relativePaths.filter((name) => /(?:\.md|\.ya?ml)$/u.test(name))) {
    const content = await readFile(path.join(skillsRoot, "oo", relativePath), "utf8")
    const snippets = [
      ...[...content.matchAll(/```(?:bash|sh|shell|zsh)?\s*\n([\s\S]*?)```/giu)].flatMap((match) =>
        (match[1] ?? "").split(/\r?\n/u).filter((line) => /^\s*oo\s+/u.test(line)),
      ),
      ...[...content.matchAll(/`(oo\s+[^`\r\n]+)`/giu)].map((match) => match[1] ?? ""),
    ]
    for (const snippet of snippets) {
      const match = snippet.trim().match(/^oo\s+([a-z][\w-]*)(?:\s+([a-z][\w-]*))?/iu)
      if (!match) continue
      const command = [match[1], match[2]].filter(Boolean) as string[]
      const operation = resolveExternalOoOperation(command)
      const display = `oo ${command.join(" ")}`
      findings.set(display, {
        command: display,
        operation: operation?.id ?? "unrecognized",
        availability: operation?.availability ?? "missing",
      })
    }
  }
  return [...findings.values()].sort((left, right) => left.command.localeCompare(right.command))
}

export function renderOoUpgradeMarkdown(report: OoUpgradeReport): string {
  const lines = [
    `# OOCLI ${report.actualVersion} → ${report.candidateVersion} compatibility report`,
    "",
    "## Skill file changes",
    "",
    `- Added: ${report.files.added.join(", ") || "none"}`,
    `- Removed: ${report.files.removed.join(", ") || "none"}`,
    `- Changed: ${report.files.changed.join(", ") || "none"}`,
    "",
    "## Detected OO command domains",
    "",
    "| Command | Operation | Availability |",
    "| --- | --- | --- |",
    ...report.commands.map(
      (finding) => `| \`${finding.command}\` | \`${finding.operation}\` | ${finding.availability} |`,
    ),
    "",
  ]
  return `${lines.join("\n")}\n`
}
