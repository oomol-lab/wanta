import { effectiveShellCommandWords, shellCommandName, shellWords, topLevelShellSegments } from "./shell-syntax.ts"

const wrapperCommands = new Set(["builtin", "command", "exec", "nohup", "time"])
const shellCommands = new Set(["bash", "sh", "zsh"])
const scriptInterpreterCommands = new Set(["bun", "deno", "lua", "node", "perl", "php", "python", "python3", "ruby"])
const gitOptionsWithValue = new Set(["-C", "-c", "--config-env", "--git-dir", "--namespace", "--work-tree"])
const containerOptionsWithValue = new Set(["--config", "--context", "--host", "-H"])
const clusterOptionsWithValue = new Set([
  "--as",
  "--as-group",
  "--cache-dir",
  "--certificate-authority",
  "--client-certificate",
  "--client-key",
  "--cluster",
  "--context",
  "--kubeconfig",
  "--namespace",
  "--server",
  "--token",
  "--user",
  "-n",
])

function optionName(word: string): string {
  const separator = word.indexOf("=")
  return separator >= 0 ? word.slice(0, separator) : word
}

function nextOperand(
  words: readonly string[],
  startIndex: number,
  optionsWithValue: ReadonlySet<string> = new Set(),
): { index: number; value: string } | undefined {
  for (let index = startIndex; index < words.length; index += 1) {
    const word = words[index] ?? ""
    if (word === "--") {
      const value = words[index + 1]
      return value ? { index: index + 1, value } : undefined
    }
    if (word.startsWith("-")) {
      if (optionsWithValue.has(optionName(word)) && !word.includes("=")) {
        index += 1
      }
      continue
    }
    return { index, value: word }
  }
  return undefined
}

function unwrappedCommandWords(words: readonly string[]): readonly string[] {
  let current = effectiveShellCommandWords(words)
  for (let depth = 0; depth < 4; depth += 1) {
    const name = shellCommandName(current[0])
    if (!name || !wrapperCommands.has(name)) {
      return current
    }
    const executable = nextOperand(current, 1)
    if (!executable) {
      return []
    }
    current = current.slice(executable.index)
  }
  return current
}

function optionHasLetter(word: string, letter: string): boolean {
  return /^-[^-]/u.test(word) && word.slice(1).includes(letter)
}

function recursiveDelete(words: readonly string[]): boolean {
  if (shellCommandName(words[0]) !== "rm") {
    return false
  }
  return words
    .slice(1)
    .some((word) => word === "--recursive" || optionHasLetter(word, "r") || optionHasLetter(word, "R"))
}

function destructiveFind(words: readonly string[], depth: number): boolean {
  if (shellCommandName(words[0]) !== "find") {
    return false
  }
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index]
    if (word === "-delete") {
      return true
    }
    if (!["-exec", "-execdir", "-ok", "-okdir"].includes(word ?? "")) {
      continue
    }
    const terminator = words.findIndex((candidate, candidateIndex) => candidateIndex > index && candidate === ";")
    const nested = words.slice(index + 1, terminator >= 0 ? terminator : words.length)
    if (riskySimpleCommand(nested, depth + 1)) {
      return true
    }
    if (terminator >= 0) {
      index = terminator
    }
  }
  return false
}

function broadPermissionChange(words: readonly string[]): boolean {
  const name = shellCommandName(words[0])
  if (name === "chmod") {
    return words.slice(1).some((word) => word === "777" || word === "--recursive" || optionHasLetter(word, "R"))
  }
  if (name !== "chown") {
    return false
  }
  return words.slice(1).some((word) => {
    const normalized = word.toLowerCase()
    return (
      normalized === "root" ||
      normalized.startsWith("root:") ||
      /^(?:\/(?:etc|bin|sbin|usr|system|library))(?:\/|$)/u.test(normalized)
    )
  })
}

function mutatesHomebrew(words: readonly string[]): boolean {
  if (shellCommandName(words[0]) !== "brew") {
    return false
  }
  const verb = nextOperand(words, 1)?.value.toLowerCase()
  return Boolean(verb && ["install", "remove", "uninstall", "upgrade"].includes(verb))
}

function mutatesGitRemoteOrWorkingTree(words: readonly string[]): boolean {
  if (shellCommandName(words[0]) !== "git") {
    return false
  }
  const command = nextOperand(words, 1, gitOptionsWithValue)
  if (!command) {
    return false
  }
  const verb = command.value.toLowerCase()
  if (verb === "push") {
    return true
  }
  const args = words.slice(command.index + 1)
  if (verb === "reset") {
    return args.includes("--hard")
  }
  if (verb === "checkout" || verb === "restore") {
    const separator = args.indexOf("--")
    return separator >= 0 && Boolean(args[separator + 1])
  }
  if (verb === "clean") {
    return args.some((word) => word === "--force" || optionHasLetter(word, "f"))
  }
  return false
}

function mutatesCluster(words: readonly string[]): boolean {
  const name = shellCommandName(words[0])
  if (name !== "kubectl" && name !== "helm") {
    return false
  }
  const command = nextOperand(words, 1, clusterOptionsWithValue)?.value.toLowerCase()
  return Boolean(command && ["apply", "delete", "patch", "replace", "rollback", "upgrade"].includes(command))
}

function mutatesDocker(words: readonly string[]): boolean {
  if (shellCommandName(words[0]) !== "docker") {
    return false
  }
  const command = nextOperand(words, 1, containerOptionsWithValue)
  if (!command) {
    return false
  }
  const verb = command.value.toLowerCase()
  if (verb === "rm" || verb === "rmi") {
    return true
  }
  const nested = nextOperand(words, command.index + 1)?.value.toLowerCase()
  return (verb === "system" && nested === "prune") || (verb === "volume" && nested === "rm")
}

function destroysInfrastructure(words: readonly string[]): boolean {
  const name = shellCommandName(words[0])
  if (name === "terraform" || name === "tofu" || name === "pulumi") {
    return words.slice(1).some((word) => word.toLowerCase() === "destroy")
  }
  return false
}

function deletesRemoteRepository(words: readonly string[]): boolean {
  if (shellCommandName(words[0]) !== "gh") {
    return false
  }
  const first = nextOperand(words, 1)
  const second = first ? nextOperand(words, first.index + 1) : undefined
  return first?.value.toLowerCase() === "repo" && second?.value.toLowerCase() === "delete"
}

function recursivelyDeletesCloudStorage(words: readonly string[]): boolean {
  const name = shellCommandName(words[0])
  const normalized = words.map((word) => word.toLowerCase())
  if (name === "aws") {
    return (
      normalized.some((word, index) => word === "s3" && normalized[index + 1] === "rm") &&
      normalized.includes("--recursive")
    )
  }
  if (name === "gcloud") {
    const storageRmIndex = normalized.findIndex((word, index) => word === "storage" && normalized[index + 1] === "rm")
    return (
      storageRmIndex >= 0 &&
      normalized.slice(storageRmIndex + 2).some((word) => word === "--recursive" || word === "-r")
    )
  }
  if (name === "gsutil") {
    return normalized.includes("rm") && normalized.includes("-r")
  }
  return name === "rclone" && normalized[1] === "purge"
}

function destructivelyOverwritesStorage(words: readonly string[]): boolean {
  const name = shellCommandName(words[0])
  if (name === "truncate") {
    return true
  }
  if (name === "dd") {
    return words.slice(1).some((word) => /^of=/iu.test(word))
  }
  return Boolean(name && (/^mkfs(?:\.|$)/u.test(name) || name === "newfs"))
}

function deploysService(words: readonly string[]): boolean {
  const name = shellCommandName(words[0])
  if (!name || !["firebase", "netlify", "serverless", "sst", "vercel", "wrangler"].includes(name)) {
    return false
  }
  const verb = nextOperand(words, 1)?.value.toLowerCase()
  return verb === "deploy" || verb === "publish"
}

function readsSystemPassword(words: readonly string[]): boolean {
  if (shellCommandName(words[0]) !== "security") {
    return false
  }
  const verb = nextOperand(words, 1)?.value.toLowerCase()
  return verb === "find-generic-password" || verb === "find-internet-password"
}

function mutatesSystemService(words: readonly string[]): boolean {
  const name = shellCommandName(words[0])
  if (name !== "launchctl" && name !== "systemctl") {
    return false
  }
  const verb = nextOperand(words, 1)?.value.toLowerCase()
  return Boolean(
    verb &&
    ["bootstrap", "bootout", "disable", "enable", "load", "reload", "restart", "start", "stop", "unload"].includes(
      verb,
    ),
  )
}

function nestedShellCommand(words: readonly string[]): string | undefined {
  if (!shellCommands.has(shellCommandName(words[0]) ?? "")) {
    return undefined
  }
  const commandIndex = words.findIndex((word, index) => index > 0 && (word === "-c" || optionHasLetter(word, "c")))
  return commandIndex >= 0 ? words[commandIndex + 1] : undefined
}

function riskySimpleCommand(words: readonly string[], depth: number): boolean {
  const command = unwrappedCommandWords(words)
  const name = shellCommandName(command[0])
  if (!name) {
    return false
  }
  if (name === "sudo") {
    return true
  }
  const nested = nestedShellCommand(command)
  if (nested && depth < 2 && commandRequiresConfirmation(nested, depth + 1)) {
    return true
  }
  return (
    recursiveDelete(command) ||
    destructiveFind(command, depth) ||
    broadPermissionChange(command) ||
    mutatesHomebrew(command) ||
    mutatesGitRemoteOrWorkingTree(command) ||
    mutatesCluster(command) ||
    mutatesDocker(command) ||
    destroysInfrastructure(command) ||
    deletesRemoteRepository(command) ||
    recursivelyDeletesCloudStorage(command) ||
    destructivelyOverwritesStorage(command) ||
    deploysService(command) ||
    readsSystemPassword(command) ||
    mutatesSystemService(command)
  )
}

export function commandRequiresConfirmation(command: string, depth = 0): boolean {
  const segments = topLevelShellSegments(command)
  const commands = segments.map(({ text }) => {
    const words = shellWords(text)
    return words?.length ? unwrappedCommandWords(words) : []
  })
  if (commands.some((words) => riskySimpleCommand(words, depth))) {
    return true
  }
  return commands.some((words, index) => {
    if (segments[index]?.operatorAfter !== "pipe") {
      return false
    }
    const source = shellCommandName(words[0])
    const target = shellCommandName(commands[index + 1]?.[0])
    return Boolean(
      source &&
      target &&
      ["curl", "wget"].includes(source) &&
      (shellCommands.has(target) || scriptInterpreterCommands.has(target)),
    )
  })
}
