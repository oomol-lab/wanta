import path from "node:path"
import { projectPermissionResourceInsideRoot } from "./project-permission.ts"

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

    // 双引号内仍会执行命令替换；默认访问不自动放行可嵌套执行的 shell。
    if (!singleQuoted && (char === "`" || (char === "$" && next === "("))) {
      return true
    }

    // 组合命令、重定向和管道会改变命令语义，必须交回普通 permission 流程判断。
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

    // 单引号内反斜杠按普通字符处理；其它位置保留 shell 的转义语义。
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

    // 只在未引用状态按空白切词，避免误把路径或参数里的空格拆开。
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
  // 分段连续匹配，确保 .config/gh 这类敏感目录只在真实路径层级中命中。
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
  // 相对路径必须解析后仍留在项目根内，避免 ../ 逃逸到用户目录或系统路径。
  const resolved = path.resolve(projectRoot, normalized)
  const root = path.resolve(projectRoot)
  const relative = path.relative(root, resolved)
  return (
    (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) &&
    !sensitivePath(resolved)
  )
}
