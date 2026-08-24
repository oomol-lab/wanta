import { describe, expect, it } from "vitest"
import { parseConnectorCliInvocation } from "./connector-cli.ts"

describe("parseConnectorCliInvocation", () => {
  it("parses run and both schema syntaxes", () => {
    expect(parseConnectorCliInvocation('oo connector run "posthog" --action "run_query" --data \'{}\'')).toEqual({
      operation: "run",
      service: "posthog",
      action: "run_query",
    })
    expect(parseConnectorCliInvocation('oo connector schema "posthog.run_query" --json')).toEqual({
      operation: "schema",
      service: "posthog",
      action: "run_query",
    })
    expect(parseConnectorCliInvocation("$WANTA_OO_BIN connector schema posthog --action=list_projects")).toEqual({
      operation: "schema",
      service: "posthog",
      action: "list_projects",
    })
  })

  it("rejects ordinary commands", () => {
    expect(parseConnectorCliInvocation("pnpm test")).toBeNull()
    expect(parseConnectorCliInvocation("echo oo connector run posthog")).toBeNull()
  })
})
