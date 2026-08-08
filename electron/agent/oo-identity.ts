import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

const identitySection = "identity"
const teamKeyPattern = /^\s*(?:team|organization)\s*=/
const sectionPattern = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/

function tomlString(value: string): string {
  let escaped = '"'
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0
    switch (char) {
      case "\b":
        escaped += "\\b"
        break
      case "\t":
        escaped += "\\t"
        break
      case "\n":
        escaped += "\\n"
        break
      case "\f":
        escaped += "\\f"
        break
      case "\r":
        escaped += "\\r"
        break
      case '"':
        escaped += '\\"'
        break
      case "\\":
        escaped += "\\\\"
        break
      default:
        if (codePoint <= 0x1f || codePoint === 0x7f) {
          escaped += `\\u${codePoint.toString(16).padStart(4, "0")}`
        } else if (codePoint === 0x2028 || codePoint === 0x2029) {
          escaped += `\\u${codePoint.toString(16)}`
        } else {
          escaped += char
        }
        break
    }
  }
  return `${escaped}"`
}

function sectionName(line: string): string | undefined {
  const match = line.match(sectionPattern)
  return match?.[1]?.trim()
}

function identityTeamLine(teamName: string): string {
  // Current oo versions read identity.team. Remove the retired organization key during migration.
  return `team = ${tomlString(teamName)}`
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") || value.length === 0 ? value : `${value}\n`
}

export function updateOoIdentitySettings(source: string, teamName: string | undefined): string {
  const normalized = teamName?.trim()
  const lines = source.split(/\r?\n/)
  if (lines.at(-1) === "") {
    lines.pop()
  }

  let identityStart = -1
  let identityEnd = lines.length
  for (let index = 0; index < lines.length; index += 1) {
    const currentSection = sectionName(lines[index] ?? "")
    if (!currentSection) {
      continue
    }
    if (currentSection === identitySection) {
      identityStart = index
      continue
    }
    if (identityStart >= 0) {
      identityEnd = index
      break
    }
  }

  if (identityStart < 0) {
    if (!normalized) {
      return source
    }
    const prefix = ensureTrailingNewline(source)
    return `${prefix}${prefix.trim() ? "\n" : ""}[${identitySection}]\n${identityTeamLine(normalized)}\n`
  }

  const identityBody = lines.slice(identityStart + 1, identityEnd)
  const firstSelector = identityBody.findIndex((line) => teamKeyPattern.test(line))
  const insertionOffset =
    firstSelector < 0
      ? identityBody.length
      : identityBody.slice(0, firstSelector).filter((line) => !teamKeyPattern.test(line)).length
  const nextIdentityBody = identityBody.filter((line) => !teamKeyPattern.test(line))
  if (normalized) nextIdentityBody.splice(insertionOffset, 0, identityTeamLine(normalized))
  const nextLines = [...lines.slice(0, identityStart + 1), ...nextIdentityBody, ...lines.slice(identityEnd)]

  return `${nextLines.join("\n")}\n`
}

export async function writeOoIdentitySettings(configDir: string, teamName: string | undefined): Promise<void> {
  const settingsPath = path.join(configDir, "settings.toml")
  let current = ""
  try {
    current = await readFile(settingsPath, "utf8")
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error
    }
  }

  const next = updateOoIdentitySettings(current, teamName)
  if (next === current) {
    return
  }

  await mkdir(configDir, { recursive: true })
  await writeFile(settingsPath, next, "utf8")
}
