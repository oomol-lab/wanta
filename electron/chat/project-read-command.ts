import type { ChatPermissionRequest } from "./common.ts"

import { permissionCommand } from "./permission-request.ts"
import {
  commandName,
  commandPathArguments,
  hasUnsafeShellSyntax,
  projectPathAllowed,
  shellWords,
} from "./shell-command.ts"

const genericReadOnlyCommands = new Set(["cat", "grep", "head", "ls", "rg", "tail", "wc"])
const gitReadOnlySubcommands = new Set(["branch", "diff", "grep", "log", "ls-files", "rev-parse", "show", "status"])

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
