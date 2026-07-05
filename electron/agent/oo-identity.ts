import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

const identitySection = "identity"
const organizationKeyPattern = /^\s*organization\s*=/
const sectionPattern = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/

function tomlString(value: string): string {
  return JSON.stringify(value)
}

function sectionName(line: string): string | undefined {
  const match = line.match(sectionPattern)
  return match?.[1]?.trim()
}

function identityOrganizationLine(organizationName: string): string {
  return `organization = ${tomlString(organizationName)}`
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") || value.length === 0 ? value : `${value}\n`
}

export function updateOoIdentitySettings(source: string, organizationName: string | undefined): string {
  const normalized = organizationName?.trim()
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
    return `${prefix}${prefix.trim() ? "\n" : ""}[${identitySection}]\n${identityOrganizationLine(normalized)}\n`
  }

  const nextLines = [...lines]
  let organizationLine = -1
  for (let index = identityStart + 1; index < identityEnd; index += 1) {
    if (organizationKeyPattern.test(nextLines[index] ?? "")) {
      organizationLine = index
      break
    }
  }

  if (normalized) {
    if (organizationLine >= 0) {
      nextLines[organizationLine] = identityOrganizationLine(normalized)
    } else {
      nextLines.splice(identityEnd, 0, identityOrganizationLine(normalized))
    }
  } else if (organizationLine >= 0) {
    nextLines.splice(organizationLine, 1)
  }

  return `${nextLines.join("\n")}\n`
}

export async function writeOoIdentitySettings(configDir: string, organizationName: string | undefined): Promise<void> {
  const settingsPath = path.join(configDir, "settings.toml")
  let current = ""
  try {
    current = await readFile(settingsPath, "utf8")
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error
    }
  }

  const next = updateOoIdentitySettings(current, organizationName)
  if (next === current) {
    return
  }

  await mkdir(configDir, { recursive: true })
  await writeFile(settingsPath, next, "utf8")
}
