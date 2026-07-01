import type { ComposerTrigger } from "./composer-triggers.ts"

import assert from "node:assert/strict"
import { describe, test } from "vitest"
import {
  initialComposerPaletteNavigation,
  resolveComposerPaletteNavigation,
  updateComposerPaletteNavigation,
} from "./composer-palette-state.ts"

function trigger(kind: ComposerTrigger["kind"], start: number, query = ""): ComposerTrigger {
  return {
    end: start + 1 + query.length,
    kind,
    query,
    start,
  }
}

describe("composer palette navigation", () => {
  test("defaults slash triggers to the root palette", () => {
    const navigation = resolveComposerPaletteNavigation(initialComposerPaletteNavigation, trigger("slash", 0))

    assert.equal(navigation.mode, "root")
    assert.equal(navigation.activeIndex, 0)
  })

  test("defaults skill triggers to the skills palette", () => {
    const navigation = resolveComposerPaletteNavigation(initialComposerPaletteNavigation, trigger("skill", 4, "git"))

    assert.equal(navigation.mode, "skills")
    assert.equal(navigation.activeIndex, 0)
  })

  test("keeps submenu mode for the same trigger anchor", () => {
    const slash = trigger("slash", 0)
    const updated = updateComposerPaletteNavigation(initialComposerPaletteNavigation, slash, (current) => ({
      ...current,
      activeIndex: 2,
      mode: "skills",
    }))

    const navigation = resolveComposerPaletteNavigation(updated, trigger("slash", 0, "g"))

    assert.equal(navigation.mode, "skills")
    assert.equal(navigation.activeIndex, 0)
  })

  test("resets mode when the trigger anchor changes", () => {
    const updated = updateComposerPaletteNavigation(
      initialComposerPaletteNavigation,
      trigger("slash", 0),
      (current) => ({
        ...current,
        activeIndex: 1,
        mode: "connections",
      }),
    )

    const navigation = resolveComposerPaletteNavigation(updated, trigger("slash", 8))

    assert.equal(navigation.mode, "root")
    assert.equal(navigation.activeIndex, 0)
  })

  test("returns root navigation with no active trigger", () => {
    const updated = updateComposerPaletteNavigation(
      initialComposerPaletteNavigation,
      trigger("slash", 0),
      (current) => ({
        ...current,
        activeIndex: 3,
        mode: "skills",
      }),
    )

    assert.deepEqual(resolveComposerPaletteNavigation(updated, null), {
      activeIndex: 0,
      connectionService: null,
      mode: "root",
      triggerAnchorKey: null,
      triggerQueryKey: null,
    })
  })
})
