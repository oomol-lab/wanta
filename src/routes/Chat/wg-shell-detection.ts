import type { Command, Redirect, Script, Word } from "unbash"

import { parse } from "unbash"

const shellRecursionLimit = 6

export function isWgKnowledgeShellCommand(command: string): boolean {
  return scanShell(command, 0, "knowledge")
}

export function isWgShellCommand(command: string): boolean {
  return scanShell(command, 0, "executable")
}

function scanShell(command: string, depth: number, mode: "executable" | "knowledge"): boolean {
  if (depth > shellRecursionLimit || command.trim() === "") {
    return false
  }

  const script = parseShell(command)
  if (script === null) {
    return false
  }

  return scanAstValue(script, command, depth, mode)
}

function parseShell(command: string): Script | null {
  try {
    const script = parse(command)
    return script.errors?.length ? null : script
  } catch {
    return null
  }
}

function scanAstValue(value: unknown, source: string, depth: number, mode: "executable" | "knowledge"): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => scanAstValue(item, source, depth, mode))
  }
  if (isAssignmentNode(value)) {
    return scanWord(value.value, depth, mode)
  }
  if (isWord(value)) {
    return scanWord(value, depth, mode)
  }
  if (isCommand(value)) {
    return scanCommand(value, source, depth, mode)
  }
  if (!isRecord(value)) {
    return false
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "type" || key === "pos" || key === "end" || key === "text" || key === "value") {
      continue
    }
    if (scanAstValue(child, source, depth, mode)) {
      return true
    }
  }
  return false
}

function scanCommand(command: Command, source: string, depth: number, mode: "executable" | "knowledge"): boolean {
  const words = command.name ? [command.name, ...command.suffix] : [...command.suffix]
  return (
    scanAstValue(command.prefix, source, depth, mode) || scanCommandWords(words, command.redirects, source, depth, mode)
  )
}

function scanCommandWords(
  words: Word[],
  redirects: Redirect[],
  source: string,
  depth: number,
  mode: "executable" | "knowledge",
): boolean {
  const commandIndex = firstCommandWordIndex(words, 0)
  if (commandIndex >= words.length) {
    return scanNestedWords(words, depth, mode) || scanAstValue(redirects, source, depth, mode)
  }

  const executable = executableName(wordValue(words[commandIndex]))
  if (executable === "env") {
    const envCommandIndex = skipEnvPrefix(words, commandIndex + 1)
    if (scanNestedWords(words.slice(commandIndex + 1, envCommandIndex), depth, mode)) {
      return true
    }
    if (envCommandIndex < words.length) {
      return scanCommandWords(words.slice(envCommandIndex), redirects, source, depth, mode)
    }
  }

  const shellCommandIndex = shellCommandStringIndex(words, commandIndex)
  if (shellCommandIndex !== null) {
    const shellCommand = words[shellCommandIndex]
    if (shellCommand && scanShell(wordValue(shellCommand), depth + 1, mode)) {
      return true
    }
  }

  if (mode === "executable" && isWgExecutable(executable)) {
    return true
  }
  if (isWgExecutable(executable) && words.slice(commandIndex + 1).some((word) => wordContainsWikgUri(word))) {
    return true
  }

  return scanNestedWords(words, depth, mode) || scanAstValue(redirects, source, depth, mode)
}

function scanNestedWords(words: Word[], depth: number, mode: "executable" | "knowledge"): boolean {
  return words.some((word) => scanWord(word, depth, mode))
}

function scanWord(word: Word, depth: number, mode: "executable" | "knowledge"): boolean {
  // unbash exposes the command structure as AST, but its public package exports do not include the
  // word-part helper that materializes command/process substitutions. Keep this small scanner bounded
  // to unbash-provided Word nodes so the main detection path remains AST-based.
  for (const substitution of executableSubstitutionsInWord(word.text)) {
    if (scanShell(substitution, depth + 1, mode)) {
      return true
    }
  }
  return false
}

function firstCommandWordIndex(words: Word[], start: number): number {
  let index = start
  while (index < words.length && isAssignment(wordValue(words[index]))) {
    index += 1
  }
  return index
}

function skipEnvPrefix(words: Word[], start: number): number {
  let index = start
  while (index < words.length) {
    const value = wordValue(words[index])
    if (isAssignment(value)) {
      index += 1
      continue
    }
    if (value === "-" || value.startsWith("-i") || value.startsWith("--ignore-environment")) {
      index += 1
      continue
    }
    if ((value === "-u" || value === "--unset") && index + 1 < words.length) {
      index += 2
      continue
    }
    break
  }
  return index
}

function shellCommandStringIndex(words: Word[], commandIndex: number): number | null {
  const executable = executableName(wordValue(words[commandIndex]))
  if (executable !== "bash" && executable !== "sh" && executable !== "zsh") {
    return null
  }
  for (let index = commandIndex + 1; index < words.length; index += 1) {
    const word = wordValue(words[index])
    if (word === "--") {
      continue
    }
    if (word === "-c") {
      return index + 1 < words.length ? index + 1 : null
    }
    if (/^-[A-Za-z]*c[A-Za-z]*$/u.test(word)) {
      return index + 1 < words.length ? index + 1 : null
    }
    if (!word.startsWith("-")) {
      return null
    }
  }
  return null
}

function executableSubstitutionsInWord(word: string): string[] {
  const substitutions: string[] = []
  let quote: "single" | "double" | null = null

  for (let index = 0; index < word.length; index += 1) {
    const char = word[index]
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
    if (char === "$" && word[index + 1] === "(") {
      const result = readBalanced(word, index + 1, "(", ")")
      if (result) {
        substitutions.push(result.content)
        index = result.end
      }
      continue
    }
    if (quote === null && char === "<" && word[index + 1] === "(") {
      const result = readBalanced(word, index + 1, "(", ")")
      if (result) {
        substitutions.push(result.content)
        index = result.end
      }
      continue
    }
    if (char === "`") {
      const end = readBacktick(word, index)
      if (end > index) {
        substitutions.push(word.slice(index + 1, end))
        index = end
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
  for (let index = openIndex; index < input.length; index += 1) {
    const char = input[index]
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
    if (char === openChar) {
      depth += 1
      continue
    }
    if (char === closeChar) {
      depth -= 1
      if (depth === 0) {
        return { content: input.slice(openIndex + 1, index), end: index }
      }
    }
  }
  return null
}

function readBacktick(input: string, start: number): number {
  for (let index = start + 1; index < input.length; index += 1) {
    if (input[index] === "\\") {
      index += 1
      continue
    }
    if (input[index] === "`") {
      return index
    }
  }
  return -1
}

function wordContainsWikgUri(word: Word): boolean {
  return wordValue(word).includes("wikg://")
}

function wordValue(word: Word | undefined): string {
  return word?.value ?? word?.text ?? ""
}

function executableName(word: string): string {
  const withoutTrailingSlash = word.replace(/\/+$/u, "")
  const slash = withoutTrailingSlash.lastIndexOf("/")
  return (slash >= 0 ? withoutTrailingSlash.slice(slash + 1) : withoutTrailingSlash).toLowerCase()
}

function isWgExecutable(name: string): boolean {
  return name === "wg" || name === "wikigraph"
}

function isAssignment(word: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/u.test(word)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isCommand(value: unknown): value is Command {
  return isRecord(value) && value.type === "Command"
}

function isAssignmentNode(value: unknown): value is { type: "Assignment"; value: Word } {
  return isRecord(value) && value.type === "Assignment" && isWord(value.value)
}

function isWord(value: unknown): value is Word {
  return (
    isRecord(value) && typeof value.text === "string" && typeof value.pos === "number" && typeof value.end === "number"
  )
}
