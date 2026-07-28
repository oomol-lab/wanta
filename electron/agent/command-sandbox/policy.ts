import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { lstat, mkdir, readFile, realpath } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { atomicWriteText } from "../../atomic-file.ts"

export const COMMAND_SANDBOX_POLICY_VERSION = 2

export type CommandExecutionMode = "direct" | "sandbox"

export interface CommandSandboxPolicyInput {
  executionMode: CommandExecutionMode
  privateNetworkGrants?: readonly PrivateNetworkGrant[]
  readOnlyPaths?: readonly string[]
  readWritePaths?: readonly string[]
  runtimeReadPaths?: readonly string[]
  sessionId: string
}

export interface CommandSandboxPolicy {
  executionMode: CommandExecutionMode
  homeDir: string
  privateNetworkGrants: PrivateNetworkGrant[]
  readOnlyPaths: string[]
  readWritePaths: string[]
  runtimeReadPaths: string[]
  sessionId: string
  version: typeof COMMAND_SANDBOX_POLICY_VERSION
}

export interface PrivateNetworkGrant {
  address: string
  port?: number
}

interface CommandSandboxPolicyEnvelope {
  policy: CommandSandboxPolicy
  signature: string
}

export interface CommandSandboxPolicyStoreOptions {
  authKey: string
  rootDir: string
}

export class CommandSandboxPolicyStore {
  public readonly controlDir: string
  public readonly grantsDir: string
  public readonly homeRoot: string
  public readonly policyDir: string

  private readonly authKey: string

  public constructor({ authKey, rootDir }: CommandSandboxPolicyStoreOptions) {
    this.authKey = authKey
    this.controlDir = rootDir
    this.policyDir = path.join(rootDir, "policies")
    this.grantsDir = path.join(rootDir, "network-grants")
    this.homeRoot = path.join(rootDir, "home")
  }

  public async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.policyDir, { recursive: true, mode: 0o700 }),
      mkdir(this.grantsDir, { recursive: true, mode: 0o700 }),
      mkdir(this.homeRoot, { recursive: true, mode: 0o700 }),
    ])
  }

  public async readNetworkGrants(sessionId: string): Promise<PrivateNetworkGrant[]> {
    await this.initialize()
    try {
      const value = JSON.parse(await readFile(this.grantsPathForSession(sessionId), "utf8")) as unknown
      return isPrivateNetworkGrantArray(value) ? value : []
    } catch {
      return []
    }
  }

  public async writeNetworkGrants(sessionId: string, grants: readonly PrivateNetworkGrant[]): Promise<void> {
    await this.initialize()
    await atomicWriteText(this.grantsPathForSession(sessionId), `${JSON.stringify(grants)}\n`, { mode: 0o600 })
  }

  public async write(input: CommandSandboxPolicyInput): Promise<CommandSandboxPolicy> {
    await this.initialize()
    const homeDir = path.join(this.homeRoot, sessionPolicyName(input.sessionId))
    await mkdir(homeDir, { recursive: true, mode: 0o700 })
    const [readOnlyPaths, requestedReadWritePaths, runtimeReadPaths, canonicalControlDir] = await Promise.all([
      canonicalizePaths(input.readOnlyPaths),
      canonicalizePaths(input.readWritePaths),
      canonicalizePaths(input.runtimeReadPaths),
      realpath(this.controlDir),
    ])
    const privateStateOverlap = [...readOnlyPaths, ...requestedReadWritePaths, ...runtimeReadPaths].find(
      (root) => isPathWithin(root, canonicalControlDir) || isPathWithin(canonicalControlDir, root),
    )
    if (privateStateOverlap) {
      throw new Error("A command sandbox root cannot include Wanta's private control directory.")
    }
    const readWritePaths = await canonicalizePaths([homeDir, ...requestedReadWritePaths])
    const policy: CommandSandboxPolicy = {
      executionMode: input.executionMode,
      homeDir: await realpath(homeDir),
      privateNetworkGrants: [...(input.privateNetworkGrants ?? [])],
      readOnlyPaths,
      readWritePaths,
      runtimeReadPaths,
      sessionId: input.sessionId,
      version: COMMAND_SANDBOX_POLICY_VERSION,
    }
    const payload = JSON.stringify(policy)
    const envelope: CommandSandboxPolicyEnvelope = {
      policy,
      signature: signPolicy(payload, this.authKey),
    }
    await atomicWriteText(this.pathForSession(input.sessionId), `${JSON.stringify(envelope)}\n`, { mode: 0o600 })
    return policy
  }

  public pathForSession(sessionId: string): string {
    return path.join(this.policyDir, `${sessionPolicyName(sessionId)}.json`)
  }

  private grantsPathForSession(sessionId: string): string {
    return path.join(this.grantsDir, `${sessionPolicyName(sessionId)}.json`)
  }
}

export async function readCommandSandboxPolicy(
  policyDir: string,
  sessionId: string,
  authKey: string,
): Promise<CommandSandboxPolicy> {
  const filePath = path.join(policyDir, `${sessionPolicyName(sessionId)}.json`)
  const file = await lstat(filePath)
  if (!file.isFile() || file.isSymbolicLink()) {
    throw new Error("The command sandbox policy is not a regular file.")
  }
  const envelope = JSON.parse(await readFile(filePath, "utf8")) as unknown
  if (!isPolicyEnvelope(envelope)) {
    throw new Error("The command sandbox policy has an unsupported format.")
  }
  const payload = JSON.stringify(envelope.policy)
  const expected = Buffer.from(signPolicy(payload, authKey), "hex")
  const actual = Buffer.from(envelope.signature, "hex")
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("The command sandbox policy could not be authenticated.")
  }
  if (envelope.policy.sessionId !== sessionId) {
    throw new Error("The command sandbox policy belongs to another session.")
  }
  return envelope.policy
}

export function sessionPolicyName(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex")
}

function signPolicy(payload: string, authKey: string): string {
  return createHmac("sha256", authKey).update(payload).digest("hex")
}

async function canonicalizePaths(paths: readonly string[] | undefined): Promise<string[]> {
  const canonical = await Promise.all(
    (paths ?? []).filter((candidate) => candidate.trim()).map((candidate) => canonicalizePath(candidate)),
  )
  return [...new Set(canonical)].sort()
}

async function canonicalizePath(candidate: string): Promise<string> {
  const absolute = path.resolve(candidate)
  let existing = absolute
  const suffix: string[] = []
  while (true) {
    try {
      const canonical = await realpath(existing)
      return path.join(canonical, ...suffix.reverse())
    } catch {
      const parent = path.dirname(existing)
      if (parent === existing) {
        throw new Error(`Command sandbox path does not have an existing ancestor: ${candidate}`)
      }
      suffix.push(path.basename(existing))
      existing = parent
    }
  }
}

function isPolicyEnvelope(value: unknown): value is CommandSandboxPolicyEnvelope {
  if (!value || typeof value !== "object") return false
  const envelope = value as Partial<CommandSandboxPolicyEnvelope>
  const policy = envelope.policy
  return (
    typeof envelope.signature === "string" &&
    /^[a-f0-9]{64}$/u.test(envelope.signature) &&
    Boolean(policy) &&
    policy?.version === COMMAND_SANDBOX_POLICY_VERSION &&
    (policy.executionMode === "direct" || policy.executionMode === "sandbox") &&
    typeof policy.sessionId === "string" &&
    typeof policy.homeDir === "string" &&
    isPrivateNetworkGrantArray(policy.privateNetworkGrants) &&
    isStringArray(policy.readOnlyPaths) &&
    isStringArray(policy.readWritePaths) &&
    isStringArray(policy.runtimeReadPaths) &&
    path.isAbsolute(policy.homeDir) &&
    policy.homeDir !== os.homedir()
  )
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && path.isAbsolute(item))
}

function isPrivateNetworkGrantArray(value: unknown): value is PrivateNetworkGrant[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as PrivateNetworkGrant).address === "string" &&
        ((item as PrivateNetworkGrant).port === undefined ||
          (Number.isInteger((item as PrivateNetworkGrant).port) &&
            (item as PrivateNetworkGrant).port! >= 1 &&
            (item as PrivateNetworkGrant).port! <= 65_535)),
    )
  )
}

function isPathWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}
