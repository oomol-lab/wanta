import assert from "node:assert/strict"
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, test } from "vitest"
import { TrustedLocalAccess } from "./trusted-local-access.ts"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-trusted-access-"))
  temporaryRoots.push(root)
  return root
}

test("trusted roots combine project, attachment, permission, and persistent sources", async () => {
  const root = await temporaryRoot()
  const project = path.join(root, "project")
  const attachment = path.join(root, "attachment.txt")
  const permission = path.join(root, "exports")
  const persistent = path.join(root, "persistent")
  await Promise.all([mkdir(project), mkdir(permission), mkdir(persistent), writeFile(attachment, "content")])
  const access = new TrustedLocalAccess({ loadAdditionalRoots: async () => [persistent] })

  access.setProjectRoot("session-1", project)
  access.rememberAttachments("session-1", [
    { id: "attachment-1", kind: "file", mime: "text/plain", name: "attachment.txt", path: attachment, size: 7 },
  ])
  access.rememberPermissionResources("session-1", {
    action: "external_directory",
    id: "request-1",
    resources: [`${permission}/*`],
    sessionId: "session-1",
  })

  const roots = await access.roots()
  assert.equal(roots.includes(await realpath(project)), true)
  assert.equal(roots.includes(await realpath(attachment)), true)
  assert.equal(roots.includes(await realpath(permission)), true)
  assert.equal(roots.includes(await realpath(persistent)), true)
})

test("copied session access remains isolated from later parent changes", async () => {
  const root = await temporaryRoot()
  const first = path.join(root, "first")
  const second = path.join(root, "second")
  await Promise.all([mkdir(first), mkdir(second)])
  const access = new TrustedLocalAccess({ loadAdditionalRoots: async () => [] })
  access.rememberPermissionResources("parent", {
    action: "external_directory",
    id: "request-1",
    resources: [first],
    sessionId: "parent",
  })
  assert.equal(access.copySession("parent", "child"), true)
  access.rememberPermissionResources("parent", {
    action: "external_directory",
    id: "request-2",
    resources: [second],
    sessionId: "parent",
  })
  access.deleteSession("parent")

  assert.equal(await access.assertPath(first).then(() => true), true)
  access.deleteSession("child")
  await assert.rejects(access.assertPath(first), /not available/u)
})
