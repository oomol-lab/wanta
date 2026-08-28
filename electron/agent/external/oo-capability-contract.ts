export type ExternalOoAvailability = "denied" | "enabled" | "planned"
export type ExternalOoEffect = "external_action" | "local_read" | "local_state" | "local_write" | "read_only"
export type ExternalOoWorkspace = "none" | "optional" | "required"

export interface ExternalOoOperation {
  id: string
  command: readonly string[]
  availability: ExternalOoAvailability
  effect: ExternalOoEffect
  workspace: ExternalOoWorkspace
}

/**
 * Single source of truth for OO command domains exposed through the privileged
 * external-agent boundary. Guard dispatch, Skill guidance, and compatibility
 * tests must derive from this table rather than maintaining parallel lists.
 */
export const EXTERNAL_OO_OPERATIONS = [
  {
    id: "capability.search",
    command: ["search"],
    availability: "enabled",
    effect: "read_only",
    workspace: "none",
  },
  {
    id: "connector.search",
    command: ["connector", "search"],
    availability: "enabled",
    effect: "read_only",
    workspace: "none",
  },
  {
    id: "connector.schema",
    command: ["connector", "schema"],
    availability: "enabled",
    effect: "read_only",
    workspace: "none",
  },
  {
    id: "connector.apps",
    command: ["connector", "apps"],
    availability: "enabled",
    effect: "read_only",
    workspace: "required",
  },
  {
    id: "connector.run",
    command: ["connector", "run"],
    availability: "enabled",
    effect: "external_action",
    workspace: "required",
  },
  {
    id: "file.upload",
    command: ["file", "upload"],
    availability: "planned",
    effect: "local_read",
    workspace: "optional",
  },
  {
    id: "file.download",
    command: ["file", "download"],
    availability: "planned",
    effect: "local_write",
    workspace: "optional",
  },
  {
    id: "skills.recommend",
    command: ["skills", "recommend"],
    availability: "denied",
    effect: "local_state",
    workspace: "optional",
  },
  {
    id: "flow",
    command: ["flow"],
    availability: "planned",
    effect: "external_action",
    workspace: "required",
  },
  {
    id: "auth",
    command: ["auth"],
    availability: "denied",
    effect: "local_state",
    workspace: "none",
  },
  {
    id: "config",
    command: ["config"],
    availability: "denied",
    effect: "local_state",
    workspace: "none",
  },
  {
    id: "logout",
    command: ["logout"],
    availability: "denied",
    effect: "local_state",
    workspace: "none",
  },
] as const satisfies readonly ExternalOoOperation[]

export function externalOoRootCommandIndex(args: readonly string[]): number {
  let index = 0
  while (index < args.length) {
    const arg = args[index] ?? ""
    if (arg === "--lang") {
      index += 2
      continue
    }
    if (arg.startsWith("--lang=") || ["--debug", "-h", "--help", "-V", "--version"].includes(arg)) {
      index += 1
      continue
    }
    break
  }
  return index
}

export function resolveExternalOoOperation(args: readonly string[]): ExternalOoOperation | undefined {
  const commandArgs = args.slice(externalOoRootCommandIndex(args))
  return EXTERNAL_OO_OPERATIONS.find(
    (operation) =>
      commandArgs.length >= operation.command.length &&
      operation.command.every((token, index) => commandArgs[index] === token),
  )
}

export function externalOoExecutionPolicy(): string {
  const enabled = EXTERNAL_OO_OPERATIONS.filter((operation) => operation.availability === "enabled")
    .map((operation) => `oo ${operation.command.join(" ")}`)
    .join(", ")
  const unavailable = EXTERNAL_OO_OPERATIONS.filter((operation) => operation.availability !== "enabled")
    .map((operation) => operation.id)
    .join(", ")
  return [
    "This host execution profile overrides conflicting command examples or mandatory transport steps in the loaded Skill.",
    `The managed OO boundary supports these command domains: ${enabled}.`,
    `These domains are unavailable unless separately advertised: ${unavailable}.`,
    "Skip the Skill recommendation wrap-up; Wanta owns recommendation state and presentation.",
    "Do not replace an unavailable managed domain with an unmanaged OO executable.",
  ].join(" ")
}
