import type { ChatPermissionRequest } from "./common.ts"
import type { SessionPermissionGrant } from "./permission-request.ts"

import { permissionCommand, permissionRequestKind } from "./permission-request.ts"
import {
  commandName,
  commandPathArguments,
  hasUnsafeShellSyntax,
  optionValue,
  projectPathAllowed,
  projectRelativePathAllowed,
  sensitivePath,
  shellWords,
} from "./shell-command.ts"

const projectDevCommandGrantPattern = "project_dev_command"
const packageManagers = new Set(["bun", "npm", "pnpm", "yarn"])
const packageManagerOptionsWithValue = new Set([
  "-C",
  "-w",
  "--cache",
  "--cwd",
  "--dir",
  "--global-folder",
  "--prefix",
  "--registry",
  "--userconfig",
  "--workspace",
])
const deniedDevCommandArguments = new Set([
  "-u",
  "--fix",
  "--fix-type",
  "--update",
  "--update-snapshot",
  "--updateSnapshot",
  "--watch",
  "--write",
])

function splitLeadingAnd(command: string): { left: string; right: string } | undefined {
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
    // 只识别最前层的 "cd <project> && <command>"，避免把引号里的 && 当成命令连接符。
    if (!singleQuoted && !doubleQuoted && char === "&" && next === "&") {
      return {
        left: command.slice(0, index).trim(),
        right: command.slice(index + 2).trim(),
      }
    }
  }

  return undefined
}

function cdPath(words: readonly string[]): string | undefined {
  if (commandName(words[0]) !== "cd") {
    return undefined
  }
  const args = words.slice(1).filter((word) => word !== "--")
  // cd 只接受单一目标目录；多参数或无目标都会回到普通权限确认。
  return args.length === 1 ? args[0] : undefined
}

function commandBodyAfterProjectCd(command: string, projectRoot: string): string | undefined {
  const split = splitLeadingAnd(command)
  if (!split) {
    return command
  }
  const leftWords = shellWords(split.left)
  const projectDirectory = leftWords ? cdPath(leftWords) : undefined
  // 只有 cd 目标明确落在可信项目内，右侧开发命令才能继承项目授权。
  if (!projectDirectory || !projectPathAllowed(projectDirectory, projectRoot) || !split.right) {
    return undefined
  }
  return split.right
}

function commandBodyAfterLikelyCd(command: string): string {
  const split = splitLeadingAnd(command)
  if (!split) {
    return command
  }
  const leftWords = shellWords(split.left)
  return leftWords && cdPath(leftWords) && split.right ? split.right : command
}

function optionName(word: string): string {
  const separator = word.indexOf("=")
  return separator >= 0 ? word.slice(0, separator) : word
}

function optionConsumesNextValue(word: string): boolean {
  return packageManagerOptionsWithValue.has(optionName(word)) && !word.includes("=")
}

function nextCommandWord(words: readonly string[], startIndex: number): { index: number; value: string } | undefined {
  for (let index = startIndex; index < words.length; index += 1) {
    const word = words[index]
    if (word === "--") {
      continue
    }
    if (optionConsumesNextValue(word)) {
      // 包管理器 cwd/registry 等选项会消费下一个值，不能误判为 script 名。
      index += 1
      continue
    }
    if (word.startsWith("-")) {
      continue
    }
    return { index, value: word }
  }
  return undefined
}

function supportedScriptName(scriptName: string | undefined): boolean {
  if (!scriptName) {
    return false
  }
  const normalized = scriptName.toLowerCase()
  // 默认访问只覆盖检查型脚本，显式拒绝常见自动修改或 watch 类脚本。
  if (normalized.includes("fix") || normalized.includes("watch") || normalized.includes("write")) {
    return false
  }
  return (
    normalized === "build" ||
    normalized.startsWith("build:") ||
    normalized === "check" ||
    normalized.startsWith("check:") ||
    normalized === "lint" ||
    normalized.startsWith("lint:") ||
    normalized === "test" ||
    normalized.startsWith("test:") ||
    normalized === "ts-check" ||
    normalized.startsWith("ts-check:") ||
    normalized === "type-check" ||
    normalized.startsWith("type-check:") ||
    normalized === "typecheck" ||
    normalized.startsWith("typecheck:")
  )
}

function packageManagerCommandAllowed(words: readonly string[]): boolean {
  const manager = commandName(words[0])
  if (!manager || !packageManagers.has(manager)) {
    return false
  }
  const command = nextCommandWord(words, 1)
  if (!command) {
    return false
  }
  const verb = command.value.toLowerCase()
  if (manager === "bun" && verb === "test") {
    return true
  }
  // npm/pnpm/yarn run 需要继续检查 script 名，避免 npm run fix 之类写入型脚本被放行。
  if (verb === "run" || verb === "run-script") {
    return supportedScriptName(nextCommandWord(words, command.index + 1)?.value)
  }
  if (manager === "npm" && verb === "t") {
    return true
  }
  return supportedScriptName(verb)
}

function directDevCommandAllowed(words: readonly string[]): boolean {
  const name = commandName(words[0])
  if (!name) {
    return false
  }
  // 仅放行能明确归类为检查/测试的直接命令；不推断 npx 等会下载或解析包的入口。
  if (name === "pytest") {
    return true
  }
  if (name === "vitest") {
    return words.some((word) => word === "run" || word === "--run")
  }
  if ((name === "python" || name === "python3") && words[1] === "-m" && words[2] === "pytest") {
    return true
  }
  if (name === "go") {
    return nextCommandWord(words, 1)?.value === "test"
  }
  if (name === "cargo") {
    return nextCommandWord(words, 1)?.value === "test"
  }
  if (name === "tsc") {
    return words.some((word) => word === "--noEmit" || word === "--noEmit=true")
  }
  return false
}

function commandArgumentsSafeForProject(words: readonly string[], projectRoot: string): boolean {
  // --fix/--watch 等参数会写文件或挂起会话；敏感路径也必须回到 UI 确认。
  if (words.slice(1).some((word) => sensitivePath(word) || deniedDevCommandArguments.has(optionName(word)))) {
    return false
  }
  return commandPathArguments(words).every((resource) => projectRelativePathAllowed(optionValue(resource), projectRoot))
}

function parsedProjectDevCommandWords(command: string, projectRoot: string): string[] | null {
  const body = commandBodyAfterProjectCd(command.trim(), projectRoot)
  if (!body || hasUnsafeShellSyntax(body)) {
    return null
  }
  const words = shellWords(body)
  if (!words || words.length === 0 || !commandArgumentsSafeForProject(words, projectRoot)) {
    return null
  }
  return words
}

function parsedLikelyProjectDevCommandWords(command: string): string[] | null {
  const body = commandBodyAfterLikelyCd(command.trim())
  if (!body || hasUnsafeShellSyntax(body)) {
    return null
  }
  const words = shellWords(body)
  return words && words.length > 0 ? words : null
}

function wordsMatchProjectDevCommand(words: readonly string[]): boolean {
  return packageManagerCommandAllowed(words) || directDevCommandAllowed(words)
}

export function isLikelyProjectDevCommandRequest(request: ChatPermissionRequest): boolean {
  if (permissionRequestKind(request) !== "command") {
    return false
  }
  const command = permissionCommand(request)
  const words = command ? parsedLikelyProjectDevCommandWords(command) : null
  return Boolean(words && wordsMatchProjectDevCommand(words))
}

export function isProjectDevCommandRequest(request: ChatPermissionRequest, projectRoot: string): boolean {
  if (permissionRequestKind(request) !== "command") {
    return false
  }
  const command = permissionCommand(request)
  const words = command ? parsedProjectDevCommandWords(command, projectRoot) : null
  return Boolean(words && wordsMatchProjectDevCommand(words))
}

export function createProjectDevCommandSessionGrant(
  request: ChatPermissionRequest,
  projectRoot: string,
): SessionPermissionGrant | null {
  if (!isProjectDevCommandRequest(request, projectRoot)) {
    return null
  }
  return { action: "command", kind: "project_dev_command", patterns: [projectDevCommandGrantPattern] }
}

export function requestMatchesProjectDevCommandSessionGrant(
  request: ChatPermissionRequest,
  grant: SessionPermissionGrant,
  projectRoot: string,
): boolean {
  return (
    grant.kind === "project_dev_command" &&
    grant.patterns.includes(projectDevCommandGrantPattern) &&
    isProjectDevCommandRequest(request, projectRoot)
  )
}
