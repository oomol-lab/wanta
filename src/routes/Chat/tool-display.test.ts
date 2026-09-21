import { describe, expect, it } from "vitest"
import {
  normalizeServiceSlug,
  parseToolAuthorization,
  toolActionSummary,
  toolDisplayInput,
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

  it("renders managed OOCLI connector commands with the same business labels as built-in tools", () => {
    const t = (key: string, vars?: Record<string, string | number>) => `${key}:${vars?.detail ?? ""}`
    const run = {
      kind: "tool" as const,
      partId: "run",
      tool: "execute",
      status: "completed" as const,
      input: { command: 'oo connector run "posthog" --action "run_query" --data \'{}\' --json' },
    }
    const schema = {
      kind: "tool" as const,
      partId: "schema",
      tool: "execute",
      status: "completed" as const,
      input: { command: 'oo connector schema "posthog.run_query" --json' },
    }

    expect(toolDisplayLine(t, run)).toEqual({
      title: "chat.toolCallGeneric:",
      detail: "posthog · run_query",
      detailKind: "text",
    })
    expect(toolActionSummary(t, run)).toBe("chat.toolCall:posthog · run_query")
    expect(toolDisplayLine(t, schema)).toEqual({
      title: "chat.toolInspectGeneric:",
      detail: "posthog · run_query",
      detailKind: "text",
    })
  })

  it("renders managed File and Flow commands without exposing signed URLs", () => {
    const t = (key: string, vars?: Record<string, string | number>) => `${key}:${vars?.detail ?? ""}`
    const download = {
      kind: "tool" as const,
      partId: "download",
      tool: "execute",
      status: "completed" as const,
      input: {
        command: 'oo file download "https://signed.example.test/a?token=secret" ./artifacts --name "report" --ext pdf',
      },
    }
    const publish = {
      kind: "tool" as const,
      partId: "publish",
      tool: "execute",
      status: "completed" as const,
      input: { command: "oo flow publish demo --project project-a --json" },
    }

    expect(toolDisplayLine(t, download)).toEqual({
      title: "chat.toolDownloadFile:",
      detail: "report",
      detailKind: "text",
    })
    expect(JSON.stringify(toolDisplayLine(t, download))).not.toContain("secret")
    expect(toolDisplayInput(download)).toBeUndefined()
    expect(toolDisplayInput({ ...download, input: { ...download.input, destination: "artifacts" } })).toEqual({
      destination: "artifacts",
    })
    expect(toolDisplayInput(publish)).toEqual(publish.input)
    expect(toolActionSummary(t, download)).toBe("chat.toolDownloadFile:")
    expect(toolDisplayLine(t, publish)).toEqual({ title: "chat.toolPublishFlow:" })
    expect(toolActionSummary(t, publish)).toBe("chat.toolPublishFlow:")
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
