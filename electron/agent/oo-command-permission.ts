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

const credentialEnvironmentReference = /\b(?:OO_CONNECTOR_TOKEN|OO_API_KEY)\b/u
const environmentDumpCommand = /^(?:env|printenv|set|export|declare\s+-x|typeset\s+-x)(?:\s|$)/u
const linkEnvironmentAssignment = /\b(?:OO_CONNECTOR_URL|OO_ENDPOINT|OO_CONFIG_DIR|OO_DATA_DIR)\s*=/u
const ooCommandSegment = /(?:^|[;&|]{1,2}\s*)(?:oo|"?\$WANTA_OO_BIN"?|"?\$\{WANTA_OO_BIN\}"?)(?:\s|$)/u
const forbiddenOoMutation =
  /(?:^|[;&|]{1,2}\s*)(?:oo|"?\$WANTA_OO_BIN"?|"?\$\{WANTA_OO_BIN\}"?)\s+(?:(?:auth|login|logout|config)(?:\s|[;&|]|$)|connector\s+(?:login|logout)(?:\s|[;&|]|$))/u
const forbiddenOoOption = /(?:^|\s)--(?:endpoint|config-dir|data-dir|connector-url|connector-token)(?:=|\s|$)/u
const maxShellWrapperDepth = 8
const posixCommandOption = /^-(?:c|lc)$/u
const cmdCommandOption = /^\/[ck]$/iu
const powershellCommandOption = /^-(?:c|command)$/iu
const unsupportedWrapperSyntax = /(?:`|\$(?!(?:WANTA_OO_BIN\b|\{WANTA_OO_BIN\}))|%[^%\s]+%|![^!\s]+!)/u

type ShellExecutable = "cmd" | "posix" | "powershell"
type ShellWrapper = { kind: "command"; command: string } | { kind: "not_wrapper" } | { kind: "unsupported" }

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

function shellExecutable(command: string): { arguments: string; kind: ShellExecutable } | null {
  const match = /^(?:"([^"]+)"|(\S+))/u.exec(command)
  if (!match) return null
  const executable = (match[1] ?? match[2] ?? "").split(/[\\/]/u).at(-1)?.toLowerCase()
  const kind =
    executable && ["bash", "dash", "fish", "ksh", "sh", "zsh"].includes(executable)
      ? "posix"
      : executable === "cmd" || executable === "cmd.exe"
        ? "cmd"
        : executable && ["powershell", "powershell.exe", "pwsh", "pwsh.exe"].includes(executable)
          ? "powershell"
          : null
  return kind ? { arguments: command.slice(match[0].length).trimStart(), kind } : null
}

function shellWrapperCommand(command: string): ShellWrapper {
  const shell = shellExecutable(command)
  if (!shell) return { kind: "not_wrapper" }
  if (unsupportedWrapperSyntax.test(shell.arguments)) return { kind: "unsupported" }
  const words = shellWords(shell.arguments)
  if (!words) return { kind: "unsupported" }
  const commandOption =
    shell.kind === "posix" ? posixCommandOption : shell.kind === "cmd" ? cmdCommandOption : powershellCommandOption
  const optionIndex = words.findIndex(
    (word, index) =>
      commandOption.test(word) &&
      words.slice(0, index).every((prefix) => prefix.startsWith(shell.kind === "cmd" ? "/" : "-")),
  )
  if (optionIndex === -1 || !words[optionIndex + 1]) return { kind: "unsupported" }
  const wrappedCommand = shell.kind === "posix" ? words[optionIndex + 1] : words.slice(optionIndex + 1).join(" ")
  return { kind: "command", command: wrappedCommand }
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
  let current = command.trim()
  for (let depth = 0; depth < maxShellWrapperDepth; depth += 1) {
    if (ooCommandSegment.test(current)) return true
    const wrapper = shellWrapperCommand(current)
    if (wrapper.kind !== "command") return false
    current = wrapper.command
  }
  return false
}

export function openConnectorCommandPolicy(command: string): "allow" | "deny" | "prompt" | null {
  let current = command.trim()
  for (let depth = 0; depth < maxShellWrapperDepth; depth += 1) {
    if (
      credentialEnvironmentReference.test(current) ||
      isEnvironmentDump(current) ||
      linkEnvironmentAssignment.test(current) ||
      forbiddenOoMutation.test(current) ||
      (ooCommandSegment.test(current) && forbiddenOoOption.test(current))
    ) {
      return "deny"
    }
    if (isPureOoCliCommand(current)) return "allow"
    const wrapper = shellWrapperCommand(current)
    if (wrapper.kind === "unsupported") return "prompt"
    if (wrapper.kind === "not_wrapper") return null
    current = wrapper.command
  }
  return "prompt"
}
