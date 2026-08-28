import type { ExternalGuardCwdBinding, WorkspaceTeamScope } from "../oo-guard-core.ts"
import type { LookupAddress } from "node:dns"

import { lookup } from "node:dns/promises"
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { isIP } from "node:net"
import path from "node:path"
import { externalOoRootCommandIndex, resolveExternalOoOperation } from "./oo-capability-contract.ts"

const maxUploadBytes = 500 * 1024 * 1024
const maxFlowRequestBytes = 8 * 1024 * 1024
const forbiddenRuntimeOptions = new Set([
  "--config-dir",
  "--connector-token",
  "--connector-url",
  "--data-dir",
  "--endpoint",
])
const flowProjectIndependentOperations = new Set(["flow.project.current", "flow.project.list", "flow.project.show"])

type HostLookup = (hostname: string) => Promise<readonly LookupAddress[]>

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

function managedRoots(scope: WorkspaceTeamScope): string[] {
  if (!scope.sessionCwdRoots || typeof scope.sessionCwdRoots !== "object") return []
  return Object.values(scope.sessionCwdRoots)
    .flatMap((roots) => (Array.isArray(roots) ? roots : []))
    .filter((root): root is string => typeof root === "string" && path.isAbsolute(root))
    .map((root) => realpathSync.native(path.resolve(root)))
}

function requireManagedExistingFile(
  value: string,
  binding: ExternalGuardCwdBinding,
  scope: WorkspaceTeamScope,
): string {
  const resolved = path.resolve(binding.cwd, value)
  if (!existsSync(resolved)) {
    throw new Error("Wanta managed OO file input must be an existing file inside the active turn's directories.")
  }
  const candidate = realpathSync.native(resolved)
  if (!managedRoots(scope).some((root) => isWithin(root, candidate))) {
    throw new Error("Wanta refused a managed OO file read outside the active turn's managed directories.")
  }
  if (!statSync(candidate).isFile()) {
    throw new Error("Wanta managed OO file input must be a regular file.")
  }
  return candidate
}

function validateNestedFileReferences(
  value: unknown,
  binding: ExternalGuardCwdBinding,
  scope: WorkspaceTeamScope,
): void {
  if (typeof value === "string") {
    if (value.startsWith("@") && value.length > 1) {
      requireManagedExistingFile(value.slice(1), binding, scope)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) validateNestedFileReferences(item, binding, scope)
    return
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) validateNestedFileReferences(item, binding, scope)
  }
}

function validateFlowRequestFile(value: string, binding: ExternalGuardCwdBinding, scope: WorkspaceTeamScope): string {
  const canonical = requireManagedExistingFile(value, binding, scope)
  if (statSync(canonical).size > maxFlowRequestBytes) {
    throw new Error("Wanta managed Flow request files may not exceed 8 MiB.")
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(canonical, "utf8")) as unknown
  } catch {
    throw new Error("Wanta managed Flow request file must contain valid JSON.")
  }
  validateNestedFileReferences(parsed, binding, scope)
  return canonical
}

function nearestExistingAncestor(value: string): string {
  let candidate = value
  while (!existsSync(candidate)) {
    const parent = path.dirname(candidate)
    if (parent === candidate) break
    candidate = parent
  }
  return realpathSync.native(candidate)
}

function requireManagedOutputDirectory(
  value: string,
  binding: ExternalGuardCwdBinding,
  scope: WorkspaceTeamScope,
): string {
  const candidate = path.resolve(binding.cwd, value)
  const roots = managedRoots(scope)
  const ancestor = nearestExistingAncestor(candidate)
  if (!roots.some((root) => isWithin(root, ancestor) && isWithin(root, candidate))) {
    throw new Error("Wanta refused a managed OO file write outside the active turn's managed directories.")
  }
  mkdirSync(candidate, { recursive: true })
  const canonical = realpathSync.native(candidate)
  if (!roots.some((root) => isWithin(root, canonical))) {
    throw new Error("Wanta refused a managed OO file write through a path outside the active turn's directories.")
  }
  return canonical
}

function sessionRuntime(scope: WorkspaceTeamScope): unknown {
  if (!scope.sessionRuntimes || typeof scope.sessionRuntimes !== "object") return undefined
  const runtimes = [...new Set(Object.values(scope.sessionRuntimes))]
  return runtimes.length === 1 ? runtimes[0] : undefined
}

function requireOomolRuntime(scope: WorkspaceTeamScope, domain: string): void {
  if (sessionRuntime(scope) !== "oomol") {
    throw new Error(`Wanta managed ${domain} commands require an active OOMOL workspace.`)
  }
}

function privateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number)
  const [a = -1, b = -1, c = -1] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  )
}

function privateIp(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0] ?? ""
  if (isIP(normalized) === 4) return privateIpv4(normalized)
  if (isIP(normalized) !== 6) return true
  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("::ffff:") ||
    normalized.startsWith("64:ff9b:") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9")
  ) {
    return true
  }
  if (
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8")
  ) {
    return true
  }
  return false
}

export async function validateManagedDownloadUrl(
  value: string,
  resolve: HostLookup = async (hostname) => lookup(hostname, { all: true, verbatim: true }),
): Promise<string> {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("Wanta managed file download requires a valid HTTP or HTTPS URL.")
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Wanta managed file download accepts only credential-free HTTP or HTTPS URLs.")
  }
  const hostname = url.hostname.replace(/^\[|\]$/gu, "").toLowerCase()
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Wanta managed file download refused a local network target.")
  }
  const literalKind = isIP(hostname)
  const addresses = literalKind ? [{ address: hostname, family: literalKind }] : await resolve(hostname)
  if (addresses.length === 0 || addresses.some(({ address }) => privateIp(address))) {
    throw new Error("Wanta managed file download refused a private or unresolved network target.")
  }
  return url.toString()
}

function optionValue(args: readonly string[], name: string): string | undefined {
  const equals = args.find((arg) => arg.startsWith(`${name}=`))
  if (equals) return equals.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function rejectRuntimeOverrides(args: readonly string[]): void {
  for (const arg of args) {
    const name = arg.split("=", 1)[0] ?? arg
    if (forbiddenRuntimeOptions.has(name)) {
      throw new Error(`Wanta managed OO commands do not accept the ${name} runtime override.`)
    }
  }
}

function positionalIndices(args: readonly string[], start: number, optionsWithValue: ReadonlySet<string>): number[] {
  const indices: number[] = []
  for (let index = start; index < args.length; index += 1) {
    const arg = args[index] ?? ""
    if (arg.startsWith("--") || arg === "-h") {
      const name = arg.split("=", 1)[0] ?? arg
      if (!arg.includes("=") && optionsWithValue.has(name)) index += 1
      continue
    }
    indices.push(index)
  }
  return indices
}

function validateDownloadNameOptions(args: readonly string[]): void {
  const name = optionValue(args, "--name")
  if (
    (args.some((arg) => arg === "--name" || arg.startsWith("--name=")) && (!name || name.startsWith("-"))) ||
    (name && (name.length > 240 || name === "." || name === ".." || /[\\/\0]/u.test(name)))
  ) {
    throw new Error("Wanta managed file download requires a plain file base name.")
  }
  const extension = optionValue(args, "--ext")
  if (
    (args.some((arg) => arg === "--ext" || arg.startsWith("--ext=")) && (!extension || extension.startsWith("-"))) ||
    (extension && !/^\.?[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u.test(extension))
  ) {
    throw new Error("Wanta managed file download requires a simple file extension.")
  }
}

async function prepareFileCommand(
  args: string[],
  binding: ExternalGuardCwdBinding,
  scope: WorkspaceTeamScope,
): Promise<string[]> {
  const root = externalOoRootCommandIndex(args)
  const subcommand = args[root + 1]
  if (subcommand === "upload") {
    requireOomolRuntime(scope, "file upload")
    const inputs = positionalIndices(args, root + 2, new Set(["--format"]))
    if (inputs.length !== 1) throw new Error("Wanta managed file upload requires exactly one file path.")
    const inputIndex = inputs[0]!
    const input = args[inputIndex]!
    const canonical = requireManagedExistingFile(input, binding, scope)
    if (statSync(canonical).size > maxUploadBytes) {
      throw new Error("Wanta managed file upload rejected a file larger than 500 MiB.")
    }
    args[inputIndex] = canonical
    return args
  }

  const inputs = positionalIndices(args, root + 2, new Set(["--ext", "--name"]))
  if (inputs.length < 1 || inputs.length > 2) {
    throw new Error("Wanta managed file download requires one URL and at most one output directory.")
  }
  const urlIndex = inputs[0]!
  const value = args[urlIndex]!
  args[urlIndex] = await validateManagedDownloadUrl(value)
  const outputIndex = inputs[1]
  if (outputIndex !== undefined) {
    args[outputIndex] = requireManagedOutputDirectory(args[outputIndex]!, binding, scope)
  } else {
    args.splice(urlIndex + 1, 0, requireManagedOutputDirectory(binding.cwd, binding, scope))
  }
  validateDownloadNameOptions(args)
  return args
}

function rewriteManagedFileReferences(
  args: string[],
  binding: ExternalGuardCwdBinding,
  scope: WorkspaceTeamScope,
): string[] {
  return args.map((arg, index) => {
    if (arg === "-") {
      throw new Error("Wanta managed Flow commands do not accept stdin; use a file inside the active turn instead.")
    }
    const previous = args[index - 1]
    if (previous === "--file") {
      return validateFlowRequestFile(arg.startsWith("@") ? arg.slice(1) : arg, binding, scope)
    }
    if (arg.startsWith("--file=")) {
      return `--file=${validateFlowRequestFile(arg.slice("--file=".length), binding, scope)}`
    }
    if (arg.startsWith("@") && arg.length > 1) {
      return `@${requireManagedExistingFile(arg.slice(1), binding, scope)}`
    }
    const embeddedReference = /^(.*)=@(.+)$/u.exec(arg)
    if (embeddedReference) {
      return `${embeddedReference[1]}=@${requireManagedExistingFile(embeddedReference[2]!, binding, scope)}`
    }
    return arg
  })
}

function hasExplicitProject(args: readonly string[]): boolean {
  const value = optionValue(args, "--project")
  return typeof value === "string" && value.trim().length > 0 && !value.startsWith("-")
}

function prepareFlowCommand(args: string[], binding: ExternalGuardCwdBinding, scope: WorkspaceTeamScope): string[] {
  requireOomolRuntime(scope, "Flow")
  const operation = resolveExternalOoOperation(args)
  if (!operation || !operation.id.startsWith("flow.")) return args
  if (!flowProjectIndependentOperations.has(operation.id) && !hasExplicitProject(args)) {
    throw new Error(
      "Wanta managed Flow commands require an explicit --project value; resolve it with `oo flow project current --json` first.",
    )
  }
  return rewriteManagedFileReferences(args, binding, scope)
}

/** Normalize and validate arguments before the privileged OO binary is spawned. */
export async function prepareManagedExternalOoCommand(
  input: readonly string[],
  binding: ExternalGuardCwdBinding,
  scope: WorkspaceTeamScope,
): Promise<string[]> {
  const args = [...input]
  rejectRuntimeOverrides(args)
  const operation = resolveExternalOoOperation(args)
  if (operation?.id === "file.upload" || operation?.id === "file.download") {
    return prepareFileCommand(args, binding, scope)
  }
  if (operation?.id.startsWith("flow.")) {
    return prepareFlowCommand(args, binding, scope)
  }
  return args
}
