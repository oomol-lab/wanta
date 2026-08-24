import { describe, expect, it } from "vitest"
import { parseClaudeAuthStatus } from "./probe.ts"

describe("parseClaudeAuthStatus", () => {
  it("recognizes the current Claude CLI logged-in response", () => {
    expect(parseClaudeAuthStatus(JSON.stringify({ loggedIn: true, authMethod: "oauth" }))).toEqual({
      status: "logged_in",
    })
  })

  it("recognizes an explicit logged-out response", () => {
    expect(parseClaudeAuthStatus(JSON.stringify({ loggedIn: false }))).toEqual({ status: "logged_out" })
  })

  it("falls back when the command is unsupported or malformed", () => {
    expect(parseClaudeAuthStatus("unknown command: auth")).toBeUndefined()
    expect(parseClaudeAuthStatus(JSON.stringify({ authenticated: true }))).toBeUndefined()
  })
})
