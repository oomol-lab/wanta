import { describe, expect, it } from "vitest"
import { knowledgeArchiveUri, knowledgeObjectUri } from "./uri.ts"

describe("knowledgeArchiveUri", () => {
  it("preserves a POSIX path while retaining its absolute-path slash", () => {
    expect(knowledgeArchiveUri("/Users/example/My Books/西游记.wikg", "darwin")).toBe(
      "wikg:///Users/example/My Books/西游记.wikg",
    )
  })

  it("preserves a Windows drive prefix", () => {
    expect(knowledgeArchiveUri("C:\\Users\\example\\My Books\\book.wikg", "win32")).toBe(
      "wikg://C:/Users/example/My Books/book.wikg",
    )
  })
})

describe("knowledgeObjectUri", () => {
  it("accepts archive-relative entity and triple handles", () => {
    expect(knowledgeObjectUri("wikg:///book.wikg", "wikg://entity/Q1")).toBe("wikg:///book.wikg/entity/Q1")
    expect(knowledgeObjectUri("wikg:///book.wikg", "triple/Q1/uses/Q2")).toBe("wikg:///book.wikg/triple/Q1/uses/Q2")
  })

  it("rejects another archive and traversal", () => {
    expect(() => knowledgeObjectUri("wikg:///book.wikg", "../../other.wikg")).toThrow()
    expect(() => knowledgeObjectUri("wikg:///book.wikg", "local/job")).toThrow()
  })
})
