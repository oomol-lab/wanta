import { expect, test } from "vitest"
import { nativeSkillSourceObservation } from "./native-skill-source.ts"

test("detects native global Skill roots without returning the private path", () => {
  expect(
    nativeSkillSourceObservation({ variant: "ListDir", target_directory: "/Users/alice/.agents/skills/oo-posthog" }),
  ).toEqual({ skillId: "oo-posthog", source: "native_global" })
  expect(nativeSkillSourceObservation({ path: "C:\\Users\\alice\\.claude\\skills\\oo" })).toEqual({
    skillId: "oo",
    source: "native_global",
  })
})

test("ignores managed and malformed Skill paths", () => {
  expect(nativeSkillSourceObservation({ path: "/managed/.opencode/skills/oo" })).toBeUndefined()
  expect(nativeSkillSourceObservation({ path: "/Users/alice/.agents/skills/../../secret" })).toBeUndefined()
  expect(nativeSkillSourceObservation({ command: "echo no skill path" })).toBeUndefined()
})
