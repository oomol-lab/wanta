export const OO_CLI_BASH_PERMISSION = {
  // 直接 oo 调用走 OpenCode 快速路径；其它 shell 进入 ChatService 默认访问策略，
  // 由主进程自动批准普通 bash，仅在基础安全边界暂停。
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

const ooCommandPrefix = /^(?:oo|"?\$WANTA_OO_BIN"?|"?\$\{WANTA_OO_BIN\}"?)(?:\s|$)/u
const credentialEnvironmentReference = /\b(?:OO_CONNECTOR_TOKEN|OO_API_KEY)\b/u
const environmentDumpCommand = /^(?:env|printenv|set|export|declare\s+-x|typeset\s+-x)(?:\s|$)/u
const linkEnvironmentAssignment = /\b(?:OO_CONNECTOR_URL|OO_ENDPOINT|OO_CONFIG_DIR|OO_DATA_DIR)\s*=/u
const ooCommandSegment = /(?:^|[;&|]{1,2}\s*)(?:oo|"?\$WANTA_OO_BIN"?|"?\$\{WANTA_OO_BIN\}"?)(?:\s|$)/u
const forbiddenOoMutation =
  /(?:^|[;&|]{1,2}\s*)(?:oo|"?\$WANTA_OO_BIN"?|"?\$\{WANTA_OO_BIN\}"?)\s+(?:(?:auth|login|logout|config)(?:\s|[;&|]|$)|connector\s+(?:login|logout)(?:\s|[;&|]|$))/u
const forbiddenOoOption = /(?:^|\s)--(?:endpoint|config-dir|data-dir|connector-url|connector-token)(?:=|\s|$)/u

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

function isEnvironmentDump(command: string): boolean {
  if (environmentDumpCommand.test(command)) return true
  const words = shellWords(command)
  if (!words || !["bash", "sh", "zsh"].includes(words[0] ?? "")) return false
  return words.slice(1).some((word) => ["env", "printenv", "set", "export"].includes(word))
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

export function isOoCliCommand(command: string): boolean {
  return ooCommandPrefix.test(command.trim())
}

export function openConnectorCommandPolicy(command: string): "deny" | "prompt" | null {
  const trimmed = command.trim()
  if (
    credentialEnvironmentReference.test(trimmed) ||
    isEnvironmentDump(trimmed) ||
    linkEnvironmentAssignment.test(trimmed) ||
    forbiddenOoMutation.test(trimmed) ||
    (ooCommandSegment.test(trimmed) && forbiddenOoOption.test(trimmed))
  ) {
    return "deny"
  }
  if (!isOoCliCommand(trimmed)) return null
  if (hasUnsafeShellSyntax(trimmed)) return "prompt"
  return "prompt"
}
