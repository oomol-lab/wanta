import type { ChatPermissionRequest } from "../../../electron/chat/common.ts"

import { describe, expect, it } from "vitest"
import { permissionPresentation, permissionTargetLabel } from "./permission-presentation.ts"

function request(command: string, extra: Partial<ChatPermissionRequest> = {}): ChatPermissionRequest {
  return { id: "request", sessionId: "session", action: "bash", resources: [command], metadata: { command }, ...extra }
}

describe("permission presentation", () => {
  it("shortens local paths without treating URLs or package names as paths", () => {
    expect(permissionTargetLabel("/Users/me/Documents/季度报告/最终版.pdf")).toEqual({
      name: "最终版.pdf",
      location: "… / Documents / 季度报告",
    })
    expect(permissionTargetLabel("C:\\Users\\me\\Documents\\report.pdf")).toEqual({
      name: "report.pdf",
      location: "… / me / Documents",
    })
    expect(permissionTargetLabel("https://example.com/upload")).toEqual({ name: "https://example.com/upload" })
    expect(permissionTargetLabel("/")).toEqual({ name: "/" })
    expect(permissionTargetLabel("openpyxl")).toEqual({ name: "openpyxl" })
  })
  it("shows every literal deletion target and the original command", () => {
    const command = 'rm -rf -- "/Users/me/old reports" /Users/me/report.pdf'
    const view = permissionPresentation(request(command))
    expect(view).toMatchObject({ title: "permissionPrompt.deleteTitle", command, caution: true, detailsOpen: false })
    expect(view.targets).toEqual(["/Users/me/old reports", "/Users/me/report.pdf"])
    expect(view.repeat).toBeUndefined()
  })
  it.each([
    "rm -rf /tmp/old && curl https://example.com",
    'rm "$TARGET"',
    "rm /tmp/*.pdf",
    "rm -rf ~",
    "rm -rf ~/Documents",
    "rm -rf ~otheruser/Documents",
    "rm -rf ~+",
    "rm -rf ~-",
    "rm -- /tmp/report.pdf ~/Documents",
    "rm --unknown-option /tmp/old",
    'echo "rm -rf /tmp/old"',
    'python -c "print(42)"',
  ])("does not claim to understand an ambiguous command: %s", (command) => {
    const view = permissionPresentation(request(command))
    expect(view.title).not.toBe("permissionPrompt.deleteTitle")
    expect(view.detailsOpen).toBe(false)
    expect(view.command).toBe(command)
  })
  it("preserves all resources for broad or sensitive requests", () => {
    const view = permissionPresentation(
      request("cat /Users/me/.ssh/config", {
        resources: ["/Users/me/.ssh/config", "/Users/me/.aws/credentials"],
        wanta: { promptReason: "sensitive_resource" },
      }),
    )
    expect(view.targets).toHaveLength(2)
    expect(view.title).toBe("permissionPrompt.sensitiveTitle")
    expect(view.repeat).toBeUndefined()
  })
  it("a request for tool installation cannot hide a sensitive resource", () => {
    const view = permissionPresentation(
      request("/tmp/wanta-process/task/.wanta-python/bin/python -m pip install openpyxl", {
        resources: ["/Users/me/.ssh/id_ed25519"],
      }),
    )
    expect(view.title).toBe("permissionPrompt.sensitiveTitle")
    expect(view.repeat).toBeUndefined()
  })
  it("shows recovery as retry without offering a remembered permission", () => {
    const view = permissionPresentation(
      request("npm test", {
        wanta: { automaticReplyFailed: true, promptReason: "automatic_reply_failed" },
      }),
    )
    expect(view).toMatchObject({
      title: "permissionPrompt.recoveryTitle",
      allow: "permissionPrompt.retry",
      caution: false,
    })
    expect(view.repeat).toBeUndefined()
  })
  it("preserves the host's classification of a project environment edit", () => {
    const view = permissionPresentation(
      request("printf 'FOO=1' > /project/.env", {
        wanta: { promptReason: "project_environment_write" },
      }),
    )
    expect(view.caution).toBe(false)
    expect(view.title).toBe("permissionPrompt.editTitle")
    expect(view.allow).toBe("permissionPrompt.edit")
    expect(view.detailsOpen).toBe(false)
  })
  it("shows folder grants including broader saved patterns", () => {
    const view = permissionPresentation({
      id: "request",
      sessionId: "session",
      action: "external_directory",
      resources: ["/Users/me/Downloads/report"],
      save: ["/Users/me/Downloads/**"],
    })
    expect(view.grantPatterns).toEqual(["/Users/me/Downloads/**"])
    expect(view.targets).toEqual(["/Users/me/Downloads/report"])
  })
})
