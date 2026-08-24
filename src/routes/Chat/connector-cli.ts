export interface ConnectorCliInvocation {
  action?: string
  operation: "apps" | "run" | "schema" | "search"
  query?: string
  service?: string
}

const cliValue = String.raw`(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))`
const ooExecutable = String.raw`(?:oo|"?\$(?:WANTA_OO_BIN|\{WANTA_OO_BIN\})"?)`

function captured(match: RegExpMatchArray | null): string {
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : ""
}

/** Parse the stable business identity of a managed `oo connector` command. */
export function parseConnectorCliInvocation(command: string): ConnectorCliInvocation | null {
  const normalized = command.replace(/\s+/gu, " ").trim()
  const start = normalized.match(
    new RegExp(String.raw`(?:^|[;&|]\s*)${ooExecutable}\s+connector\s+(apps|run|schema|search)\b`, "iu"),
  )
  const operation = start?.[1]?.toLowerCase() as ConnectorCliInvocation["operation"] | undefined
  if (!start || !operation) return null
  const tail = normalized.slice((start.index ?? 0) + start[0].length).trimStart()
  if (operation === "apps") return { operation }
  if (operation === "search") {
    const query = captured(tail.match(new RegExp(`^${cliValue}`, "u")))
    return { operation, ...(query ? { query } : {}) }
  }
  const target = captured(tail.match(new RegExp(`^${cliValue}`, "u")))
  if (!target) return { operation }
  const separator = target.indexOf(".")
  const service = separator > 0 ? target.slice(0, separator) : target
  const dottedAction = separator > 0 ? target.slice(separator + 1) : ""
  const action = dottedAction || captured(tail.match(new RegExp(String.raw`(?:^|\s)--action(?:=|\s+)${cliValue}`, "u")))
  return { operation, service, ...(action ? { action } : {}) }
}
