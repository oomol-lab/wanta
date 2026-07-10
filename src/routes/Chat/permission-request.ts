import type { ChatPermissionRequest } from "../../../electron/chat/common.ts"

import {
  createSessionPermissionGrant,
  isHighRiskPermissionRequest,
  isOoCliPermissionRequest,
  managedPythonDependencyInstall,
  permissionRequestHasBroadResource,
  permissionRequestHasSensitiveResource,
  permissionRequestNeedsDefaultPrompt,
  permissionCommand,
  permissionPrimaryResource,
  permissionRequestKind,
  requestMatchesSessionGrant,
} from "../../../electron/chat/permission-request.ts"

export {
  createSessionPermissionGrant,
  isHighRiskPermissionRequest,
  isOoCliPermissionRequest,
  managedPythonDependencyInstall,
  permissionRequestHasBroadResource,
  permissionRequestHasSensitiveResource,
  permissionRequestNeedsDefaultPrompt,
  permissionCommand,
  permissionPrimaryResource,
  permissionRequestKind,
  requestMatchesSessionGrant,
}
export type { PermissionRequestKind, SessionPermissionGrant } from "../../../electron/chat/permission-request.ts"

const deniedProjectDevCommandPattern =
  /(?:^|\s)(?:--fix(?:=|\s|$)|--update(?:=|\s|$)|--update-snapshot(?:=|\s|$)|--updateSnapshot(?:=|\s|$)|--watch(?:=|\s|$)|--write(?:=|\s|$)|-u(?:\s|$))/iu
const mutatingPackageManagerPattern = /^(?:npm|pnpm|yarn|bun)\s+(?:add|install|publish|remove|uninstall)\b/iu
const projectDependencyVerbs = new Set(["add", "ci", "i", "install", "remove", "rm", "uninstall", "update", "upgrade"])
const projectDependencyOptionsWithValue = new Set(["-C", "--cwd", "--dir", "--prefix"])
const deniedProjectDependencyOptions = new Set(["-g", "--global", "--global-folder", "--registry", "--userconfig"])
const supportedScriptPattern =
  /^(?:build(?::[^\s]+)?|check(?::[^\s]+)?|lint(?::(?![^\s]*(?:fix|watch|write))[^\s]+)?|t|test(?::(?![^\s]*(?:fix|watch|write))[^\s]+)?|ts-check(?::[^\s]+)?|type-check(?::[^\s]+)?|typecheck(?::[^\s]+)?)$/iu

function commandBodyAfterLikelyCd(command: string): string {
  const match = /^cd\s+(?:"[^"]+"|'[^']+'|[^\s;&|<>]+)\s+&&\s+(.+)$/iu.exec(command.trim())
  return match?.[1]?.trim() || command.trim()
}

/** 依赖安装授权只分析第一条包管理器命令，避免后续 shell 片段或参数分隔符扩大授权范围。 */
function firstPackageManagerCommandWords(command: string): string[] {
  const body = commandBodyAfterLikelyCd(command)
  const separatorIndex = body.search(/&&|[;|]/u)
  const firstCommand = separatorIndex >= 0 ? body.slice(0, separatorIndex) : body
  const words = firstCommand.trim().split(/\s+/u)
  const argumentSeparatorIndex = words.indexOf("--")
  return argumentSeparatorIndex >= 0 ? words.slice(0, argumentSeparatorIndex) : words
}

function hasDeniedProjectDependencyOption(words: readonly string[]): boolean {
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index] ?? ""
    const option = word.includes("=") ? word.slice(0, word.indexOf("=")) : word
    if (deniedProjectDependencyOptions.has(option)) {
      return true
    }
    if (option !== "--location") {
      continue
    }
    const location = word.includes("=") ? word.slice(word.indexOf("=") + 1) : words[index + 1]
    if (location?.toLowerCase() === "global") {
      return true
    }
  }
  return false
}

function packageManagerScript(command: string): string | undefined {
  const words = command.split(/\s+/u)
  const manager = words[0]?.toLowerCase()
  if (!manager || !["bun", "npm", "pnpm", "yarn"].includes(manager)) {
    return undefined
  }
  const body = words.slice(1)
  const runIndex = body.findIndex((word) => word === "run" || word === "run-script")
  if (runIndex >= 0) {
    return body.slice(runIndex + 1).find((word) => word && !word.startsWith("-"))
  }
  return body.find((word) => word && !word.startsWith("-"))
}

export function isLikelyProjectDependencyInstallRequest(request: ChatPermissionRequest): boolean {
  if (permissionRequestKind(request) !== "command") {
    return false
  }
  const command = permissionCommand(request)
  if (!command) {
    return false
  }
  const words = firstPackageManagerCommandWords(command)
  const hasExplicitProjectTarget =
    /^cd\s+(?:"[^"]+"|'[^']+'|[^\s;&|<>]+)\s+&&\s+/iu.test(command.trim()) ||
    words.some((word) => {
      const option = word.includes("=") ? word.slice(0, word.indexOf("=")) : word
      return projectDependencyOptionsWithValue.has(option)
    })
  if (!hasExplicitProjectTarget) {
    return false
  }
  const manager = words[0]?.toLowerCase()
  if (!manager || !["bun", "npm", "pnpm", "yarn"].includes(manager)) {
    return false
  }
  if (hasDeniedProjectDependencyOption(words)) {
    return false
  }
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index] ?? ""
    const option = word.includes("=") ? word.slice(0, word.indexOf("=")) : word
    if (projectDependencyOptionsWithValue.has(option) && !word.includes("=")) {
      index += 1
      continue
    }
    if (!word.startsWith("-")) {
      return projectDependencyVerbs.has(word.toLowerCase())
    }
  }
  return false
}

export function isLikelyProjectDevCommandRequest(request: ChatPermissionRequest): boolean {
  if (permissionRequestKind(request) !== "command") {
    return false
  }
  const command = permissionCommand(request)
  if (!command) {
    return false
  }
  const body = commandBodyAfterLikelyCd(command)
  if (deniedProjectDevCommandPattern.test(body) || mutatingPackageManagerPattern.test(body)) {
    return false
  }
  const packageScript = packageManagerScript(body)
  if (packageScript) {
    return supportedScriptPattern.test(packageScript)
  }
  return (
    /^(?:pytest\b|python3?\s+-m\s+pytest\b|go\s+test\b|cargo\s+test\b|vitest\s+(?:run\b|--run\b))/iu.test(body) ||
    (/^tsc\b/iu.test(body) && /(?:^|\s)--noEmit(?:=true)?(?:\s|$)/iu.test(body))
  )
}
