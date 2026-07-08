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
// git branch 不带显式 list 语义时可创建、删除或改名分支；只读白名单必须逐项收紧。
const gitBranchMutatingOptions = new Set([
  "-c",
  "-C",
  "-d",
  "-D",
  "-m",
  "-M",
  "--copy",
  "--delete",
  "--edit-description",
  "--move",
  "--no-track",
  "--set-upstream-to",
  "--track",
  "--unset-upstream",
])
const gitBranchListOptions = new Set([
  "-a",
  "-r",
  "--all",
  "--contains",
  "--list",
  "--merged",
  "--no-contains",
  "--no-merged",
  "--points-at",
  "--remotes",
  "--show-current",
])
const gitBranchReadOnlyOptions = new Set([
  ...gitBranchListOptions,
  "-v",
  "-vv",
  "--abbrev",
  "--color",
  "--column",
  "--format",
  "--ignore-case",
  "--no-abbrev",
  "--no-column",
  "--sort",
  "--verbose",
])
const gitBranchOptionsWithValue = new Set([
  "--abbrev",
  "--color",
  "--column",
  "--contains",
  "--format",
  "--merged",
  "--no-contains",
  "--no-merged",
  "--points-at",
  "--sort",
])

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

function optionName(word: string): string {
  const separator = word.indexOf("=")
  return separator >= 0 ? word.slice(0, separator) : word
}

function shortBranchOptionMutates(option: string): boolean {
  return /^-[^-]/u.test(option) && /[cCdDmM]/u.test(option)
}

function gitBranchCommandAllowed(args: readonly string[]): boolean {
  let listMode = false
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index]
    if (word === "--") {
      return listMode
    }
    if (!word.startsWith("-")) {
      // 非选项参数只有在 --list/-a/-r 等列表模式下才是 pattern；否则是创建分支。
      return listMode
    }
    const option = optionName(word)
    if (gitBranchMutatingOptions.has(option) || shortBranchOptionMutates(option)) {
      return false
    }
    if (gitBranchListOptions.has(option)) {
      listMode = true
    }
    if (!gitBranchReadOnlyOptions.has(option)) {
      return false
    }
    if (
      gitBranchOptionsWithValue.has(option) &&
      !word.includes("=") &&
      args[index + 1] &&
      !args[index + 1].startsWith("-")
    ) {
      index += 1
    }
  }
  return true
}

function gitCommandAllowed(words: readonly string[], projectRoot: string): boolean {
  const args = words.slice(1)
  let projectScoped = false
  let subcommand: string | undefined
  let subcommandIndex = -1
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
      subcommandIndex = index
    }
  }
  if (!projectScoped || !subcommand || !gitReadOnlySubcommands.has(subcommand)) {
    return false
  }
  if (subcommand === "branch" && !gitBranchCommandAllowed(args.slice(subcommandIndex + 1))) {
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
