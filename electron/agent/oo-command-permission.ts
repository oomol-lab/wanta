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

function isManagedOoExecutable(word: string): boolean {
  return word === "$WANTA_OO_BIN" || word === "${WANTA_OO_BIN}"
}

const credentialEnvironmentReference = /\b(?:OO_CONNECTOR_TOKEN|OO_API_KEY)\b/u
const environmentDumpCommand = /^(?:env|printenv|set|export|declare\s+-x|typeset\s+-x)(?:\s|$)/u
const linkEnvironmentAssignment = /\b(?:OO_CONNECTOR_URL|OO_ENDPOINT|OO_CONFIG_DIR|OO_DATA_DIR)\s*=/u
const ooCommandSegment = /(?:^|[;&|]{1,2}\s*)(?:oo|"?\$WANTA_OO_BIN"?|"?\$\{WANTA_OO_BIN\}"?)(?:\s|$)/u
const forbiddenOoMutation =
  /(?:^|[;&|]{1,2}\s*)(?:oo|"?\$WANTA_OO_BIN"?|"?\$\{WANTA_OO_BIN\}"?)\s+(?:(?:auth|login|logout|config)(?:\s|[;&|]|$)|connector\s+(?:login|logout)(?:\s|[;&|]|$))/u
const forbiddenOoOption = /(?:^|\s)--(?:endpoint|config-dir|data-dir|connector-url|connector-token)(?:=|\s|$)/u
const maxShellWrapperDepth = 8
const posixCommandOption = /^-[A-Za-z]*c[A-Za-z]*$/u
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

// oo global flags that may precede the subcommand. Kept in sync with
// oo-guard-core.ts connectorCommandIndex so a leading `--debug` / `--lang zh`
// can never smuggle a forbidden subcommand past forbiddenOoMutation.
const ooGlobalFlagWithValue = "--lang"
const ooGlobalBooleanFlags = new Set(["--debug", "-h", "--help", "-V", "--version"])

/** Advance past oo global flags (commander accepts them before AND between subcommands). */
function skipOoGlobalFlags(tokens: readonly string[], start: number): number {
  let index = start
  while (index < tokens.length) {
    const arg = tokens[index] ?? ""
    if (arg === ooGlobalFlagWithValue) {
      index += 2
      continue
    }
    if (arg.startsWith(`${ooGlobalFlagWithValue}=`) || ooGlobalBooleanFlags.has(arg)) {
      index += 1
      continue
    }
    break
  }
  return index
}

/** Tokens of a single `oo ...` command after skipping leading global flags, or null if not a bare oo call. */
function ooSubcommandTokens(command: string): string[] | null {
  const words = shellWords(command.trim())
  if (!words || !isOoExecutable(words[0] ?? "")) {
    return null
  }
  return words.slice(skipOoGlobalFlags(words, 1))
}

export type ConnectorBusinessCliTransport = "bare" | "managed"

/**
 * Detect Link business operations anywhere in a native shell request. This is
 * intentionally independent of the strict auto-allow parser: even a pipeline
 * or sequence that would fall through to the ordinary command policy must not
 * bypass the host-capability transport gate when Wanta Link is active.
 */
export function connectorBusinessCliTransport(command: string): ConnectorBusinessCliTransport | null {
  let current = command.trim()
  for (let depth = 0; depth < maxShellWrapperDepth; depth += 1) {
    const words = shellWords(current)
    if (words) {
      for (let index = 0; index < words.length; index += 1) {
        const executable = words[index] ?? ""
        if (!isOoExecutable(executable)) continue
        let cursor = skipOoGlobalFlags(words, index + 1)
        if (words[cursor] !== "connector") continue
        cursor = skipOoGlobalFlags(words, cursor + 1)
        if (["apps", "run", "proxy"].includes(words[cursor] ?? "")) {
          return isManagedOoExecutable(executable) ? "managed" : "bare"
        }
      }
    }
    const wrapper = shellWrapperCommand(current)
    if (wrapper.kind !== "command") return null
    current = wrapper.command
  }
  return null
}

/**
 * Whether a single `oo` invocation mutates host-managed connector auth or
 * configuration. Unlike the regex forbiddenOoMutation this is flag-aware, so
 * `oo --lang zh connector logout` and `oo connector --lang zh logout` (global
 * flags may sit before AND between subcommands) are still denied.
 */
export function isForbiddenOoMutationCommand(command: string): boolean {
  const tokens = ooSubcommandTokens(command)
  if (!tokens || tokens.length === 0) {
    return false
  }
  const subcommand = tokens[0]
  if (subcommand === "auth" || subcommand === "login" || subcommand === "logout" || subcommand === "config") {
    return true
  }
  if (subcommand !== "connector") {
    return false
  }
  // Global flags can also appear between `connector` and its subcommand.
  const connectorSubcommand = tokens[skipOoGlobalFlags(tokens, 1)]
  return connectorSubcommand === "login" || connectorSubcommand === "logout"
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

export function openConnectorCommandPolicy(command: string): "allow" | "deny" | null {
  let current = command.trim()
  for (let depth = 0; depth < maxShellWrapperDepth; depth += 1) {
    if (
      credentialEnvironmentReference.test(current) ||
      isEnvironmentDump(current) ||
      linkEnvironmentAssignment.test(current) ||
      forbiddenOoMutation.test(current) ||
      isForbiddenOoMutationCommand(current) ||
      (ooCommandSegment.test(current) && forbiddenOoOption.test(current))
    ) {
      return "deny"
    }
    if (isPureOoCliCommand(current)) return "allow"
    const wrapper = shellWrapperCommand(current)
    if (wrapper.kind === "unsupported" || wrapper.kind === "not_wrapper") return null
    current = wrapper.command
  }
  return null
}
