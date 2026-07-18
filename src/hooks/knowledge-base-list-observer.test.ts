import type { KnowledgeBaseSummary } from "../../electron/knowledge/common.ts"

import { describe, expect, it, vi } from "vitest"
import { observeKnowledgeBaseList } from "./knowledge-base-list-observer.ts"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, reject, resolve }
}

function knowledgeBase(id: string): KnowledgeBaseSummary {
  return {
    authors: [],
    capabilities: { fullTextSearch: true, knowledgeGraph: false, readingGraph: false, summary: false },
    id,
    importedAt: 1,
    size: 1,
    sourceFileName: `${id}.md`,
    statistics: {},
    title: id,
  }
}

describe("observeKnowledgeBaseList", () => {
  it("keeps the newest list when an older request completes last", async () => {
    const first = deferred<KnowledgeBaseSummary[]>()
    const second = deferred<KnowledgeBaseSummary[]>()
    const applied: string[][] = []
    let calls = 0
    let emitChange: (() => void) | undefined
    const dispose = observeKnowledgeBaseList({
      load: () => {
        calls += 1
        return calls === 1 ? first.promise : second.promise
      },
      onError: vi.fn(),
      onItems: (items) => applied.push(items.map((item) => item.id)),
      onSettled: vi.fn(),
      subscribe: (listener) => {
        emitChange = listener
        return vi.fn()
      },
    })

    emitChange?.()
    second.resolve([knowledgeBase("new")])
    await second.promise
    first.resolve([knowledgeBase("old")])
    await first.promise

    expect(applied).toEqual([["new"]])
    dispose()
  })

  it("ignores stale failures after a newer request succeeds", async () => {
    const first = deferred<KnowledgeBaseSummary[]>()
    const second = deferred<KnowledgeBaseSummary[]>()
    const onError = vi.fn()
    const onSettled = vi.fn()
    let calls = 0
    let emitChange: (() => void) | undefined
    const dispose = observeKnowledgeBaseList({
      load: () => {
        calls += 1
        return calls === 1 ? first.promise : second.promise
      },
      onError,
      onItems: vi.fn(),
      onSettled,
      subscribe: (listener) => {
        emitChange = listener
        return vi.fn()
      },
    })

    emitChange?.()
    second.resolve([knowledgeBase("new")])
    await second.promise
    first.reject(new Error("stale"))
    await expect(first.promise).rejects.toThrow("stale")

    expect(onError).not.toHaveBeenCalled()
    expect(onSettled).toHaveBeenCalledOnce()
    dispose()
  })

  it("does not update state after disposal", async () => {
    const initial = deferred<KnowledgeBaseSummary[]>()
    const onItems = vi.fn()
    const onSettled = vi.fn()
    const unsubscribe = vi.fn()
    const dispose = observeKnowledgeBaseList({
      load: () => initial.promise,
      onError: vi.fn(),
      onItems,
      onSettled,
      subscribe: () => unsubscribe,
    })

    dispose()
    initial.resolve([knowledgeBase("late")])
    await initial.promise

    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(onItems).not.toHaveBeenCalled()
    expect(onSettled).not.toHaveBeenCalled()
  })
})
