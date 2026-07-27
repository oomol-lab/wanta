const shellRecursionLimit = 6

interface ShellWordToken {
  kind: "word"
  value: string
}

interface ShellOperatorToken {
  kind: "operator"
  value: string
}

type ShellToken = ShellWordToken | ShellOperatorToken

export function isWgKnowledgeShellCommand(command: string): boolean {
  return scanShell(command, 0)
}

function scanShell(command: string, depth: number): boolean {
  const shell = stripHeredocBodies(command)
  if (depth > shellRecursionLimit || shell.trim() === "") {
    return false
  }
  for (const substitution of executableSubstitutions(shell)) {
    if (scanShell(substitution, depth + 1)) {
      return true
    }
  }
  const tokens = tokenizeShell(shell)
  let words: string[] = []
  for (const token of tokens) {
    if (token.kind === "operator") {
      if (matchesSimpleCommand(words, depth)) {
        return true
      }
      words = []
      continue
    }
    words.push(token.value)
  }
  return matchesSimpleCommand(words, depth)
}

function stripHeredocBodies(command: string): string {
  const lines = command.split(/\r?\n/u)
  const kept: string[] = []
  let pendingDelimiter: string | null = null
  for (const line of lines) {
    if (pendingDelimiter !== null) {
      if (line.trim() === pendingDelimiter) {
        pendingDelimiter = null
      }
      continue
    }
    kept.push(line)
    pendingDelimiter = heredocDelimiter(line)
  }
  return kept.join("\n")
}

function heredocDelimiter(line: string): string | null {
  let quote: "single" | "double" | null = null
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quote === "single") {
      if (char === "'") {
        quote = null
      }
      continue
    }
    if (char === "\\") {
      index += 1
      continue
    }
    if (char === '"') {
      quote = quote === "double" ? null : "double"
      continue
    }
    if (char === "'") {
      quote = "single"
      continue
    }
    if (quote !== null || char !== "<" || line[index + 1] !== "<") {
      continue
    }
    let cursor = index + 2
    if (line[cursor] === "-") {
      cursor += 1
    }
    while (/\s/u.test(line[cursor] ?? "")) {
      cursor += 1
    }
    const delimiter = readHeredocDelimiter(line, cursor)
    if (delimiter) {
      return delimiter
    }
  }
  return null
}

function readHeredocDelimiter(line: string, start: number): string | null {
  const quote = line[start]
  if (quote === "'" || quote === '"') {
    const end = line.indexOf(quote, start + 1)
    return end > start + 1 ? line.slice(start + 1, end) : null
  }
  const match = /^[^\s;&|()<>]+/u.exec(line.slice(start))
  return match?.[0] ?? null
}

function executableSubstitutions(command: string): string[] {
  const substitutions: string[] = []
  let quote: "single" | "double" | null = null
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]
    if (quote === "single") {
      if (char === "'") {
        quote = null
      }
      continue
    }
    if (char === "\\") {
      i += 1
      continue
    }
    if (char === '"') {
      quote = quote === "double" ? null : "double"
      continue
    }
    if (char === "'") {
      quote = "single"
      continue
    }
    if (char === "$" && command[i + 1] === "(") {
      const result = readBalanced(command, i + 1, "(", ")")
      if (result) {
        substitutions.push(result.content)
        i = result.end
      }
      continue
    }
    if (quote === null && char === "<" && command[i + 1] === "(") {
      const result = readBalanced(command, i + 1, "(", ")")
      if (result) {
        substitutions.push(result.content)
        i = result.end
      }
      continue
    }
    if (quote === null && char === "`") {
      const end = readBacktick(command, i)
      if (end > i) {
        substitutions.push(command.slice(i + 1, end))
        i = end
      }
    }
  }
  return substitutions
}

function readBalanced(
  input: string,
  openIndex: number,
  openChar: string,
  closeChar: string,
): { content: string; end: number } | null {
  let quote: "single" | "double" | null = null
  let depth = 0
  for (let i = openIndex; i < input.length; i += 1) {
    const char = input[i]
    if (quote === "single") {
      if (char === "'") {
        quote = null
      }
      continue
    }
    if (char === "\\") {
      i += 1
      continue
    }
    if (char === '"') {
      quote = quote === "double" ? null : "double"
      continue
    }
    if (char === "'") {
      quote = "single"
      continue
    }
    if (char === openChar) {
      depth += 1
      continue
    }
    if (char === closeChar) {
      depth -= 1
      if (depth === 0) {
        return { content: input.slice(openIndex + 1, i), end: i }
      }
    }
  }
  return null
}

function readBacktick(input: string, start: number): number {
  for (let i = start + 1; i < input.length; i += 1) {
    if (input[i] === "\\") {
      i += 1
      continue
    }
    if (input[i] === "`") {
      return i
    }
  }
  return -1
}

function tokenizeShell(command: string): ShellToken[] {
  const tokens: ShellToken[] = []
  let word = ""
  const flushWord = () => {
    if (word !== "") {
      tokens.push({ kind: "word", value: word })
      word = ""
    }
  }

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]
    if (/\s/.test(char)) {
      flushWord()
      if (char === "\n") {
        tokens.push({ kind: "operator", value: ";" })
      }
      continue
    }
    if (char === "\\") {
      if (i + 1 < command.length) {
        word += command[i + 1]
        i += 1
      }
      continue
    }
    if (char === "'" || char === '"') {
      const result = readQuotedWord(command, i, char)
      word += result.value
      i = result.end
      continue
    }
    if (char === "$" && command[i + 1] === "(") {
      const result = readBalanced(command, i + 1, "(", ")")
      if (result) {
        word += command.slice(i, result.end + 1)
        i = result.end
        continue
      }
    }
    if (char === "&" && command[i + 1] === "&") {
      flushWord()
      tokens.push({ kind: "operator", value: "&&" })
      i += 1
      continue
    }
    if (char === "|" && command[i + 1] === "|") {
      flushWord()
      tokens.push({ kind: "operator", value: "||" })
      i += 1
      continue
    }
    if (char === "|" || char === ";" || char === "(" || char === ")") {
      flushWord()
      tokens.push({ kind: "operator", value: char })
      continue
    }
    word += char
  }
  flushWord()
  return tokens
}

function readQuotedWord(input: string, start: number, quote: "'" | '"'): { value: string; end: number } {
  let value = ""
  for (let i = start + 1; i < input.length; i += 1) {
    const char = input[i]
    if (char === quote) {
      return { value, end: i }
    }
    if (quote === '"' && char === "\\" && i + 1 < input.length) {
      value += input[i + 1]
      i += 1
      continue
    }
    value += char
  }
  return { value, end: input.length - 1 }
}

function matchesSimpleCommand(words: string[], depth: number): boolean {
  const commandWords = words.filter(Boolean)
  let index = skipAssignmentPrefix(commandWords, 0)
  if (index >= commandWords.length) {
    return false
  }
  const executable = commandWords[index]
  if (isEnvExecutable(executable)) {
    index = skipEnvPrefix(commandWords, index + 1)
    if (index >= commandWords.length) {
      return false
    }
  }
  const shellCommandIndex = shellCommandStringIndex(commandWords, index)
  if (shellCommandIndex !== null) {
    return scanShell(commandWords[shellCommandIndex] ?? "", depth + 1)
  }
  return (
    isWgExecutable(executableName(commandWords[index] ?? "")) && commandWords.slice(index + 1).some(containsWikgUri)
  )
}

function skipAssignmentPrefix(words: string[], start: number): number {
  let index = start
  while (index < words.length && isAssignment(words[index] ?? "")) {
    index += 1
  }
  return index
}

function skipEnvPrefix(words: string[], start: number): number {
  let index = start
  while (index < words.length) {
    const word = words[index] ?? ""
    if (isAssignment(word)) {
      index += 1
      continue
    }
    if (word === "-" || word.startsWith("-i") || word.startsWith("--ignore-environment")) {
      index += 1
      continue
    }
    if ((word === "-u" || word === "--unset") && index + 1 < words.length) {
      index += 2
      continue
    }
    break
  }
  return index
}

function shellCommandStringIndex(words: string[], commandIndex: number): number | null {
  const executable = executableName(words[commandIndex] ?? "")
  if (executable !== "bash" && executable !== "sh" && executable !== "zsh") {
    return null
  }
  for (let index = commandIndex + 1; index < words.length; index += 1) {
    const word = words[index] ?? ""
    if (word === "--") {
      continue
    }
    if (word === "-c") {
      return index + 1 < words.length ? index + 1 : null
    }
    if (/^-[A-Za-z]*c[A-Za-z]*$/.test(word)) {
      return index + 1 < words.length ? index + 1 : null
    }
    if (!word.startsWith("-")) {
      return null
    }
  }
  return null
}

function executableName(word: string): string {
  const withoutTrailingSlash = word.replace(/\/+$/, "")
  const slash = withoutTrailingSlash.lastIndexOf("/")
  return (slash >= 0 ? withoutTrailingSlash.slice(slash + 1) : withoutTrailingSlash).toLowerCase()
}

function isEnvExecutable(word: string): boolean {
  return executableName(word) === "env"
}

function isWgExecutable(name: string): boolean {
  return name === "wg" || name === "wikigraph"
}

function isAssignment(word: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)
}

function containsWikgUri(word: string): boolean {
  return word.includes("wikg://")
}
