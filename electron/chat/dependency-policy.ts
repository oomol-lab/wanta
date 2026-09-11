import { managedPythonExecutables, projectPythonExecutables } from "../agent/python-environment.ts"
import { scopedCommandSequence } from "./command-sequence.ts"
import { resolveShellPath } from "./shell-path.ts"
import {
  shellCommandName,
  shellWords,
  shellWordsWithoutRedirections,
  topLevelShellSegments,
  unwrappedShellCommandWords,
} from "./shell-syntax.ts"

export const protectedPipInstallOptions = new Set([
  "-c",
  "-e",
  "-f",
  "-i",
  "-r",
  "-t",
  "--break-system-packages",
  "--build-constraint",
  "--config-file",
  "--constraint",
  "--default-index",
  "--editable",
  "--extra-index-url",
  "--find-links",
  "--group",
  "--index",
  "--index-url",
  "--prefix",
  "--requirement",
  "--requirements-from-script",
  "--root",
  "--target",
  "--trusted-host",
  "--user",
])

export function pipOptionName(word: string): string {
  if (!word.startsWith("--")) {
    for (const shortOption of ["-c", "-e", "-f", "-i", "-r", "-t"]) {
      if (word.startsWith(shortOption) && word !== shortOption) {
        return shortOption
      }
    }
  }
  const separator = word.indexOf("=")
  return separator >= 0 ? word.slice(0, separator) : word
}

const nodePackageSpecPattern = /^[A-Za-z0-9*+.!<>=~^_-]+$/u
const nodePackageManagers = new Set(["bun", "npm", "pnpm", "yarn"])
const nodeDependencyVerbs = new Set([
  "add",
  "ci",
  "i",
  "install",
  "link",
  "remove",
  "rm",
  "uninstall",
  "update",
  "upgrade",
])
const pythonDependencyVerbs = new Set(["add", "install", "remove", "uninstall"])
const pipxDependencyVerbs = new Set([
  "inject",
  "install",
  "reinstall",
  "reinstall-all",
  "uninject",
  "uninstall",
  "uninstall-all",
  "upgrade",
  "upgrade-all",
])
const uvToolDependencyVerbs = new Set(["install", "uninstall", "upgrade"])

const nodeSourceOptions = new Set(["--globalconfig", "--registry", "--userconfig"])
const pythonSourceOptions = new Set([
  "-f",
  "-i",
  "--config-file",
  "--default-index",
  "--extra-index-url",
  "--find-links",
  "--index",
  "--index-url",
  "--trusted-host",
])
const nodeOptionsWithValue = new Set([
  "-C",
  "-w",
  "--cache",
  "--cache-dir",
  "--config",
  "--cwd",
  "--dir",
  "--filter",
  "--global-folder",
  "--globalconfig",
  "--install-strategy",
  "--location",
  "--lockfile-dir",
  "--loglevel",
  "--modules-dir",
  "--network-concurrency",
  "--prefix",
  "--registry",
  "--reporter",
  "--save-prefix",
  "--script-shell",
  "--store-dir",
  "--tag",
  "--userconfig",
  "--virtual-store-dir",
  "--workspace",
])
const packageRunnerOptionsWithValue = new Set([
  ...nodeOptionsWithValue,
  "-c",
  "-p",
  "--argv0",
  "--call",
  "--node-options",
  "--npm",
  "--package",
  "--shell",
])
const pythonOptionsWithValue = new Set([
  "-f",
  "-i",
  "--cache-dir",
  "--config-file",
  "--config-settings",
  "--constraint",
  "--default-index",
  "--editable",
  "--extra-index-url",
  "--find-links",
  "--group",
  "--index",
  "--index-url",
  "--keyring-provider",
  "--log",
  "--prefix",
  "--progress-bar",
  "--python",
  "--report",
  "--requirement",
  "--root",
  "--src",
  "--target",
  "--timeout",
  "--trusted-host",
])
interface CliWord {
  index: number
  value: string
}

interface NodeDependencyOperation {
  manager: string
  verb: string
  verbIndex: number
}

interface PythonDependencyOperation {
  verb: string
  verbIndex: number
}

interface PackageRunnerInvocation {
  sourceOverride: boolean
  specifiers: string[]
}

function optionName(word: string): string {
  const separator = word.indexOf("=")
  return separator >= 0 ? word.slice(0, separator) : word
}

function inlineOptionValue(word: string): string | undefined {
  const separator = word.indexOf("=")
  return separator >= 0 ? word.slice(separator + 1) : undefined
}

function nextCliWord(
  words: readonly string[],
  startIndex: number,
  optionsWithValue: ReadonlySet<string>,
): CliWord | undefined {
  for (let index = startIndex; index < words.length; index += 1) {
    const word = words[index] ?? ""
    if (word === "--") {
      const value = words[index + 1]
      return value ? { index: index + 1, value } : undefined
    }
    if (word.startsWith("-")) {
      if (optionsWithValue.has(optionName(word)) && inlineOptionValue(word) === undefined) {
        index += 1
      }
      continue
    }
    return { index, value: word }
  }
  return undefined
}

function nodeManagerCommand(words: readonly string[]): CliWord | undefined {
  return nodePackageManagers.has(shellCommandName(words[0]) ?? "")
    ? nextCliWord(words, 1, nodeOptionsWithValue)
    : undefined
}

function packageRunnerStart(words: readonly string[]): number | undefined {
  const name = shellCommandName(words[0])
  if (name === "npx" || name === "bunx") {
    return 1
  }
  const command = nodeManagerCommand(words)
  if (!command) {
    return undefined
  }
  const verb = command.value.toLowerCase()
  if (name === "npm" && (verb === "exec" || verb === "x")) {
    return command.index + 1
  }
  if (name === "bun" && verb === "x") {
    return command.index + 1
  }
  if ((name === "pnpm" || name === "yarn") && verb === "dlx") {
    return command.index + 1
  }
  return undefined
}

/** Inspect the launched CLI, without treating package-runner arguments as effects. */
export function packageRunnerCommandWords(words: readonly string[]): readonly string[] | undefined {
  const manager = shellCommandName(words[0])
  const managerCommand = nodeManagerCommand(words)
  const start =
    packageRunnerStart(words) ??
    (managerCommand?.value === "exec" && (manager === "pnpm" || manager === "yarn")
      ? managerCommand.index + 1
      : undefined)
  if (start === undefined) return undefined
  let index = start
  for (; index < words.length; index += 1) {
    const word = words[index] ?? ""
    if (word === "--") {
      index += 1
      break
    }
    if (!word.startsWith("-")) break
    const option = optionName(word)
    // Shell text is not an argv executable; leave it to the ordinary script policy.
    if (option === "-c" || option === "--call") return undefined
    if (packageRunnerOptionsWithValue.has(option) && inlineOptionValue(word) === undefined) index += 1
  }
  const executable = words[index]
  if (!executable) return undefined
  const packageName = canonicalRegistryNodePackageName(executable)
  return [packageName ?? executable, ...words.slice(index + 1)]
}

/**
 * Parses only the package-selection portion of a package runner. Once its executable
 * operand is reached, every remaining word belongs to that executable and cannot change
 * the runner's registry, package source, or selected package.
 */
function packageRunnerInvocation(words: readonly string[]): PackageRunnerInvocation | null {
  const startIndex = packageRunnerStart(words)
  if (startIndex === undefined) {
    return null
  }
  const explicitPackages: string[] = []
  let implicitPackage: string | undefined
  let sourceOverride = words.slice(1, startIndex).some((word) => nodeSourceOptions.has(optionName(word)))
  for (let index = startIndex; index < words.length; index += 1) {
    const word = words[index] ?? ""
    if (word === "--") {
      if (explicitPackages.length === 0) {
        implicitPackage = words[index + 1]
      }
      break
    }
    const option = optionName(word)
    if (nodeSourceOptions.has(option)) {
      sourceOverride = true
    }
    if (option === "--package" || option === "-p") {
      const packageSpecifier = inlineOptionValue(word) ?? words[(index += 1)]
      if (packageSpecifier) {
        explicitPackages.push(packageSpecifier)
      }
      continue
    }
    if (word.startsWith("-")) {
      if (packageRunnerOptionsWithValue.has(option) && inlineOptionValue(word) === undefined) {
        index += 1
      }
      continue
    }
    if (explicitPackages.length === 0) {
      implicitPackage = word
    }
    break
  }
  return {
    sourceOverride,
    specifiers: explicitPackages.length > 0 ? explicitPackages : implicitPackage ? [implicitPackage] : [],
  }
}

function nodeDependencyOperation(words: readonly string[]): NodeDependencyOperation | null {
  const manager = shellCommandName(words[0])
  if (!manager || !nodePackageManagers.has(manager)) {
    return null
  }
  const command = nodeManagerCommand(words)
  if (!command) {
    return null
  }
  const verb = command.value.toLowerCase()
  if (nodeDependencyVerbs.has(verb)) {
    return { manager, verb, verbIndex: command.index }
  }
  if (manager !== "yarn" || verb !== "global") {
    return null
  }
  const nested = nextCliWord(words, command.index + 1, nodeOptionsWithValue)
  const nestedVerb = nested?.value.toLowerCase()
  return nested && nestedVerb && nodeDependencyVerbs.has(nestedVerb)
    ? { manager, verb: nestedVerb, verbIndex: nested.index }
    : null
}

function pythonDependencyOperation(words: readonly string[]): PythonDependencyOperation | null {
  const name = shellCommandName(words[0])
  if (!name) {
    return null
  }
  if (name === "pip" || name === "pip3" || name === "poetry") {
    const command = nextCliWord(words, 1, pythonOptionsWithValue)
    const verb = command?.value.toLowerCase()
    return command && verb && pythonDependencyVerbs.has(verb) ? { verb, verbIndex: command.index } : null
  }
  if (name === "pipx") {
    const command = nextCliWord(words, 1, pythonOptionsWithValue)
    const verb = command?.value.toLowerCase()
    return command && verb && pipxDependencyVerbs.has(verb) ? { verb, verbIndex: command.index } : null
  }
  if (name === "uv") {
    const command = nextCliWord(words, 1, pythonOptionsWithValue)
    if (!command) {
      return null
    }
    const verb = command.value.toLowerCase()
    if (pythonDependencyVerbs.has(verb)) {
      return { verb, verbIndex: command.index }
    }
    const nested =
      verb === "pip" || verb === "tool" ? nextCliWord(words, command.index + 1, pythonOptionsWithValue) : undefined
    const nestedVerb = nested?.value.toLowerCase()
    const nestedVerbs = verb === "tool" ? uvToolDependencyVerbs : pythonDependencyVerbs
    return nested && nestedVerb && nestedVerbs.has(nestedVerb) ? { verb: nestedVerb, verbIndex: nested.index } : null
  }
  if (name === "python" || name === "python3" || name === "py") {
    const moduleIndex = words.findIndex((word, index) => index > 0 && word === "-m")
    if (moduleIndex < 1 || words[moduleIndex + 1] !== "pip") {
      return null
    }
    const command = nextCliWord(words, moduleIndex + 2, pythonOptionsWithValue)
    const verb = command?.value.toLowerCase()
    return command && verb && pythonDependencyVerbs.has(verb) ? { verb, verbIndex: command.index } : null
  }
  return null
}

function packageSpecifiersAfter(
  words: readonly string[],
  startIndex: number,
  optionsWithValue: ReadonlySet<string>,
): string[] {
  const specifiers: string[] = []
  for (let index = startIndex; index < words.length; index += 1) {
    const word = words[index] ?? ""
    if (word === "--") {
      continue
    }
    if (word.startsWith("-")) {
      if (optionsWithValue.has(optionName(word)) && inlineOptionValue(word) === undefined) {
        index += 1
      }
      continue
    }
    specifiers.push(word)
  }
  return specifiers
}

function segmentIsGlobalNodeMutation(words: readonly string[]): boolean {
  const operation = nodeDependencyOperation(words)
  if (!operation) {
    return false
  }
  if (operation.manager === "yarn" && nodeManagerCommand(words)?.value.toLowerCase() === "global") {
    return true
  }
  return words.some((word, index) => {
    if (word === "-g" || word === "--global" || word === "--global=true") {
      return true
    }
    if (word.startsWith("--location=")) {
      return inlineOptionValue(word)?.toLowerCase() === "global"
    }
    return word === "--location" && words[index + 1]?.toLowerCase() === "global"
  })
}

function segmentPublishesPackage(words: readonly string[]): boolean {
  const name = shellCommandName(words[0])
  if (!name) {
    return false
  }
  if (nodePackageManagers.has(name)) {
    const command = nodeManagerCommand(words)
    const verb = command?.value.toLowerCase()
    if (verb === "publish") {
      return true
    }
    const script =
      verb === "run" || verb === "run-script" ? nextCliWord(words, (command?.index ?? 0) + 1, new Set()) : null
    return script?.value.toLowerCase() === "publish"
  }
  if (name === "poetry" || name === "uv") {
    return nextCliWord(words, 1, pythonOptionsWithValue)?.value.toLowerCase() === "publish"
  }
  if (name === "twine") {
    return nextCliWord(words, 1, pythonOptionsWithValue)?.value.toLowerCase() === "upload"
  }
  return false
}

function alternatePackageSourceWord(word: string): boolean {
  const normalized = word.toLowerCase()
  return (
    normalized.startsWith("git+") ||
    normalized.startsWith("git://") ||
    normalized.startsWith("github:") ||
    normalized.startsWith("gitlab:") ||
    normalized.startsWith("bitbucket:") ||
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("file:") ||
    normalized.startsWith("./") ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    normalized.startsWith("~/")
  )
}

function wordUsesSourceOption(word: string, options: ReadonlySet<string>): boolean {
  if (options.has(optionName(word))) {
    return true
  }
  return [...options].some(
    (option) => option.startsWith("-") && !option.startsWith("--") && word.startsWith(option) && word !== option,
  )
}

function wordsUseSourceOption(words: readonly string[], options: ReadonlySet<string>): boolean {
  return words.some((word) => wordUsesSourceOption(word, options))
}

function pythonRunnerSelectionUsesAlternateSource(
  words: readonly string[],
  startIndex: number,
  initialSourceOverride: boolean,
): boolean {
  let sourceOverride = initialSourceOverride
  for (let index = startIndex; index < words.length; index += 1) {
    const word = words[index] ?? ""
    if (word === "--") {
      const specifier = words[index + 1]
      return sourceOverride || Boolean(specifier && alternatePackageSourceWord(specifier))
    }
    const option = optionName(word)
    if (wordUsesSourceOption(word, pythonSourceOptions)) {
      sourceOverride = true
    }
    if (word.startsWith("-")) {
      if (pythonOptionsWithValue.has(option) && inlineOptionValue(word) === undefined) {
        index += 1
      }
      continue
    }
    return sourceOverride || alternatePackageSourceWord(word)
  }
  return sourceOverride
}

function pythonRunnerUsesAlternatePackageSource(words: readonly string[]): boolean {
  const name = shellCommandName(words[0])
  const pipxCommand = name === "pipx" ? nextCliWord(words, 1, pythonOptionsWithValue) : undefined
  const uvCommand = name === "uv" ? nextCliWord(words, 1, pythonOptionsWithValue) : undefined
  const uvToolCommand =
    uvCommand?.value.toLowerCase() === "tool"
      ? nextCliWord(words, uvCommand.index + 1, pythonOptionsWithValue)
      : undefined
  if (name === "uvx") {
    return pythonRunnerSelectionUsesAlternateSource(words, 1, false)
  }
  if (uvToolCommand?.value.toLowerCase() === "run") {
    return pythonRunnerSelectionUsesAlternateSource(
      words,
      uvToolCommand.index + 1,
      wordsUseSourceOption(words.slice(1, uvToolCommand.index), pythonSourceOptions),
    )
  }
  return Boolean(
    pipxCommand?.value.toLowerCase() === "run" &&
    pythonRunnerSelectionUsesAlternateSource(
      words,
      pipxCommand.index + 1,
      wordsUseSourceOption(words.slice(1, pipxCommand.index), pythonSourceOptions),
    ),
  )
}

function segmentUsesAlternatePackageSource(words: readonly string[]): boolean {
  const runner = packageRunnerInvocation(words)
  if (runner) {
    return runner.sourceOverride || runner.specifiers.some(alternatePackageSourceWord)
  }
  if (pythonRunnerUsesAlternatePackageSource(words)) {
    return true
  }
  const nodeOperation = nodeDependencyOperation(words)
  if (nodeOperation) {
    return (
      wordsUseSourceOption(words, nodeSourceOptions) ||
      packageSpecifiersAfter(words, nodeOperation.verbIndex + 1, nodeOptionsWithValue).some(alternatePackageSourceWord)
    )
  }
  const pythonOperation = pythonDependencyOperation(words)
  return Boolean(
    pythonOperation &&
    (wordsUseSourceOption(words, pythonSourceOptions) ||
      packageSpecifiersAfter(words, pythonOperation.verbIndex + 1, pythonOptionsWithValue).some(
        alternatePackageSourceWord,
      )),
  )
}

function nestedShellCommand(words: readonly string[]): string | undefined {
  const name = shellCommandName(words[0])
  if (name !== "bash" && name !== "sh" && name !== "zsh") {
    return undefined
  }
  const commandIndex = words.findIndex(
    (word, index) => index > 0 && (word === "-c" || (/^-[^-]/u.test(word) && word.slice(1).includes("c"))),
  )
  return commandIndex >= 0 ? words[commandIndex + 1] : undefined
}

function parsedCommandSegments(command: string, depth = 0): readonly (readonly string[])[] {
  const direct = topLevelShellSegments(command)
    .map(({ text }) => shellWords(text))
    .filter((words): words is string[] => Boolean(words?.length))
    .map((words) => shellWordsWithoutRedirections(unwrappedShellCommandWords(words)))
    .filter((words) => words.length > 0)
  if (depth >= 2) {
    return direct
  }
  return direct.flatMap((words) => {
    const nested = nestedShellCommand(words)
    return nested ? [words, ...parsedCommandSegments(nested, depth + 1)] : [words]
  })
}

export function canonicalRegistryNodePackageName(specifier: string): string | undefined {
  const match = specifier.startsWith("@")
    ? /^(@[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*)(?:@(.+))?$/u.exec(specifier)
    : /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:@(.+))?$/u.exec(specifier)
  const name = match?.[1]
  const version = match?.[2]
  if (!name || (version !== undefined && !nodePackageSpecPattern.test(version))) {
    return undefined
  }
  return name.toLowerCase()
}

export function dependencyCommandRequiresConfirmation(command: string): boolean {
  return parsedCommandSegments(command).some(
    (words) =>
      segmentIsGlobalNodeMutation(words) || segmentPublishesPackage(words) || segmentUsesAlternatePackageSource(words),
  )
}

export function isDependencyMutationCommand(command: string): boolean {
  return parsedCommandSegments(command).some(
    (words) => Boolean(nodeDependencyOperation(words)) || Boolean(pythonDependencyOperation(words)),
  )
}

export function isPythonDependencyMutationCommand(command: string): boolean {
  return parsedCommandSegments(command).some((words) => Boolean(pythonDependencyOperation(words)))
}

export interface DependencyScopeContext {
  commandCwd?: string
  taskProcessRoot?: string
  trustedProjectRoot?: string
}

function resolvedDestination(value: string, cwd?: string): string | undefined {
  if (!value || /[$`*?{}~]/u.test(value)) return undefined
  return resolveShellPath(value, cwd)?.replace(/\\/gu, "/")
}

function destinationAllowed(value: string, scope: DependencyScopeContext, python: boolean): boolean {
  const target = resolvedDestination(value, scope.commandCwd)
  if (!target) return false
  if (!python)
    return [scope.taskProcessRoot, scope.trustedProjectRoot].some((root) => {
      const resolvedRoot = root ? resolveShellPath(root)?.replace(/\\/gu, "/") : undefined
      if (!resolvedRoot) return false
      const normalize = (value: string) => (/^(?:[A-Za-z]:\/|\/\/)/u.test(target) ? value.toLowerCase() : value)
      const base = normalize(resolvedRoot).replace(/\/$/u, "")
      return normalize(target) === base || normalize(target).startsWith(`${base}/`)
    })
  const platform = /^(?:[A-Za-z]:\/|\/\/)/u.test(target) ? "win32" : "linux"
  const normalize = (value: string) => (platform === "win32" ? value.toLowerCase() : value)
  const executables = [
    ...(scope.taskProcessRoot ? managedPythonExecutables(scope.taskProcessRoot, platform) : []),
    ...(scope.trustedProjectRoot ? projectPythonExecutables(scope.trustedProjectRoot, platform) : []),
  ]
  return executables.some((executable) => normalize(executable) === normalize(target))
}

// Dynamic operation names/options can conceal publish/global/user semantics. Do not
// evaluate shell variables; ordinary package values and path arguments stay ordinary.
function dynamicDependencyOperation(words: readonly string[]): boolean {
  const name = shellCommandName(words[0]) ?? ""
  const node = nodePackageManagers.has(name)
  const python = ["pip", "pip3", "pipx", "poetry", "uv", "python", "python3", "py"].includes(name)
  if (!node && !python) return false
  const dynamic = (word: string | undefined) => Boolean(word && /[$`]/u.test(word))
  const options = node ? nodeOptionsWithValue : pythonOptionsWithValue
  let verb = nextCliWord(words, 1, options)
  if (["python", "python3", "py"].includes(name)) {
    const moduleIndex = words.indexOf("-m")
    if (moduleIndex < 0) return false
    if (dynamic(words[moduleIndex + 1])) return true
    if (words[moduleIndex + 1] !== "pip") return false
    verb = nextCliWord(words, moduleIndex + 2, options)
  }
  if (words.slice(1).some((word) => word.startsWith("-") && dynamic(optionName(word)))) return true
  if (dynamic(verb?.value)) return true
  if (verb && ["run", "run-script", "pip", "tool", "global"].includes(verb.value)) {
    return dynamic(nextCliWord(words, verb.index + 1, options)?.value)
  }
  return false
}

/** Check explicit destination/input changes, never require a bounded install template. */
export function dependencyCommandChangesScope(command: string, scope: DependencyScopeContext = {}): boolean {
  const segments = topLevelShellSegments(command)
  const steps = scopedCommandSequence(command, scope.commandCwd) ?? [
    { command, cwd: segments.length === 1 ? scope.commandCwd : undefined },
  ]
  return steps.some((step) => {
    const raw = shellWords(step.command) ?? []
    const unwrapped = unwrappedShellCommandWords(raw)
    // Flattened nested shells and cwd-changing env launchers do not prove a
    // relative destination. Absolute, bounded destinations still qualify.
    const changesCwd =
      Boolean(nestedShellCommand(unwrapped)) ||
      (raw.some((word) => shellCommandName(word) === "env") &&
        raw.some((word) => word.startsWith("-C") || word === "--chdir" || word.startsWith("--chdir=")))
    const cwd = changesCwd ? undefined : step.cwd
    return parsedCommandSegments(step.command).some((words) => {
      const name = shellCommandName(words[0])
      if (dynamicDependencyOperation(words)) return true
      const node = nodeDependencyOperation(words)
      const python = pythonDependencyOperation(words)
      if (!node && !python) return false
      const options = node ? nodeOptionsWithValue : pythonOptionsWithValue
      // Consume option values so flags appearing as values are not treated as options.
      for (let index = 1; index < words.length; index += 1) {
        const word = words[index] ?? ""
        if (word === "--") break
        if (!word.startsWith("-")) continue
        const option = optionName(word)
        if ((node && option === "--prefix") || (name === "uv" && option === "--python")) {
          const value = inlineOptionValue(word) ?? words[index + 1] ?? ""
          if (!destinationAllowed(value, { ...scope, commandCwd: cwd }, !node)) return true
        }
        if (node && ["--global-folder", "--modules-dir", "--store-dir", "--virtual-store-dir"].includes(option))
          return true
        if (python && (protectedPipInstallOptions.has(pipOptionName(word)) || option === "--system")) return true
        if (options.has(option) && inlineOptionValue(word) === undefined) index += 1
      }
      return name === "pipx" || (name === "uv" && nextCliWord(words, 1, pythonOptionsWithValue)?.value === "tool")
    })
  })
}
