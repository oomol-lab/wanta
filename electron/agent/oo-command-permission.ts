export const OO_CLI_BASH_PERMISSION = {
  // 非 oo shell 仍进入 Wanta 权限 UI；只有下面显式匹配的单条 oo 调用自动放行。
  "*": "ask",
  oo: "allow",
  "oo *": "allow",
  $WANTA_OO_BIN: "allow",
  "$WANTA_OO_BIN *": "allow",
  "${WANTA_OO_BIN}": "allow",
  "${WANTA_OO_BIN} *": "allow",
  '"$WANTA_OO_BIN"': "allow",
  '"$WANTA_OO_BIN" *': "allow",
  '"${WANTA_OO_BIN}"': "allow",
  '"${WANTA_OO_BIN}" *': "allow",
} as const

function isOoExecutable(word: string): boolean {
  return word === "oo" || word === "$WANTA_OO_BIN" || word === "${WANTA_OO_BIN}"
}

function hasUnsafeShellSyntax(command: string): boolean {
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

    // 双引号内仍会执行命令替换；自动放行只接受单个 oo 调用。
    if (!singleQuoted && (char === "`" || (char === "$" && next === "("))) {
      return true
    }

    if (!singleQuoted && !doubleQuoted && /[;&|<>\n\r]/u.test(char)) {
      return true
    }
  }

  return escaped || singleQuoted || doubleQuoted
}

function shellWords(command: string): string[] | null {
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

export function isPureOoCliCommand(command: string): boolean {
  const trimmed = command.trim()
  if (!trimmed || hasUnsafeShellSyntax(trimmed)) {
    return false
  }

  const words = shellWords(trimmed)
  if (!words || words.length === 0) {
    return false
  }

  // 不自动放行前置 env 赋值，避免 PATH / endpoint / 二进制路径被这一条命令改写。
  return isOoExecutable(words[0] ?? "")
}
