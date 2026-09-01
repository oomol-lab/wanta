import path from "node:path"
import {
  effectiveShellCommandWords,
  explicitCdDirectory,
  shellCommandName,
  shellWords,
  splitLeadingAnd,
  topLevelShellSegments,
} from "./shell-syntax.ts"

const generatedProjectDirectories = new Set([
  ".cache",
  ".next",
  ".nuxt",
  ".output",
  ".parcel-cache",
  ".svelte-kit",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
])

function optionHasLetter(word: string, letter: string): boolean {
  return /^-[^-]/u.test(word) && word.slice(1).includes(letter)
}

function recursiveDelete(words: readonly string[]): boolean {
  if (shellCommandName(words[0]) !== "rm") return false
  return words
    .slice(1)
    .some((word) => word === "--recursive" || optionHasLetter(word, "r") || optionHasLetter(word, "R"))
}

function normalizedRoot(root: string | undefined): string | undefined {
  if (!root?.trim()) return undefined
  const resolved = path.resolve(root)
  return resolved === path.parse(resolved).root ? undefined : resolved
}

function strictChild(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return Boolean(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function isTemporaryCleanupTarget(target: string): boolean {
  const temporaryRoots = new Set(["/tmp", "/var/tmp", "/private/tmp"])
  try {
    temporaryRoots.add(path.resolve("/tmp"))
    temporaryRoots.add(path.resolve("/var/tmp"))
  } catch {
    // Ignore platforms that cannot resolve these roots.
  }
  return [...temporaryRoots].some((root) => {
    const resolvedRoot = normalizedRoot(root)
    if (!resolvedRoot || !strictChild(resolvedRoot, target)) {
      return false
    }
    return !path.relative(resolvedRoot, target).includes(path.sep)
  })
}

function boundedCleanupTarget(
  target: string,
  cwd: string | undefined,
  context: { taskProcessRoot?: string; trustedProjectRoot?: string },
): boolean {
  if (!target || /[*?[\]{}$`]/u.test(target) || target === "~" || target.startsWith("~/")) return false
  const absoluteTarget = path.isAbsolute(target) ? path.resolve(target) : cwd ? path.resolve(cwd, target) : undefined
  if (!absoluteTarget) return false

  const processRoot = normalizedRoot(context.taskProcessRoot)
  if (processRoot && strictChild(processRoot, absoluteTarget)) return true
  if (isTemporaryCleanupTarget(absoluteTarget)) return true

  const projectRoot = normalizedRoot(context.trustedProjectRoot)
  if (!projectRoot || !strictChild(projectRoot, absoluteTarget)) return false
  const relative = path.relative(projectRoot, absoluteTarget)
  // Only remove the generated directory itself. Refusing descendants avoids following a
  // generated-directory symlink into an unrelated location.
  return !relative.includes(path.sep) && generatedProjectDirectories.has(relative)
}

/**
 * Recognizes a deliberately narrow subset of recursive cleanup that is cheap to recover:
 * children of `/tmp` and `/var/tmp` (one path segment), direct children of Wanta's per-turn
 * process directory, and well-known generated project roots. Any composition, wildcard, variable,
 * home path, broad root, or ordinary project directory stays protected.
 */
export function isLowConsequenceCleanupCommand(
  command: string,
  context: { taskProcessRoot?: string; trustedProjectRoot?: string },
): boolean {
  let body = command.trim()
  let cwd: string | undefined
  const leading = splitLeadingAnd(body)
  if (leading) {
    cwd = explicitCdDirectory(leading.left)
    if (!cwd || !leading.right) return false
    body = leading.right
  }
  const segments = topLevelShellSegments(body)
  if (segments.length !== 1 || segments[0]?.operatorAfter) return false
  const parsed = shellWords(segments[0]?.text ?? "")
  if (!parsed?.length) return false
  const words = effectiveShellCommandWords(parsed)
  if (!recursiveDelete(words)) return false

  const targets: string[] = []
  let optionsEnded = false
  for (const word of words.slice(1)) {
    if (!optionsEnded && word === "--") {
      optionsEnded = true
      continue
    }
    if (!optionsEnded && word.startsWith("-")) continue
    targets.push(word)
  }
  return targets.length > 0 && targets.every((target) => boundedCleanupTarget(target, cwd, context))
}
