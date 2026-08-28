export interface ManagedOoCliInvocation {
  domain: "file" | "flow"
  operation: string
  detail?: string
}

const cliValue = String.raw`(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))`
const ooExecutable = String.raw`(?:oo|"?\$(?:WANTA_OO_BIN|\{WANTA_OO_BIN\})"?)`
const globalOptions = String.raw`(?:(?:--debug|--lang(?:=[^\s;&|]+|\s+[^\s;&|]+))\s+)*`
const nestedFlowCommands = new Set(["code", "connector", "node", "project", "publications", "runs", "trigger"])

function captured(match: RegExpMatchArray | null): string {
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : ""
}

function baseName(value: string): string {
  return value.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? ""
}

/** Parse safe display metadata without surfacing signed download URLs. */
export function parseManagedOoCliInvocation(command: string): ManagedOoCliInvocation | null {
  const normalized = command.replace(/\s+/gu, " ").trim()
  const file = normalized.match(
    new RegExp(String.raw`(?:^|[;&|]\s*)${ooExecutable}\s+${globalOptions}file\s+(upload|download)\b`, "iu"),
  )
  const fileOperation = file?.[1]?.toLowerCase()
  if (file && (fileOperation === "upload" || fileOperation === "download")) {
    const tail = normalized.slice((file.index ?? 0) + file[0].length).trimStart()
    if (fileOperation === "upload") {
      const filePath = captured(tail.match(new RegExp(`^${cliValue}`, "u")))
      const detail = baseName(filePath)
      return { domain: "file", operation: fileOperation, ...(detail ? { detail } : {}) }
    }
    const name = captured(tail.match(new RegExp(String.raw`(?:^|\s)--name(?:=|\s+)${cliValue}`, "u")))
    return { domain: "file", operation: fileOperation, ...(name ? { detail: baseName(name) } : {}) }
  }

  const flow = normalized.match(
    new RegExp(
      String.raw`(?:^|[;&|]\s*)${ooExecutable}\s+${globalOptions}flow\s+([a-z][\w-]*)(?:\s+([a-z][\w-]*))?`,
      "iu",
    ),
  )
  if (!flow) return null
  const flowCommand = flow[1]?.toLowerCase() ?? ""
  const nested = flow[2]?.toLowerCase()
  return {
    domain: "flow",
    operation: nestedFlowCommands.has(flowCommand) && nested ? `${flowCommand}.${nested}` : flowCommand,
  }
}
