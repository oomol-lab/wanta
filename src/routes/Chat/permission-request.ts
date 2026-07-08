import type { ChatPermissionRequest } from "../../../electron/chat/common.ts"

import {
  createSessionPermissionGrant,
  isHighRiskPermissionRequest,
  isOoCliPermissionRequest,
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
const supportedScriptPattern =
  /^(?:build(?::[^\s]+)?|check(?::[^\s]+)?|lint(?::(?![^\s]*(?:fix|watch|write))[^\s]+)?|t|test(?::(?![^\s]*(?:fix|watch|write))[^\s]+)?|ts-check(?::[^\s]+)?|type-check(?::[^\s]+)?|typecheck(?::[^\s]+)?)$/iu

function commandBodyAfterLikelyCd(command: string): string {
  const match = /^cd\s+(?:"[^"]+"|'[^']+'|[^\s;&|<>]+)\s+&&\s+(.+)$/iu.exec(command.trim())
  return match?.[1]?.trim() || command.trim()
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
