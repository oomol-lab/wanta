import { expect, test } from "vitest"
import { externalAgentPromptText } from "./prompt.ts"

test("external prompt carries Wanta's exact managed turn directories", () => {
  const prompt = externalAgentPromptText({
    artifactDir: "/managed/artifacts/turn-1",
    processDir: "/managed/process/turn-1",
    system: "Host policy",
    text: "Create a report",
  })

  expect(prompt).toContain("Host policy")
  expect(prompt).toContain("Use this exact directory for files you create")
  expect(prompt).toContain("/managed/artifacts/turn-1")
  expect(prompt).toContain("/managed/process/turn-1")
  expect(prompt).toContain("write .wanta-artifact.json")
  expect(prompt).toContain("inspect its byte and line counts first")
  expect(prompt).toContain("very long single-line file")
  expect(prompt).toContain("do not retry the same line-based read")
  expect(prompt).toContain("native write-tool content payload below 16 KB")
  expect(prompt).toContain("controlled shell heredoc in the process directory")
  expect(prompt).toContain("<user_request>\nCreate a report\n</user_request>")
})

test("external prompt omits managed file guidance without turn directories", () => {
  const prompt = externalAgentPromptText({ text: "Explain this code" })

  expect(prompt).toBe("Explain this code")
  expect(prompt).not.toContain("16 KB")
  expect(prompt).not.toContain("byte and line counts")
})
