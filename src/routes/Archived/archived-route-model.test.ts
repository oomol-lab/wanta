import { describe, expect, test } from "vitest"
import { visibleArchivedSessions } from "./archived-route-model.ts"

function session(id: string, title: string, createdAt: number, updatedAt: number) {
  return { id, title, createdAt, updatedAt, archivedAt: updatedAt + 1_000 }
}

describe("visibleArchivedSessions", () => {
  const sessions = [
    session("a", "Zebra report", 1_000, 4_000),
    session("b", "Alpha task", 3_000, 2_000),
    session("c", "Video subtitles", 2_000, 3_000),
  ]

  test("filters sessions by title", () => {
    expect(visibleArchivedSessions(sessions, "TASK", "updatedAt").map((item) => item.id)).toEqual(["b"])
  })

  test("sorts by updated time by default mode", () => {
    expect(visibleArchivedSessions(sessions, "", "updatedAt").map((item) => item.id)).toEqual(["a", "c", "b"])
  })

  test("sorts by created time", () => {
    expect(visibleArchivedSessions(sessions, "", "createdAt").map((item) => item.id)).toEqual(["b", "c", "a"])
  })

  test("sorts by title", () => {
    expect(visibleArchivedSessions(sessions, "", "title").map((item) => item.id)).toEqual(["b", "c", "a"])
  })
})
