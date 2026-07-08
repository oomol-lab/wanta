import path from "node:path"
import { projectPermissionResourceInsideRoot } from "./project-permission.ts"

const sensitiveBasenames = new Set([
  ".env",
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".yarnrc",
  "credentials",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
])
const sensitiveSegments = new Set([".aws", ".config/gh", ".gnupg", ".ssh"])

export function hasUnsafeShellSyntax(command: string): boolean {
  let singleQuoted = false
  let doubleQuoted = false
  let escaped = false

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    const next = command[index + 1]

    if (escaped) {
      escaped = false
      continue
    }

    if (char === "\\" && !singleQuoted) {
      escaped = true
      continue
    }

    if (char === "'" && !doubleQuoted) {
      singleQuoted = !singleQuoted
      continue
    }

    if (char === '"' && !singleQuoted) {
      doubleQuoted = !doubleQuoted
      continue
    }

    if (!singleQuoted && (char === "`" || (char === "$" && next === "("))) {
      return true
    }

    if (!singleQuoted && !doubleQuoted && /[;&|<>\n\r]/u.test(char)) {
      return true
    }
  }

  return escaped || singleQuoted || doubleQuoted
}

export function shellWords(command: string): string[] | null {
  const words: string[] = []
  let current = ""
  let singleQuoted = false
  let doubleQuoted = false
  let escaped = false

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]

    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === "\\" && !singleQuoted) {
      escaped = true
      continue
    }

    if (char === "'" && !doubleQuoted) {
      singleQuoted = !singleQuoted
      continue
    }

    if (char === '"' && !singleQuoted) {
      doubleQuoted = !doubleQuoted
      continue
    }

    if (!singleQuoted && !doubleQuoted && /\s/u.test(char)) {
      if (current) {
        words.push(current)
        current = ""
      }
      continue
    }

    current += char
  }

  if (escaped || singleQuoted || doubleQuoted) {
    return null
  }
  if (current) {
    words.push(current)
  }
  return words
}

export function commandName(executable: string | undefined): string | undefined {
  if (!executable || executable.includes("/") || executable.includes("\\")) {
    return undefined
  }
  return executable
}

export function optionValue(word: string): string {
  const separator = word.indexOf("=")
  return separator >= 0 ? word.slice(separator + 1) : word
}

export function looksLikePath(value: string): boolean {
  const normalized = optionValue(value).trim()
  return (
    normalized.startsWith("/") ||
    normalized.startsWith("file://") ||
    normalized.startsWith("~/") ||
    normalized.startsWith("./") ||
    normalized.startsWith("../") ||
    normalized.includes("/") ||
    normalized.includes("\\")
  )
}

export function commandPathArguments(words: readonly string[]): string[] {
  return words.slice(1).map(optionValue).filter(looksLikePath)
}

export function sensitivePath(resource: string): boolean {
  const normalized = optionValue(resource).trim()
  const basename = path.basename(normalized).toLowerCase()
  if (sensitiveBasenames.has(basename) || basename.startsWith(".env.")) {
    return true
  }
  const segments = normalized.split(/[\\/]+/u).map((segment) => segment.toLowerCase())
  return [...sensitiveSegments].some((sensitive) => {
    const sensitiveParts = sensitive.split("/")
    return segments.some((_, index) => sensitiveParts.every((part, offset) => segments[index + offset] === part))
  })
}

export function projectPathAllowed(resource: string, projectRoot: string): boolean {
  return projectPermissionResourceInsideRoot(optionValue(resource), projectRoot) && !sensitivePath(resource)
}

export function projectRelativePathAllowed(resource: string, projectRoot: string): boolean {
  const normalized = optionValue(resource).trim()
  if (!normalized || sensitivePath(normalized) || normalized.startsWith("~/")) {
    return false
  }
  if (path.isAbsolute(normalized) || normalized.startsWith("file://")) {
    return projectPathAllowed(normalized, projectRoot)
  }
  const resolved = path.resolve(projectRoot, normalized)
  const root = path.resolve(projectRoot)
  const relative = path.relative(root, resolved)
  return (
    (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) &&
    !sensitivePath(resolved)
  )
}
