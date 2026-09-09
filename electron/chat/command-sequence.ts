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

/**
 * Expand straight-line success chains, retaining each step's actual directory.
 * This is an approval optimization, not a shell sandbox. Ambiguous control flow
 * returns to the ordinary policy rather than inventing a working directory.
 */
export function scopedCommandSequence(command: string, initialCwd?: string): ScopedCommandStep[] | undefined {
  const segments = topLevelShellSegments(command)
  if (
    segments.length < 2 ||
    segments.some((segment, index) => segment.operatorAfter !== (index < segments.length - 1 ? "and" : undefined))
  )
    return undefined

  const steps: ScopedCommandStep[] = []
  let cwd = initialCwd
  for (const segment of segments) {
    const body = commandWithoutInertOutputSuffixes(segment.text)
    const words = shellWords(body)
    if (!words?.length || hasUnsafeShellSyntax(body)) return undefined
    const unwrapped = unwrappedShellCommandWords(words, false)
    const name = shellCommandName(unwrapped[0])
    if (name === "cd") {
      const directory = explicitCdDirectory(body)
      if (!directory) return undefined
      const paths = /^[A-Za-z]:[\\/]/u.test(directory) || /^[A-Za-z]:[\\/]/u.test(cwd ?? "") ? path.win32 : path.posix
      cwd = paths.isAbsolute(directory) ? paths.normalize(directory) : cwd ? paths.resolve(cwd, directory) : undefined
      if (!cwd) return undefined
    } else {
      // These execute in the current shell and may change directory or define
      // commands used by later steps. A child process cannot change parent cwd.
      if (
        !name ||
        ["source", ".", "eval", "pushd", "popd", "exec", "function"].includes(name) ||
        /[(){}=]/u.test(unwrapped[0] ?? "")
      )
        return undefined
      steps.push({ command: segment.text, cwd })
    }
  }
  return steps.length > 0 ? steps : undefined
}
