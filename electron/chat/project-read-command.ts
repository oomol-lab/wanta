import type { ChatPermissionRequest } from "./common.ts"

import path from "node:path"
import { permissionCommand } from "./permission-request.ts"
import { projectPermissionResourceInsideRoot } from "./project-permission.ts"

const genericReadOnlyCommands = new Set(["cat", "grep", "head", "ls", "rg", "tail", "wc"])
const gitReadOnlySubcommands = new Set(["branch", "diff", "grep", "log", "ls-files", "rev-parse", "show", "status"])
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

function hasUnsafeShellSyntax(command: string): boolean {
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

function shellWords(command: string): string[] | null {
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

function commandName(executable: string | undefined): string | undefined {
  if (!executable || executable.includes("/") || executable.includes("\\")) {
    return undefined
  }
  return executable
}

function optionValue(word: string): string {
  const separator = word.indexOf("=")
  return separator >= 0 ? word.slice(separator + 1) : word
}

function looksLikePath(value: string): boolean {
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

function commandPathArguments(words: readonly string[]): string[] {
  return words.slice(1).map(optionValue).filter(looksLikePath)
}

function sensitivePath(resource: string): boolean {
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

function projectPathAllowed(resource: string, projectRoot: string): boolean {
  return projectPermissionResourceInsideRoot(optionValue(resource), projectRoot) && !sensitivePath(resource)
}

function everyProjectPathAllowed(paths: readonly string[], projectRoot: string): boolean {
  return paths.length > 0 && paths.every((resource) => projectPathAllowed(resource, projectRoot))
}

function pwdCommandAllowed(words: readonly string[]): boolean {
  return words.slice(1).every((word) => word === "-L" || word === "-P")
}

function findCommandAllowed(words: readonly string[], projectRoot: string): boolean {
  const deniedActions = new Set(["-delete", "-exec", "-execdir", "-fls", "-fprint", "-fprint0", "-ok", "-okdir"])
  if (words.some((word) => deniedActions.has(word))) {
    return false
  }
  return everyProjectPathAllowed(commandPathArguments(words), projectRoot)
}

function sedCommandAllowed(words: readonly string[], projectRoot: string): boolean {
  if (words.some((word) => word === "-i" || word.startsWith("-i.") || word === "--in-place")) {
    return false
  }
  return everyProjectPathAllowed(commandPathArguments(words), projectRoot)
}

function gitCommandAllowed(words: readonly string[], projectRoot: string): boolean {
  const args = words.slice(1)
  let projectScoped = false
  let subcommand: string | undefined
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index]
    if (word === "-C") {
      const cwd = args[index + 1]
      if (!cwd || !projectPathAllowed(cwd, projectRoot)) {
        return false
      }
      projectScoped = true
      index += 1
      continue
    }
    if (word.startsWith("-C")) {
      const cwd = word.slice(2)
      if (!cwd || !projectPathAllowed(cwd, projectRoot)) {
        return false
      }
      projectScoped = true
      continue
    }
    if (!subcommand && !word.startsWith("-")) {
      subcommand = word
    }
  }
  if (!projectScoped || !subcommand || !gitReadOnlySubcommands.has(subcommand)) {
    return false
  }
  return commandPathArguments(words).every((resource) => projectPathAllowed(resource, projectRoot))
}

export function isProjectReadOnlyCommandRequest(request: ChatPermissionRequest, projectRoot: string): boolean {
  const command = permissionCommand(request)
  if (!command || hasUnsafeShellSyntax(command)) {
    return false
  }
  const words = shellWords(command)
  if (!words || words.length === 0) {
    return false
  }
  const name = commandName(words[0])
  if (!name) {
    return false
  }
  if (name === "pwd") {
    return pwdCommandAllowed(words)
  }
  if (name === "git") {
    return gitCommandAllowed(words, projectRoot)
  }
  if (name === "find") {
    return findCommandAllowed(words, projectRoot)
  }
  if (name === "sed") {
    return sedCommandAllowed(words, projectRoot)
  }
  if (!genericReadOnlyCommands.has(name)) {
    return false
  }
  return everyProjectPathAllowed(commandPathArguments(words), projectRoot)
}
