import assert from "node:assert/strict"
import { test } from "vitest"
import { ArtifactResourceLeaseStore } from "./lease-store.ts"

const input = { mime: "application/pdf", modifiedAt: 10, path: "/tmp/report.pdf", size: 100 }

test("artifact resource leases expire and refresh on access", () => {
  const store = new ArtifactResourceLeaseStore(100, 4)
  const lease = store.grant(input, 1_000)
  assert.equal(store.resolve(lease.token, 1_050)?.expiresAt, 1_150)
  assert.equal(store.resolve(lease.token, 1_151), null)
})

test("artifact resource lease store removes the oldest lease at capacity", () => {
  const store = new ArtifactResourceLeaseStore(1_000, 2)
  const first = store.grant(input, 1)
  const second = store.grant({ ...input, path: "/tmp/second.pdf" }, 2)
  const third = store.grant({ ...input, path: "/tmp/third.pdf" }, 3)
  assert.equal(store.resolve(first.token, 4), null)
  assert.equal(store.resolve(second.token, 4)?.path, "/tmp/second.pdf")
  assert.equal(store.resolve(third.token, 4)?.path, "/tmp/third.pdf")
})
