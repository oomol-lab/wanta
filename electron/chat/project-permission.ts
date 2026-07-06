import type { ChatPermissionRequest } from "./common.ts"

import path from "node:path"
import { fileURLToPath } from "node:url"

const trustedProjectPermissionActions = new Set([
  "directory",
  "edit",
  "external_directory",
  "file",
  "file.read",
  "file.write",
  "fs.read",
  "fs.write",
  "read",
  "write",
])

function normalizedAction(action: string): string {
  return action.trim().toLowerCase()
}

function normalizeRoot(root: string): string | undefined {
  const normalized = path.resolve(root.trim().replace(/[\\/]+$/, ""))
  if (!normalized || normalized === path.parse(normalized).root) {
    return undefined
  }
  return normalized
}

function pathInsideRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function pathFromFileUrl(value: string): string | undefined {
  if (!value.startsWith("file://")) {
    return undefined
  }
  try {
    const url = new URL(value)
    return url.protocol === "file:" ? fileURLToPath(url) : undefined
  } catch {
    return undefined
  }
}

function concretePathFromResource(resource: string): string | undefined {
  const trimmed = resource.trim()
  if (!trimmed) {
    return undefined
  }
  const filePath = pathFromFileUrl(trimmed)
  const rawPath = filePath ?? trimmed
  const wildcardIndex = rawPath.search(/[*?[\]{}]/)
  if (wildcardIndex >= 0) {
    const prefix = rawPath.slice(0, wildcardIndex)
    if (!prefix.endsWith("/") && !prefix.endsWith("\\")) {
      return undefined
    }
    const directory = prefix.replace(/[\\/]+$/, "")
    return directory && path.isAbsolute(directory) ? path.resolve(directory) : undefined
  }
  return path.isAbsolute(rawPath) ? path.resolve(rawPath) : undefined
}

export function isTrustedProjectPermissionAction(action: string): boolean {
  const normalized = normalizedAction(action)
  return trustedProjectPermissionActions.has(normalized)
}

export function projectPermissionResourceInsideRoot(resource: string, root: string): boolean {
  const normalizedRoot = normalizeRoot(root)
  const target = concretePathFromResource(resource)
  return Boolean(normalizedRoot && target && pathInsideRoot(normalizedRoot, target))
}

export function projectPermissionRequestInsideRoot(request: ChatPermissionRequest, root: string): boolean {
  if (!isTrustedProjectPermissionAction(request.action)) {
    return false
  }
  const resources = request.resources.map((resource) => resource.trim()).filter(Boolean)
  if (resources.length === 0) {
    return false
  }
  if (!resources.every((resource) => projectPermissionResourceInsideRoot(resource, root))) {
    return false
  }
  return true
}
