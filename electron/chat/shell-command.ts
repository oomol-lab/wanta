import path from "node:path"
import { projectPermissionResourceInsideRoot } from "./project-permission.ts"

export {
  commandBodyAfterBoundedCd,
  commandBodyAfterLikelyCd,
  commandWithoutSafeOutputFilter,
  explicitCdDirectory,
  hasUnsafeShellSyntax,
  shellWords,
  splitLeadingAnd,
} from "./shell-syntax.ts"

const sensitiveBasenames = new Set([
  ".env",
  ".envrc",
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".yarnrc",
  "credentials",
  "credentials.json",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
  "service-account.json",
])
const sensitiveSegments = new Set([".aws", ".config/gh", ".gnupg", ".ssh"])

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
  // Match consecutive path segments so values such as .config/gh only match real path levels.
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
  // Relative paths must remain inside the project root after resolving `..` segments.
  const resolved = path.resolve(projectRoot, normalized)
  const root = path.resolve(projectRoot)
  const relative = path.relative(root, resolved)
  return (
    (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) &&
    !sensitivePath(resolved)
  )
}
