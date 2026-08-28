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

export const EXTERNAL_OO_CONTRACT_VERSION = 2

/**
 * Single source of truth for OO command domains exposed through the privileged
 * external-agent boundary. Guard dispatch, Skill guidance, and bundle-lock
 * verification must derive from this table rather than maintaining parallel lists.
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
    id: "connector.proxy",
    command: ["connector", "proxy"],
    availability: "planned",
    effect: "external_action",
    workspace: "required",
  },
  {
    id: "file.upload",
    command: ["file", "upload"],
    availability: "enabled",
    effect: "local_read",
    workspace: "optional",
  },
  {
    id: "file.download",
    command: ["file", "download"],
    availability: "enabled",
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
    id: "skills.manage",
    command: ["skills"],
    availability: "denied",
    effect: "local_state",
    workspace: "optional",
  },
  ...[
    ["project.current", ["flow", "project", "current"]],
    ["project.list", ["flow", "project", "list"]],
    ["project.show", ["flow", "project", "show"]],
    ["list", ["flow", "list"]],
    ["show", ["flow", "show"]],
    ["inspect", ["flow", "inspect"]],
    ["check", ["flow", "check"]],
    ["node.list", ["flow", "node", "list"]],
    ["node.show", ["flow", "node", "show"]],
    ["code.list", ["flow", "code", "list"]],
    ["code.show", ["flow", "code", "show"]],
    ["connector.list", ["flow", "connector", "list"]],
    ["connector.search", ["flow", "connector", "search"]],
    ["connector.show", ["flow", "connector", "show"]],
    ["connector.connections", ["flow", "connector", "connections"]],
    ["trigger.search", ["flow", "trigger", "search"]],
    ["trigger.show", ["flow", "trigger", "show"]],
    ["trigger.list", ["flow", "trigger", "list"]],
    ["runs.list", ["flow", "runs", "list"]],
    ["runs.show", ["flow", "runs", "show"]],
    ["runs.events", ["flow", "runs", "events"]],
    ["runs.result", ["flow", "runs", "result"]],
    ["publications.list", ["flow", "publications", "list"]],
    ["publications.show", ["flow", "publications", "show"]],
  ].map(([suffix, command]) => ({
    id: `flow.${suffix as string}`,
    command: command as string[],
    availability: "enabled" as const,
    effect: "read_only" as const,
    workspace: "required" as const,
  })),
  ...[
    ["create", ["flow", "create"]],
    ["apply", ["flow", "apply"]],
    ["rename", ["flow", "rename"]],
    ["node.add", ["flow", "node", "add"]],
    ["node.set", ["flow", "node", "set"]],
    ["node.remove", ["flow", "node", "remove"]],
    ["code.edit", ["flow", "code", "edit"]],
    ["code.set", ["flow", "code", "set"]],
    ["connector.add", ["flow", "connector", "add"]],
    ["connector.set", ["flow", "connector", "set"]],
    ["trigger.add", ["flow", "trigger", "add"]],
    ["trigger.set", ["flow", "trigger", "set"]],
    ["trigger.remove", ["flow", "trigger", "remove"]],
    ["connect", ["flow", "connect"]],
    ["disconnect", ["flow", "disconnect"]],
    ["run", ["flow", "run"]],
    ["publish", ["flow", "publish"]],
  ].map(([suffix, command]) => ({
    id: `flow.${suffix as string}`,
    command: command as string[],
    availability: "enabled" as const,
    effect: "external_action" as const,
    workspace: "required" as const,
  })),
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
    id: "llm",
    command: ["llm"],
    availability: "planned",
    effect: "local_state",
    workspace: "optional",
  },
  {
    id: "team.current",
    command: ["team", "current"],
    availability: "planned",
    effect: "read_only",
    workspace: "optional",
  },
  {
    id: "variables",
    command: ["variables"],
    availability: "planned",
    effect: "local_state",
    workspace: "optional",
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
  return EXTERNAL_OO_OPERATIONS.filter(
    (operation) =>
      commandArgs.length >= operation.command.length &&
      operation.command.every((token, index) => commandArgs[index] === token),
  ).sort((left, right) => right.command.length - left.command.length)[0]
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
    "For oo file upload, use only a regular file inside the current turn's managed directories; the host asks for confirmation before bytes leave the machine.",
    "For oo file download, use only an explicit HTTP(S) artifact URL and a destination inside the current turn's managed directories; omitted destinations are pinned to the managed cwd.",
    "Flow commands require an OOMOL runtime and an explicit --project value after resolving oo flow project current; stdin, unmanaged @file references, project switching, deletion, rollback, cancellation, and browser-opening commands remain unavailable.",
    "Flow run and publish are consequential boundaries and require the user's explicit requested scope plus host confirmation.",
    "Skip the Skill recommendation wrap-up; Wanta owns recommendation state and presentation.",
    "Do not replace an unavailable managed domain with an unmanaged OO executable.",
  ].join(" ")
}
