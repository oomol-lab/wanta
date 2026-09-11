import type { ComposerDraftRecord } from "../../../electron/chat/common.ts"
import type { ComposerAction } from "./composer-state.ts"

import { afterEach, expect, test, vi } from "vitest"
import { ComposerDrafts } from "./composer-draft-store.ts"
import { initialComposerState } from "./composer-state.ts"
const attachment = { id: "image", path: "/snapshot/image.png", name: "image.png", mime: "image/png", size: 10 }
afterEach(() => vi.useRealTimers())

test("hydrates an image-only draft even when a binding was mounted before disk read", async () => {
  const drafts = new ComposerDrafts(
    async () => ({ new: { ...initialComposerState(), dismissedTriggerKey: null, attachments: [attachment] } }),
    async () => {},
  )
  const binding = drafts.binding("new")
  expect(binding.isReady()).toBe(false)
  await drafts.initialize()
  expect(binding.getSnapshot().attachments).toEqual([attachment])
  expect(binding.isReady()).toBe(true)
})

test("imports finish into their original draft after navigating away and back", async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  const drafts = new ComposerDrafts(async () => ({}), save)
  await drafts.initialize()
  const a = drafts.binding("a")
  const finish = a.beginImport()
  drafts.binding("b").dispatch({ type: "set-draft", draft: "B", selection: { start: 1, end: 1 } })
  finish([attachment])
  expect(drafts.binding("a").getSnapshot().attachments).toEqual([attachment])
  expect(drafts.binding("b").getSnapshot().attachments).toEqual([])
  await drafts.flush()
  expect(save).toHaveBeenCalledWith("a", expect.objectContaining({ attachments: [attachment] }))
})

test("clearing invalidates late imports and undo restores completed contents", async () => {
  const drafts = new ComposerDrafts(
    async () => ({}),
    async () => {},
  )
  await drafts.initialize()
  const binding = drafts.binding("new")
  binding.dispatch({ type: "add-attachments", attachments: [attachment] })
  const finish = binding.beginImport()
  const undo = binding.clear()
  finish([{ ...attachment, id: "late", path: "/late.png" }])
  expect(binding.getSnapshot().attachments).toEqual([])
  undo()
  expect(binding.getSnapshot().attachments).toEqual([attachment])
  expect(binding.getSnapshot().pendingImports).toBe(0)
})

test("successful submission cannot clear edits made after it started", async () => {
  const drafts = new ComposerDrafts(
    async () => ({}),
    async () => {},
  )
  await drafts.initialize()
  const binding = drafts.binding("new")
  binding.dispatch({ type: "set-draft", draft: "first", selection: { start: 5, end: 5 } })
  const submitted = binding.getSnapshot()
  binding.dispatch({ type: "set-draft", draft: "second", selection: { start: 6, end: 6 } })
  drafts.consume("new", submitted)
  expect(binding.getSnapshot().draft).toBe("second")
  drafts.consume("new", binding.getSnapshot())
  expect(binding.getSnapshot().draft).toBe("")
})

test.each<ComposerAction>([
  { type: "set-draft-selection", selection: { start: 0, end: 0 } },
  { type: "set-draft-selection", selection: { start: 5, end: 5 } },
  { type: "set-dismissed-trigger-key", key: "palette" },
  { type: "set-draft", draft: "first", selection: { start: 0, end: 0 } },
])("successful submission clears text after a UI-only update: $type $selection", async (action) => {
  const save = vi.fn().mockResolvedValue(undefined)
  const drafts = new ComposerDrafts(async () => ({}), save)
  await drafts.initialize()
  const binding = drafts.binding("session")
  binding.dispatch({ type: "set-draft", draft: "first", selection: { start: 5, end: 5 } })
  const submitted = binding.getSnapshot()
  binding.dispatch(action)
  drafts.consume("session", submitted)
  await drafts.flush()
  expect(binding.getSnapshot().draft).toBe("")
  expect(save).toHaveBeenLastCalledWith("session", null)
})

test("successful submission preserves updated preferences while clearing sent content", async () => {
  const drafts = new ComposerDrafts(
    async () => ({}),
    async () => {},
  )
  await drafts.initialize()
  const binding = drafts.binding("new")
  binding.dispatch({ type: "set-draft", draft: "first", selection: { start: 5, end: 5 } })
  const submitted = binding.getSnapshot()
  const preferences = { agentKind: "opencode" as const, permissionMode: "default" as const, knowledgeBaseIds: [] }
  drafts.preferences("new", preferences)
  binding.dispatch({ type: "set-draft-selection", selection: { start: 0, end: 0 } })
  drafts.consume("new", submitted)
  expect(binding.getSnapshot()).toMatchObject({ draft: "", preferences })
  await drafts.flush()
})

test("editing away and back or undoing a clear creates a new draft even with identical text", async () => {
  const drafts = new ComposerDrafts(
    async () => ({}),
    async () => {},
  )
  await drafts.initialize()
  const binding = drafts.binding("session")
  binding.dispatch({ type: "set-draft", draft: "first", selection: { start: 5, end: 5 } })
  const submitted = binding.getSnapshot()
  binding.dispatch({ type: "set-draft", draft: "second", selection: { start: 6, end: 6 } })
  binding.dispatch({ type: "set-draft", draft: "first", selection: { start: 5, end: 5 } })
  binding.dispatch({ type: "set-draft-selection", selection: { start: 0, end: 0 } })
  drafts.consume("session", submitted)
  expect(binding.getSnapshot().draft).toBe("first")
  const resubmitted = binding.getSnapshot()
  const undo = binding.clear()
  undo()
  drafts.consume("session", resubmitted)
  expect(binding.getSnapshot().draft).toBe("first")
  await drafts.flush()
})

test.each<ComposerAction>([
  { type: "add-attachments", attachments: [attachment] },
  { type: "add-context-mention", mention: { kind: "skill", id: "new-skill", name: "New skill" } },
  { type: "remove-command" },
])("successful submission preserves new content after $type and a cursor update", async (action) => {
  const drafts = new ComposerDrafts(
    async () => ({ session: { ...initialComposerState(), command: "bug-report" as const, dismissedTriggerKey: null } }),
    async () => {},
  )
  await drafts.initialize()
  const binding = drafts.binding("session")
  binding.dispatch({ type: "set-draft", draft: "first", selection: { start: 5, end: 5 } })
  const submitted = binding.getSnapshot()
  binding.dispatch(action)
  binding.dispatch({ type: "set-draft-selection", selection: { start: 0, end: 0 } })
  const edited = binding.getSnapshot()
  drafts.consume("session", submitted)
  expect(binding.getSnapshot()).toBe(edited)
  await drafts.flush()
})

test("successful submission preserves an import started while sending and its eventual attachment", async () => {
  const drafts = new ComposerDrafts(
    async () => ({}),
    async () => {},
  )
  await drafts.initialize()
  const binding = drafts.binding("session")
  binding.dispatch({ type: "set-draft", draft: "first", selection: { start: 5, end: 5 } })
  const submitted = binding.getSnapshot()
  const finish = binding.beginImport()
  binding.dispatch({ type: "set-draft-selection", selection: { start: 0, end: 0 } })
  drafts.consume("session", submitted)
  expect(binding.getSnapshot().pendingImports).toBe(1)
  finish([attachment])
  drafts.consume("session", submitted)
  expect(binding.getSnapshot().attachments).toEqual([attachment])
  await drafts.flush()
})

test("undo preserves interrupted imports even when the restored draft has no other content", async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  const drafts = new ComposerDrafts(async () => ({}), save)
  await drafts.initialize()
  const binding = drafts.binding("new")
  const finish = binding.beginImport()
  const undo = binding.clear()
  undo()
  finish([attachment])
  expect(binding.getSnapshot()).toMatchObject({ attachments: [], pendingImports: 0, interruptedImport: true })
  await drafts.flush()
  expect(save).toHaveBeenLastCalledWith("new", expect.objectContaining({ interruptedImport: true }))
  const restored = new ComposerDrafts(async () => ({ new: save.mock.calls.at(-1)![1] }), save)
  await restored.initialize()
  expect(restored.binding("new").getSnapshot().interruptedImport).toBe(true)
})

test("persists the latest text and never persists blob previews or pending imports", async () => {
  vi.useFakeTimers()
  const save = vi.fn().mockResolvedValue(undefined)
  const drafts = new ComposerDrafts(async () => ({}), save)
  await drafts.initialize()
  const binding = drafts.binding("new")
  binding.dispatch({ type: "set-draft", draft: "one", selection: { start: 3, end: 3 } })
  binding.dispatch({ type: "set-draft", draft: "two", selection: { start: 3, end: 3 } })
  await vi.advanceTimersByTimeAsync(250)
  expect(save).toHaveBeenCalledTimes(1)
  binding.dispatch({ type: "add-attachments", attachments: [{ ...attachment, previewUrl: "blob:expired" }] })
  binding.beginImport()
  await drafts.flush()
  const value = save.mock.calls.at(-1)?.[1]
  expect(value.attachments[0].previewUrl).toBeUndefined()
  expect(value.pendingImports).toBeUndefined()
})

test("moves a draft into an empty project and refuses to overwrite another draft", async () => {
  const drafts = new ComposerDrafts(
    async () => ({}),
    async () => {},
  )
  await drafts.initialize()
  drafts.binding("new").dispatch({ type: "add-attachments", attachments: [attachment] })
  expect(drafts.move("new", "project")).toBe(true)
  expect(drafts.binding("project").getSnapshot().attachments).toEqual([attachment])
  expect(drafts.binding("new").getSnapshot().attachments).toEqual([])
  drafts.binding("new").dispatch({ type: "set-draft", draft: "other", selection: { start: 5, end: 5 } })
  expect(drafts.move("new", "project")).toBe(false)
  expect(drafts.binding("new").getSnapshot().draft).toBe("other")
})

test("a failed local save can be retried without losing memory state", async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(undefined)
  const drafts = new ComposerDrafts(async () => ({}), save)
  await drafts.initialize()
  const binding = drafts.binding("new")
  binding.dispatch({ type: "add-attachments", attachments: [attachment] })
  await drafts.flush()
  expect(binding.saveError()).toBe(true)
  binding.retrySave()
  await drafts.flush()
  expect(binding.saveError()).toBe(false)
  expect(binding.getSnapshot().attachments).toEqual([attachment])
})

test("hydration preserves a pending import and its completion", async () => {
  let resolve!: (records: Record<string, ComposerDraftRecord>) => void
  const drafts = new ComposerDrafts(
    () =>
      new Promise((done) => {
        resolve = done
      }),
    async () => {},
  )
  const binding = drafts.binding("new")
  const loading = drafts.initialize()
  const finish = binding.beginImport()
  resolve({ new: { ...initialComposerState(), dismissedTriggerKey: null, draft: "saved" } })
  await loading
  expect(binding.getSnapshot()).toMatchObject({ draft: "saved", pendingImports: 1 })
  finish([attachment])
  expect(binding.getSnapshot()).toMatchObject({ draft: "saved", pendingImports: 0, attachments: [attachment] })
})

test("successful saves do not hide a failed load, and successful loads do not hide failed saves", async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error("load failed")).mockResolvedValue({})
  const save = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("save failed"))
    .mockResolvedValue(undefined)
  const drafts = new ComposerDrafts(load, save)
  const binding = drafts.binding("new")
  await drafts.initialize()
  binding.dispatch({ type: "add-attachments", attachments: [attachment] })
  await drafts.flush()
  expect(binding.isReady()).toBe(false)
  expect(binding.saveError()).toBe(true)
  binding.dispatch({ type: "add-attachments", attachments: [{ ...attachment, path: "/second.png", id: "second" }] })
  await drafts.flush()
  await drafts.initialize()
  expect(binding.isReady()).toBe(true)
  expect(binding.saveError()).toBe(true)
  binding.retrySave()
  await drafts.flush()
  expect(binding.saveError()).toBe(false)
})

test("retry saves dirty drafts even while loading continues to fail", async () => {
  const load = vi.fn().mockRejectedValue(new Error("load unavailable"))
  const save = vi.fn().mockRejectedValueOnce(new Error("save unavailable")).mockResolvedValue(undefined)
  const drafts = new ComposerDrafts(load, save)
  const binding = drafts.binding("new")
  await drafts.initialize()
  binding.dispatch({ type: "add-attachments", attachments: [attachment] })
  await drafts.flush()
  expect(binding.saveError()).toBe(true)
  binding.retrySave()
  await drafts.flush()
  expect(load).toHaveBeenCalledTimes(2)
  expect(save).toHaveBeenCalledTimes(2)
  expect(save).toHaveBeenLastCalledWith("new", expect.objectContaining({ attachments: [attachment] }))
  expect(binding.isReady()).toBe(false)
  expect(binding.saveError()).toBe(true)
  load.mockResolvedValue({})
  await drafts.initialize()
  expect(binding.isReady()).toBe(true)
  expect(binding.saveError()).toBe(false)
})
