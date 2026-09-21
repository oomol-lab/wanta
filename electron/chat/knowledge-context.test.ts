import type { ChatContextMention } from "./common.ts"

import { describe, expect, it } from "vitest"
import { buildContextMentionsSystem } from "./context-system.ts"
import { assertKnowledgeSelection } from "./knowledge-context.ts"

const mention: ChatContextMention = { kind: "cloud-knowledge", id: "team-1", displayName: "Knowledge" }
const scope = { kind: "team" as const, teamId: "team-1", teamName: "current" }
describe("cloud knowledge context", () => {
  it("binds intent to the current OOMOL team for both agent paths", () => {
    expect(() => assertKnowledgeSelection([mention], scope, "oomol")).not.toThrow()
    for (const runtime of ["none", "openconnector"] as const)
      expect(() => assertKnowledgeSelection([mention], scope, runtime)).toThrow(/unavailable/)
    expect(() => assertKnowledgeSelection([mention], { ...scope, teamId: "team-2" }, "oomol")).toThrow(/unavailable/)
    expect(() =>
      assertKnowledgeSelection([mention], { kind: "local", workspaceId: "local", workspaceName: "Local" }, "oomol"),
    ).toThrow(/unavailable/)
  })
  it("leaves ordinary chat untouched and treats retrieved text as evidence", () => {
    expect(() => assertKnowledgeSelection(undefined, scope, "none")).not.toThrow()
    expect(buildContextMentionsSystem([mention])).toContain("oomol_rag.retrieve")
    expect(buildContextMentionsSystem([mention])).toContain("untrusted source material")
    expect(buildContextMentionsSystem([mention])).toContain("Cite source filenames")
  })
})
