export type TopLevelShellOperator = "and" | "background" | "or" | "pipe" | "sequence"

export interface TopLevelShellSegment {
  operatorAfter?: TopLevelShellOperator
  text: string
}

const shellAssignmentPattern = /^[A-Za-z_][A-Za-z0-9_]*=/u
const envOptionsWithValue = new Set(["-C", "-S", "-u", "--argv0", "--chdir", "--split-string", "--unset"])

export function shellCommandName(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\\/gu, "/")
  if (!normalized) {
    return undefined
  }
  const parts = normalized.split("/")
  return parts[parts.length - 1]?.toLowerCase()
}

/**
 * Removes leading shell assignments and the standard `env` wrapper so policy classifiers
 * inspect the executable rather than mistaking setup words for command semantics.
 */
export function effectiveShellCommandWords(words: readonly string[]): readonly string[] {
  let index = 0
  while (shellAssignmentPattern.test(words[index] ?? "")) {
    index += 1
  }
  if (shellCommandName(words[index]) !== "env") {
    return words.slice(index)
  }
  index += 1
  for (; index < words.length; index += 1) {
    const word = words[index] ?? ""
    if (shellAssignmentPattern.test(word)) {
      continue
    }
    if (!word.startsWith("-")) {
      break
    }
    const separator = word.indexOf("=")
    const option = separator >= 0 ? word.slice(0, separator) : word
    if (envOptionsWithValue.has(option) && separator < 0) {
      index += 1
    }
  }
  while (shellAssignmentPattern.test(words[index] ?? "")) {
    index += 1
  }
  return words.slice(index)
}

/**
 * Splits only top-level shell composition. Quoted operators remain ordinary argument text,
 * while redirections such as `2>&1` and `&>` stay attached to their command.
 */
export function topLevelShellSegments(command: string): TopLevelShellSegment[] {
  const segments: TopLevelShellSegment[] = []
  let current = ""
  let singleQuoted = false
  let doubleQuoted = false
  let escaped = false

  const push = (operatorAfter?: TopLevelShellOperator): void => {
    const text = current.trim()
    if (text) {
      segments.push({ operatorAfter, text })
    }
    current = ""
  }

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? ""
    const previous = command[index - 1]
    const next = command[index + 1]
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === "\\" && !singleQuoted) {
      current += char
      escaped = true
      continue
    }
    if (char === "'" && !doubleQuoted) {
      current += char
      singleQuoted = !singleQuoted
      continue
    }
    if (char === '"' && !singleQuoted) {
      current += char
      doubleQuoted = !doubleQuoted
      continue
    }
    if (singleQuoted || doubleQuoted) {
      current += char
      continue
    }
    if (char === ";") {
      push("sequence")
      continue
    }
    if (char === "\n" || char === "\r") {
      push("sequence")
      continue
    }
    if (char === "|") {
      push(next === "|" ? "or" : "pipe")
      if (next === "|" || next === "&") {
        index += 1
      }
      continue
    }
    if (char === "&") {
      if (previous === ">" || previous === "<" || next === ">") {
        current += char
        continue
      }
      push(next === "&" ? "and" : "background")
      if (next === "&") {
        index += 1
      }
      continue
    }
    current += char
  }
  push()
  return segments
}

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
