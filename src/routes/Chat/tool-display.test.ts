import { describe, expect, it } from "vitest"
import {
  normalizeServiceSlug,
  parseToolAuthorization,
  toolActionSummary,
  toolDisplayLine,
  toolServiceSlug,
} from "./tool-display.ts"

describe("tool display", () => {
  it("normalizes service slugs before dropping the oo prefix", () => {
    expect(normalizeServiceSlug("OO-gmail")).toBe("gmail")
    expect(normalizeServiceSlug(" oo-slack ")).toBe("slack")
  })

  it("parses in-app authorization signals without a console URL", () => {
    expect(
      parseToolAuthorization({
        kind: "tool",
        partId: "p1",
        tool: "call_action",
        status: "completed",
        output: JSON.stringify({
          status: "authorization_required",
          service: "gmail",
          action: "list_messages",
          errorCode: "connection_required",
        }),
      }),
    ).toMatchObject({
      action: "list_messages",
      errorCode: "connection_required",
      service: "gmail",
    })
  })

  it("renders connected-app listing as a connector tool", () => {
    const line = toolDisplayLine((key, vars) => `${key}:${vars?.detail ?? ""}`, {
      kind: "tool",
      partId: "p1",
      tool: "list_apps",
      status: "completed",
      input: { service: "gmail" },
    })

    expect(line).toEqual({
      title: "chat.toolListAppsGeneric:",
      detail: "gmail",
      detailKind: "text",
    })
  })

  it("renders knowledge queries without exposing the internal tool name", () => {
    const t = (key: string, vars?: Record<string, string | number>) => `${key}:${vars?.detail ?? ""}`
    const part = {
      kind: "tool" as const,
      partId: "p1",
      tool: "query_knowledge",
      status: "completed" as const,
      input: { operation: "search", query: "唐僧师徒关系" },
    }

    expect(toolDisplayLine(t, part)).toEqual({
      title: "chat.toolKnowledgeSearchGeneric:",
      detail: "唐僧师徒关系",
      detailKind: "text",
    })
    expect(toolActionSummary(t, part)).toBe("chat.toolKnowledgeSearch:唐僧师徒关系")
  })

  it("uses operation-specific knowledge query labels", () => {
    const t = (key: string) => key
    const expected = {
      evidence: "chat.toolKnowledgeEvidenceGeneric",
      inspect: "chat.toolKnowledgeInspectGeneric",
      pack: "chat.toolKnowledgePackGeneric",
      related: "chat.toolKnowledgeRelatedGeneric",
    }

    for (const [operation, title] of Object.entries(expected)) {
      expect(
        toolDisplayLine(t, {
          kind: "tool",
          partId: operation,
          tool: "query_knowledge",
          status: "completed",
          input: { operation },
        }).title,
      ).toBe(title)
    }
  })

  it("extracts the provider slug from an oo 1.3.0 dotted `connector schema` command", () => {
    const slug = (command: string) =>
      toolServiceSlug({ kind: "tool", partId: "p1", tool: "bash", status: "completed", input: { command } })
    // 1.3.0 dotted id `<service>.<action>`: only the service segment before the first dot is the provider slug.
    expect(slug('oo connector schema "gmail.send_mail"')).toBe("gmail")
    expect(slug('oo connector schema "cal.create_schedule" "callingly.get_agent_schedule"')).toBe("cal")
    // Legacy --action form (still valid on 1.3.0) carries a bare service positional.
    expect(slug('oo connector schema "gmail" --action "send_mail"')).toBe("gmail")
    // `connector run` argument syntax is unchanged in 1.3.0 and must keep resolving the bare service.
    expect(slug('oo connector run "slack" --action "post_message"')).toBe("slack")
  })
})
