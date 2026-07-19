import assert from "node:assert/strict"
import { test } from "vitest"
import { ArtifactPreviewLoadCancelledError, ArtifactPreviewLoadScheduler } from "./artifact-preview-scheduler.ts"

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

test("preview scheduler caps concurrent loads", async () => {
  const scheduler = new ArtifactPreviewLoadScheduler(2)
  const first = deferred<number>()
  const second = deferred<number>()
  const third = deferred<number>()
  let active = 0
  let peak = 0
  const schedule = (job: ReturnType<typeof deferred<number>>) =>
    scheduler.schedule(async () => {
      active += 1
      peak = Math.max(peak, active)
      const value = await job.promise
      active -= 1
      return value
    }, "background")

  const results = [schedule(first), schedule(second), schedule(third)]
  first.resolve(1)
  second.resolve(2)
  await Promise.resolve()
  await Promise.resolve()
  third.resolve(3)

  assert.deepEqual(await Promise.all(results), [1, 2, 3])
  assert.equal(peak, 2)
})

test("preview scheduler starts queued interactive work before background work", async () => {
  const scheduler = new ArtifactPreviewLoadScheduler(1)
  const blocker = deferred<void>()
  const order: string[] = []
  const first = scheduler.schedule(async () => {
    order.push("active-background")
    await blocker.promise
  }, "background")
  const background = scheduler.schedule(async () => {
    order.push("queued-background")
  }, "background")
  const interactive = scheduler.schedule(async () => {
    order.push("interactive")
  }, "interactive")

  blocker.resolve()
  await Promise.all([first, background, interactive])

  assert.deepEqual(order, ["active-background", "interactive", "queued-background"])
})

test("preview scheduler cancels queued work before it starts", async () => {
  const scheduler = new ArtifactPreviewLoadScheduler(1)
  const blocker = deferred<void>()
  const controller = new AbortController()
  let cancelledStarted = false
  const first = scheduler.schedule(() => blocker.promise, "interactive")
  const cancelled = scheduler.schedule(
    async () => {
      cancelledStarted = true
    },
    "background",
    controller.signal,
  )

  controller.abort()
  await assert.rejects(cancelled, ArtifactPreviewLoadCancelledError)
  blocker.resolve()
  await first
  assert.equal(cancelledStarted, false)
})

test("preview scheduler drops the oldest background task when the queue is full", async () => {
  const scheduler = new ArtifactPreviewLoadScheduler(1, 1)
  const blocker = deferred<void>()
  const order: string[] = []
  const first = scheduler.schedule(() => blocker.promise, "interactive")
  const dropped = scheduler.schedule(async () => {
    order.push("dropped")
  }, "background")
  const retained = scheduler.schedule(async () => {
    order.push("retained")
  }, "background")

  await assert.rejects(dropped, ArtifactPreviewLoadCancelledError)
  blocker.resolve()
  await Promise.all([first, retained])
  assert.deepEqual(order, ["retained"])
})
