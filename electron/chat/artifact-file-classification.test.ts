import { describe, expect, it } from "vitest"
import { isOperationalStateArtifactContent } from "./artifact-file-classification.ts"

const stateContent = JSON.stringify({ task_id: "task-1", poll_count: 2, result_action: "get_result" })

describe("isOperationalStateArtifactContent", () => {
  it("classifies resumable state without filesystem access", () => {
    expect(
      isOperationalStateArtifactContent({
        content: stateContent,
        filePath: "task.resume.json",
        size: stateContent.length,
      }),
    ).toBe(true)
  })

  it("keeps legitimate deliverables and malformed JSON", () => {
    expect(
      isOperationalStateArtifactContent({ content: stateContent, filePath: "report.json", size: stateContent.length }),
    ).toBe(false)
    expect(isOperationalStateArtifactContent({ content: "not-json", filePath: "task.state.json", size: 8 })).toBe(false)
  })

  it("keeps explicitly materialized attachments", () => {
    expect(
      isOperationalStateArtifactContent({
        content: stateContent,
        filePath: "task.session.json",
        origin: "assistant_attachment",
        size: stateContent.length,
      }),
    ).toBe(false)
  })
})
