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
  expect(prompt).toContain("User-facing deliverables must be written to this exact artifact directory")
  expect(prompt).toContain("/managed/artifacts/turn-1")
  expect(prompt).toContain("/managed/process/turn-1")
  expect(prompt).toContain("Wanta publishes files found there when the turn completes")
  expect(prompt).toContain("<user_request>\nCreate a report\n</user_request>")
})
