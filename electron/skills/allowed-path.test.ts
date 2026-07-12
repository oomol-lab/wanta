import assert from "node:assert/strict"
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, test } from "vitest"
import { resolveAllowedSkillDocumentPath, resolveAllowedSkillPath } from "./allowed-path.ts"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

async function fixture(): Promise<{ allowed: string; outside: string; root: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-skill-path-"))
  temporaryRoots.push(root)
  const allowed = path.join(root, "allowed")
  const outside = path.join(root, "outside")
  await Promise.all([mkdir(allowed), mkdir(outside)])
  await writeFile(path.join(allowed, "SKILL.md"), "# Allowed")
  await writeFile(path.join(outside, "secret.txt"), "secret")
  return { allowed, outside, root }
}

test("allowed skill roots and documents resolve to canonical paths", async () => {
  const { allowed } = await fixture()
  const canonicalAllowed = await realpath(allowed)
  assert.equal(await resolveAllowedSkillPath(allowed, [allowed]), canonicalAllowed)
  assert.equal(await resolveAllowedSkillDocumentPath(allowed, [allowed]), path.join(canonicalAllowed, "SKILL.md"))
})

test("symlinks cannot escape an allowed skill root", async () => {
  const { allowed, outside } = await fixture()
  const link = path.join(allowed, "escape")
  await symlink(outside, link)
  await assert.rejects(resolveAllowedSkillPath(path.join(link, "secret.txt"), [allowed]), /not allowed/u)
})
