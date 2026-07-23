import { effectiveShellCommandWords, shellCommandName, shellWords, topLevelShellSegments } from "./shell-syntax.ts"

const nodePackageSpecPattern = /^[A-Za-z0-9*+.!<>=~^_-]+$/u
const nodePackageManagers = new Set(["bun", "npm", "pnpm", "yarn"])
const nodePackagesRequiringConfirmation = new Set([
  "@playwright/test",
  "canvas",
  "playwright",
  "playwright-chromium",
  "playwright-core",
  "playwright-firefox",
  "playwright-webkit",
  "puppeteer",
  "puppeteer-core",
])
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
const nodeInstallVerbs = new Set(["add", "i", "install", "link"])
const pythonDependencyVerbs = new Set(["add", "install", "remove", "uninstall"])

const nodeSourceOptions = new Set(["--globalconfig", "--registry", "--userconfig"])
const pythonSourceOptions = new Set(["--extra-index-url", "--find-links", "--index-url", "--trusted-host"])
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
  "--cache-dir",
  "--config-file",
  "--config-settings",
  "--constraint",
  "--editable",
  "--extra-index-url",
  "--find-links",
  "--group",
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
  if (name === "uv") {
    const command = nextCliWord(words, 1, pythonOptionsWithValue)
    if (!command) {
      return null
    }
    const verb = command.value.toLowerCase()
    if (pythonDependencyVerbs.has(verb)) {
      return { verb, verbIndex: command.index }
    }
    const nested = verb === "pip" ? nextCliWord(words, command.index + 1, pythonOptionsWithValue) : undefined
    const nestedVerb = nested?.value.toLowerCase()
    return nested && nestedVerb && pythonDependencyVerbs.has(nestedVerb)
      ? { verb: nestedVerb, verbIndex: nested.index }
      : null
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

function segmentRunsConfirmableNodePackage(words: readonly string[]): boolean {
  const runner = packageRunnerInvocation(words)
  if (runner) {
    return runner.specifiers.some((specifier) => {
      const packageName = canonicalRegistryNodePackageName(specifier)
      return packageName ? nodePackageRequiresConfirmation(packageName) : false
    })
  }
  const operation = nodeDependencyOperation(words)
  if (!operation) {
    return false
  }
  return packageSpecifiersAfter(words, operation.verbIndex + 1, nodeOptionsWithValue).some((specifier) => {
    const packageName = canonicalRegistryNodePackageName(specifier)
    return packageName ? nodePackageRequiresConfirmation(packageName) : false
  })
}

function segmentIsGlobalNodeInstall(words: readonly string[]): boolean {
  const operation = nodeDependencyOperation(words)
  if (!operation || !nodeInstallVerbs.has(operation.verb)) {
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

function wordsUseSourceOption(words: readonly string[], options: ReadonlySet<string>): boolean {
  return words.some((word) => options.has(optionName(word)))
}

function segmentUsesAlternatePackageSource(words: readonly string[]): boolean {
  const runner = packageRunnerInvocation(words)
  if (runner) {
    return runner.sourceOverride || runner.specifiers.some(alternatePackageSourceWord)
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
    .map(effectiveShellCommandWords)
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

export function nodePackageRequiresConfirmation(name: string): boolean {
  return nodePackagesRequiringConfirmation.has(name.toLowerCase())
}

export function dependencyCommandRequiresConfirmation(command: string): boolean {
  return parsedCommandSegments(command).some(
    (words) =>
      segmentRunsConfirmableNodePackage(words) ||
      segmentIsGlobalNodeInstall(words) ||
      segmentPublishesPackage(words) ||
      segmentUsesAlternatePackageSource(words),
  )
}

export function isDependencyMutationCommand(command: string): boolean {
  return parsedCommandSegments(command).some(
    (words) => Boolean(nodeDependencyOperation(words)) || Boolean(pythonDependencyOperation(words)),
  )
}
