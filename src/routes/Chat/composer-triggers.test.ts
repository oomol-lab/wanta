import { describe, expect, it } from "vitest"
import { detectComposerTrigger, replaceComposerTrigger } from "./composer-triggers.ts"

describe("detectComposerTrigger", () => {
  it("detects a slash trigger at the start of the composer", () => {
    expect(detectComposerTrigger("/rev", 4)).toEqual({
      end: 4,
      kind: "slash",
      query: "rev",
      start: 0,
    })
  })

  it("detects a skill trigger after whitespace", () => {
    expect(detectComposerTrigger("use $ai-elements", 16)).toEqual({
      end: 16,
      kind: "skill",
      query: "ai-elements",
      start: 4,
    })
  })

  it("detects a context trigger after whitespace", () => {
    expect(detectComposerTrigger("ask @gmail", 10)).toEqual({
      end: 10,
      kind: "context",
      query: "gmail",
      start: 4,
    })
  })

  it("does not detect slash inside a filesystem path", () => {
    expect(detectComposerTrigger("open /Users/me/file.ts", 11)).toBeNull()
  })

  it("does not detect context trigger inside email or ordinary words", () => {
    expect(detectComposerTrigger("send to a@b.com", 11)).toBeNull()
    expect(detectComposerTrigger("mention foo@bar", 15)).toBeNull()
  })

  it("does not detect when text is selected", () => {
    expect(detectComposerTrigger("/review", 1, 3)).toBeNull()
  })

  it("replaces only the active trigger range", () => {
    const trigger = detectComposerTrigger("please $ai", 10)
    expect(trigger).not.toBeNull()
    expect(replaceComposerTrigger("please $ai", trigger!, "$ai-elements ")).toBe("please $ai-elements ")
  })
})
