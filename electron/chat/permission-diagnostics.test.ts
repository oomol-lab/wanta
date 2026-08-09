import { describe, expect, it } from "vitest"
import { PermissionDiagnostics } from "./permission-diagnostics.ts"

describe("PermissionDiagnostics", () => {
  it("summarizes prompt reasons and automatic reply outcomes without request contents", () => {
    const diagnostics = new PermissionDiagnostics()
    diagnostics.recordPrompt("broad_resource", "session:permission-1")
    diagnostics.recordPrompt("broad_resource", "session:permission-1")
    diagnostics.recordPrompt("broad_resource", "session:permission-2")
    diagnostics.recordPrompt("dependency_mutation")
    diagnostics.recordAutomaticReply("first_attempt")
    diagnostics.recordAutomaticReply("retry_succeeded")

    expect(diagnostics.snapshot()).toEqual({
      automaticReplies: {
        failed: 0,
        first_attempt: 1,
        reconciled: 0,
        retry_succeeded: 1,
      },
      prompts: { broad_resource: 2, dependency_mutation: 1 },
    })
  })
})
