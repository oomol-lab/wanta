import type { ManagedSkillGroup, PublicSkillPackage } from "../../../electron/skills/common.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import {
  getPublicPackageInstallState,
  initialPublicPackageCatalogState,
  isEmojiIcon,
  publicPackageCatalogReducer,
  skillDocumentPreviewSource,
} from "./skill-route-model.ts"

test("skillDocumentPreviewSource strips frontmatter only when a closing delimiter exists", () => {
  assert.equal(skillDocumentPreviewSource("---\nname: demo\n---\n# Demo\n"), "# Demo\n")
  assert.equal(skillDocumentPreviewSource("---\nname: demo\n# Demo\n"), "---\nname: demo\n# Demo\n")
  assert.equal(skillDocumentPreviewSource("# Demo\n"), "# Demo\n")
  assert.equal(skillDocumentPreviewSource("\uFEFF# Demo\n"), "# Demo\n")
})

test("isEmojiIcon excludes numeric strings", () => {
  assert.equal(isEmojiIcon("123"), false)
  assert.equal(isEmojiIcon(" 123 "), false)
  assert.equal(isEmojiIcon("🎉"), true)
})

test("publicPackageCatalogReducer ignores stale requests and appends unique packages", () => {
  const started = publicPackageCatalogReducer(initialPublicPackageCatalogState, {
    append: false,
    requestId: 2,
    type: "load-start",
  })
  const stale = publicPackageCatalogReducer(started, {
    append: false,
    catalog: { items: [publicPackage("stale")], next: null, updatedAt: "now" },
    requestId: 1,
    type: "load-success",
  })
  const loaded = publicPackageCatalogReducer(stale, {
    append: false,
    catalog: { items: [publicPackage("demo")], next: "next", updatedAt: "now" },
    requestId: 2,
    type: "load-success",
  })
  const appended = publicPackageCatalogReducer(
    { ...loaded, requestId: 3 },
    {
      append: true,
      catalog: { items: [publicPackage("demo"), publicPackage("extra")], next: null, updatedAt: "now" },
      requestId: 3,
      type: "load-success",
    },
  )

  assert.equal(stale, started)
  assert.deepEqual(
    appended.items.map((item) => item.name),
    ["demo", "extra"],
  )
  assert.equal(appended.next, null)
})

test("getPublicPackageInstallState distinguishes installed, conflict, and installable skills", () => {
  const pkg = publicPackage("demo")

  assert.equal(getPublicPackageInstallState(undefined, pkg), "installable")
  assert.equal(getPublicPackageInstallState(new Map([["demo", managedSkillGroup("demo", "demo")]]), pkg), "installed")
  assert.equal(
    getPublicPackageInstallState(new Map([["demo", managedSkillGroup("demo", "@other/demo")]]), pkg),
    "name-conflict",
  )
})

function publicPackage(name: string): PublicSkillPackage {
  return {
    displayName: name,
    id: `${name}@1.0.0`,
    isTemplate: false,
    maintainers: [],
    name,
    skills: [{ name, title: name }],
    version: "1.0.0",
    visibility: "public",
  }
}

function managedSkillGroup(name: string, packageName: string): ManagedSkillGroup {
  const host = {
    agentId: "lumo",
    agentName: "Lumo",
    kind: "registry" as const,
    packageName,
    scope: "runtime" as const,
    status: "installed" as const,
  }

  return {
    externalHosts: [],
    hosts: [host],
    id: name,
    kind: "registry",
    name,
    packageName,
    runtimeHosts: [host],
  }
}
