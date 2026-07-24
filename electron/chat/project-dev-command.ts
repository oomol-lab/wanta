import type { ChatPermissionRequest } from "./common.ts"
import type { SessionPermissionGrant } from "./permission-request.ts"

import { canonicalRegistryNodePackageName } from "./dependency-policy.ts"
import { permissionCommand, permissionRequestKind } from "./permission-request.ts"
import {
  commandName,
  commandBodyAfterBoundedCd,
  commandBodyAfterLikelyCd,
  commandPathArguments,
  commandWithoutSafeOutputFilter,
  explicitCdDirectory,
  hasUnsafeShellSyntax,
  optionValue,
  projectPathAllowed,
  projectRelativePathAllowed,
  sensitivePath,
  shellWords,
  splitLeadingAnd,
} from "./shell-command.ts"

const projectDependencyInstallGrantPattern = "project_dependency_install"
const projectDevCommandGrantPattern = "project_dev_command"
const packageManagers = new Set(["bun", "npm", "pnpm", "yarn"])
const packageDependencyVerbs = new Set(["add", "ci", "i", "install", "remove", "rm", "uninstall", "update", "upgrade"])
const nodeDependencyInstallVerbs = new Set(["add", "i", "install"])
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
const deniedProjectDependencyOptions = new Set(["-g", "--global", "--global-folder", "--registry", "--userconfig"])
const projectTargetOptions = new Set(["-C", "--cwd", "--dir", "--prefix"])

function hasDeniedProjectDependencyOption(words: readonly string[]): boolean {
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index]
    const option = optionName(word)
    if (deniedProjectDependencyOptions.has(option)) {
      return true
    }
    if (option !== "--location") {
      continue
    }
    const location = word.includes("=") ? optionValue(word) : words[index + 1]
    if (location?.toLowerCase() === "global") {
      return true
    }
  }
  return false
}

function commandBodyAfterProjectCd(command: string, projectRoot: string): string | undefined {
  return commandBodyAfterBoundedCd(command, (directory) => projectPathAllowed(directory, projectRoot))?.body
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
      // Package-manager cwd and registry options consume the following value.
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
  // Default Access covers check-oriented scripts, not common auto-fix or watch scripts.
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
  // npm/pnpm/yarn run commands need their script name checked separately.
  if (verb === "run" || verb === "run-script") {
    return supportedScriptName(nextCommandWord(words, command.index + 1)?.value)
  }
  if (manager === "npm" && verb === "t") {
    return true
  }
  return supportedScriptName(verb)
}

function packageDependencyInstallAllowed(words: readonly string[]): boolean {
  const manager = commandName(words[0])
  if (!manager || !packageManagers.has(manager)) {
    return false
  }
  const command = nextCommandWord(words, 1)
  if (!command || !packageDependencyVerbs.has(command.value.toLowerCase())) {
    return false
  }
  return !hasDeniedProjectDependencyOption(words)
}

function registryNodeDependencyPackages(words: readonly string[], options: { allowEmpty: boolean }): string[] | null {
  const manager = commandName(words[0])
  if (!manager || !packageManagers.has(manager)) {
    return null
  }
  const command = nextCommandWord(words, 1)
  if (!command || !nodeDependencyInstallVerbs.has(command.value.toLowerCase())) {
    return null
  }
  if (hasDeniedProjectDependencyOption(words)) {
    return null
  }
  for (let index = 1; index < command.index; index += 1) {
    const word = words[index]
    const option = optionName(word)
    if (projectTargetOptions.has(option)) {
      if (!word.includes("=")) {
        index += 1
      }
      continue
    }
    if (!word.startsWith("-")) {
      return null
    }
    if (optionConsumesNextValue(word)) {
      index += 1
    }
  }
  const packages: string[] = []
  for (let index = command.index + 1; index < words.length; index += 1) {
    const word = words[index]
    const option = optionName(word)
    if (word === "--") {
      continue
    }
    if (projectTargetOptions.has(option)) {
      if (!word.includes("=")) {
        index += 1
      }
      continue
    }
    if (word.startsWith("-")) {
      if (optionConsumesNextValue(word)) {
        index += 1
      }
      continue
    }
    const packageName = canonicalRegistryNodePackageName(word)
    if (!packageName) {
      return null
    }
    packages.push(packageName)
  }
  const uniquePackages = [...new Set(packages)]
  if (!options.allowEmpty && uniquePackages.length === 0) {
    return null
  }
  return uniquePackages
}

function directInstallArgumentsUseStandardRegistry(words: readonly string[]): boolean {
  const command = nextCommandWord(words, 1)
  if (!command || !nodeDependencyInstallVerbs.has(command.value.toLowerCase())) {
    return true
  }
  return Boolean(
    registryNodeDependencyPackages(words, {
      allowEmpty: command.value.toLowerCase() !== "add",
    }),
  )
}

function commandExplicitlyTargetsProject(command: string, projectRoot: string): boolean {
  const split = splitLeadingAnd(command)
  if (split) {
    const directory = explicitCdDirectory(split.left)
    return Boolean(directory && projectPathAllowed(directory, projectRoot))
  }
  const words = shellWords(command)
  if (!words) {
    return false
  }
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index]
    const option = optionName(word)
    if (!projectTargetOptions.has(option)) {
      continue
    }
    const directory = word.includes("=") ? optionValue(word) : words[index + 1]
    return Boolean(directory && projectPathAllowed(directory, projectRoot))
  }
  return false
}

function commandLikelyTargetsAProject(command: string): boolean {
  const split = splitLeadingAnd(command)
  if (split) {
    return Boolean(explicitCdDirectory(split.left))
  }
  const words = shellWords(command)
  return Boolean(words?.some((word) => projectTargetOptions.has(optionName(word))))
}

function directDevCommandAllowed(words: readonly string[]): boolean {
  const name = commandName(words[0])
  if (!name) {
    return false
  }
  // Only directly recognizable check/test commands qualify.
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
  // Auto-fix/watch arguments and sensitive paths return to the normal permission flow.
  if (words.slice(1).some((word) => sensitivePath(word) || deniedDevCommandArguments.has(optionName(word)))) {
    return false
  }
  return commandPathArguments(words).every((resource) => projectRelativePathAllowed(optionValue(resource), projectRoot))
}

function parsedProjectDevCommandWords(command: string, projectRoot: string): string[] | null {
  const rawBody = commandBodyAfterProjectCd(command.trim(), projectRoot)
  const body = rawBody ? commandWithoutSafeOutputFilter(rawBody) : undefined
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
  const body = commandWithoutSafeOutputFilter(commandBodyAfterLikelyCd(command.trim()))
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

/**
 * 只识别显式指向当前项目的标准包管理器依赖变更。它用于一次当前任务授权，
 * 不接受全局安装、自定义 registry 或 user config，避免扩大为任意包管理器权限。
 */
export function isProjectDependencyInstallRequest(request: ChatPermissionRequest, projectRoot: string): boolean {
  if (permissionRequestKind(request) !== "command") {
    return false
  }
  const command = permissionCommand(request)
  const words = command ? parsedProjectDevCommandWords(command, projectRoot) : null
  return Boolean(
    command &&
    words &&
    commandExplicitlyTargetsProject(command, projectRoot) &&
    packageDependencyInstallAllowed(words) &&
    directInstallArgumentsUseStandardRegistry(words),
  )
}

/**
 * Recognizes a direct standard-registry install inside one bounded target.
 * Package popularity is irrelevant; global installs and alternate sources remain confirmation
 * boundaries.
 */
export function isStandardRegistryNodeDependencyInstallRequest(
  request: ChatPermissionRequest,
  targetRoot: string,
): boolean {
  if (permissionRequestKind(request) !== "command") {
    return false
  }
  const command = permissionCommand(request)
  const words = command ? parsedProjectDevCommandWords(command, targetRoot) : null
  return Boolean(
    command &&
    words &&
    commandExplicitlyTargetsProject(command, targetRoot) &&
    !hasDeniedProjectDependencyOption(words) &&
    registryNodeDependencyPackages(words, { allowEmpty: false }),
  )
}

/** 渲染层只用于展示当前任务授权入口；主进程仍会复核真实项目根目录。 */
export function isLikelyProjectDependencyInstallRequest(request: ChatPermissionRequest): boolean {
  if (permissionRequestKind(request) !== "command") {
    return false
  }
  const command = permissionCommand(request)
  const words = command ? parsedLikelyProjectDevCommandWords(command) : null
  return Boolean(command && words && commandLikelyTargetsAProject(command) && packageDependencyInstallAllowed(words))
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

export function createProjectDependencyInstallTaskGrant(
  request: ChatPermissionRequest,
  projectRoot: string,
  generationId: string,
): SessionPermissionGrant | null {
  if (!isProjectDependencyInstallRequest(request, projectRoot)) {
    return null
  }
  return {
    action: request.action.trim().toLowerCase(),
    generationId,
    kind: "project_dependency_install",
    patterns: [projectDependencyInstallGrantPattern],
    projectRoot,
  }
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

export function requestMatchesProjectDependencyInstallTaskGrant(
  request: ChatPermissionRequest,
  grant: SessionPermissionGrant,
  projectRoot: string,
  generationId: string | undefined,
): boolean {
  return Boolean(
    generationId &&
    grant.kind === "project_dependency_install" &&
    grant.action === request.action.trim().toLowerCase() &&
    grant.generationId === generationId &&
    grant.projectRoot === projectRoot &&
    grant.patterns.includes(projectDependencyInstallGrantPattern) &&
    isProjectDependencyInstallRequest(request, projectRoot),
  )
}
