import type { TopLevelShellSegment } from "./shell-syntax.ts"

import path from "node:path"
import {
  commandWithoutInertOutputSuffixes,
  explicitCdDirectory,
  hasUnsafeShellSyntax,
  shellCommandName,
  shellWords,
  topLevelShellSegments,
  unwrappedShellCommandWords,
} from "./shell-syntax.ts"

export interface ScopedCommandStep {
  command: string
  cwd?: string
}

// Shell grammar/control and in-process definitions cannot be treated as
// independent child commands with a stable cwd. Ordinary executables stay open.
const shellControlCommands = new Set([
  ".",
  "source",
  "eval",
  "pushd",
  "popd",
  "exec",
  "function",
  "alias",
  "unalias",
  "trap",
  "if",
  "then",
  "elif",
  "else",
  "fi",
  "for",
  "while",
  "until",
  "do",
  "done",
  "case",
  "esac",
  "select",
  "repeat",
  "foreach",
  "end",
  "coproc",
  "!",
])

function commandGroups(command: string): TopLevelShellSegment[] | undefined {
  const segments = topLevelShellSegments(command)
  if (segments.length < 2) return undefined
  const groups: TopLevelShellSegment[] = []
  let text = ""
  for (const [index, segment] of segments.entries()) {
    text += segment.text
    if (segment.operatorAfter === "pipe") {
      if (index === segments.length - 1) return undefined
      text += " | "
      continue
    }
    if (segment.operatorAfter && segment.operatorAfter !== "and" && segment.operatorAfter !== "sequence")
      return undefined
    if (segment.operatorAfter === "and" && index === segments.length - 1) return undefined
    groups.push({ text, operatorAfter: segment.operatorAfter })
    text = ""
  }
  return groups
}

/**
 * Expand ordinary command lists, retaining each step's proven directory.
 * Output-filter pipelines stay intact and must pass the existing inert-suffix
 * parser. Semicolons/newlines do not imply a preceding cd succeeded.
 * This is an approval optimization, not a shell sandbox. Ambiguous control flow
 * returns to the ordinary policy rather than inventing a working directory.
 */
export function scopedCommandSequence(command: string, initialCwd?: string): ScopedCommandStep[] | undefined {
  const groups = commandGroups(command)
  if (!groups) return undefined

  const steps: ScopedCommandStep[] = []
  let cwd = initialCwd
  let directoryMayDifferOnFailure = false
  for (const segment of groups) {
    const body = commandWithoutInertOutputSuffixes(segment.text)
    const words = shellWords(body)
    if (!words?.length || hasUnsafeShellSyntax(body)) return undefined
    const unwrapped = unwrappedShellCommandWords(words, false)
    const name = shellCommandName(unwrapped[0])
    if (name === "cd") {
      // A cd inside a pipeline may run in a subshell. It cannot prove the
      // parent shell's directory, even if its output filter is harmless.
      if (topLevelShellSegments(segment.text).some((part) => part.operatorAfter === "pipe")) return undefined
      const directory = explicitCdDirectory(body)
      if (!directory) return undefined
      const paths = /^[A-Za-z]:[\\/]/u.test(directory) || /^[A-Za-z]:[\\/]/u.test(cwd ?? "") ? path.win32 : path.posix
      const nextCwd = paths.isAbsolute(directory)
        ? paths.normalize(directory)
        : cwd
          ? paths.resolve(cwd, directory)
          : undefined
      directoryMayDifferOnFailure ||= nextCwd !== cwd
      cwd = nextCwd
      if (!cwd) return undefined
    } else {
      // These execute in the current shell and may change directory or define
      // commands used by later steps. A child process cannot change parent cwd.
      if (!name || shellControlCommands.has(name) || /[(){}=]/u.test(unwrapped[0] ?? "")) return undefined
      steps.push({ command: segment.text, cwd })
    }
    if (segment.operatorAfter === "sequence") {
      if (directoryMayDifferOnFailure) cwd = undefined
      directoryMayDifferOnFailure = false
    }
  }
  return steps.length > 0 ? steps : undefined
}
