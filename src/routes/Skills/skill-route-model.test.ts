import type { ManagedSkillGroup, PublicSkillPackage } from "../../../electron/skills/common.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import {
  getInstallableOrganizationSkills,
  getGroupStatus,
  getOrganizationSkillRuntimeStatus,
  getPublicSkillInstallState,
  getPublicPackageInstallState,
  getRuntimeHosts,
  getRuntimeSkillRemoveTarget,
  getSelectedManagedSkillGroup,
  initialPublicPackageCatalogState,
  isEmojiIcon,
  matchesInstalledSkillFilter,
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
  const cleared = publicPackageCatalogReducer(loaded, {
    append: false,
    clearItems: true,
    requestId: 3,
    type: "load-start",
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
  assert.deepEqual(cleared.items, [])
  assert.equal(cleared.next, null)
  assert.equal(cleared.status, "loading")
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

test("external installed public skills remain installable into Wanta", () => {
  const pkg = {
    ...publicPackage("demo"),
    name: "@alice/demo",
    skills: [{ name: "demo", title: "Demo" }],
  }
  const groupById = new Map([["demo", externalManagedSkillGroup("demo", "@alice/demo", "codex", "Codex")]])

  assert.equal(getPublicSkillInstallState(groupById, pkg, "demo"), "external-installed")
  assert.equal(getPublicPackageInstallState(groupById, pkg), "external-installed")
})

test("mixed installed and external public skills remain installable into Wanta", () => {
  const pkg = {
    ...publicPackage("demo"),
    name: "@alice/demo",
    skills: [
      { name: "runtime", title: "Runtime" },
      { name: "external", title: "External" },
    ],
  }
  const groupById = new Map([
    ["runtime", managedSkillGroup("runtime", "@alice/demo")],
    ["external", externalManagedSkillGroup("external", "@alice/demo", "codex", "Codex")],
  ])

  assert.equal(getPublicSkillInstallState(groupById, pkg, "runtime"), "installed")
  assert.equal(getPublicSkillInstallState(groupById, pkg, "external"), "external-installed")
  assert.equal(getPublicPackageInstallState(groupById, pkg), "external-installed")
})

test("matchesInstalledSkillFilter can filter by Wanta, Codex, and Claude Code hosts", () => {
  const runtimeGroup = managedSkillGroup("runtime", "@alice/runtime")
  const codexGroup = externalManagedSkillGroup("codex-only", "@alice/codex-only", "codex", "Codex")
  const claudeCodeGroup = externalManagedSkillGroup("claude-only", "@alice/claude-only", "claude-code", "Claude Code")

  assert.equal(matchesInstalledSkillFilter(runtimeGroup, "wanta", undefined), true)
  assert.equal(matchesInstalledSkillFilter(runtimeGroup, "codex", undefined), false)
  assert.equal(matchesInstalledSkillFilter(codexGroup, "codex", undefined), true)
  assert.equal(matchesInstalledSkillFilter(codexGroup, "wanta", undefined), false)
  assert.equal(matchesInstalledSkillFilter(claudeCodeGroup, "claude-code", undefined), true)
})

test("getSelectedManagedSkillGroup does not fall back to the first skill", () => {
  const first = managedSkillGroup("first", "@alice/first")
  const second = managedSkillGroup("second", "@alice/second")
  const groups = [first, second]

  assert.equal(getSelectedManagedSkillGroup(groups, null), undefined)
  assert.equal(getSelectedManagedSkillGroup(groups, "missing"), undefined)
  assert.equal(getSelectedManagedSkillGroup(groups, "second"), second)
})

test("runtime status ignores modified external hosts", () => {
  const group = managedSkillGroup("demo", "@alice/demo")
  const externalHost = {
    agentId: "claude-code",
    agentName: "Claude Code",
    controlState: "modified" as const,
    kind: "registry" as const,
    packageName: "@alice/demo",
    scope: "external" as const,
    status: "installed" as const,
  }
  const mixedGroup: ManagedSkillGroup = {
    ...group,
    externalHosts: [externalHost],
    hosts: [...group.hosts, externalHost],
  }

  assert.equal(getGroupStatus(mixedGroup, t, getRuntimeHosts(mixedGroup)).tone, "ready")
  assert.equal(getGroupStatus(mixedGroup, t).tone, "attention")
})

test("getOrganizationSkillRuntimeStatus classifies installed and conflict states", () => {
  const orgSkill = {
    enabled: true,
    packageName: "@alice/demo",
    skillName: "demo",
    version: "1.0.0",
  }

  assert.equal(getOrganizationSkillRuntimeStatus(undefined, orgSkill).state, "missing")
  assert.equal(
    getOrganizationSkillRuntimeStatus(
      new Map([["demo", managedSkillGroup("demo", "@alice/demo", { version: "1.0.0" })]]),
      orgSkill,
    ).state,
    "installed-same",
  )
  assert.equal(
    getOrganizationSkillRuntimeStatus(
      new Map([["demo", managedSkillGroup("demo", "@alice/demo", { version: "1.1.0" })]]),
      orgSkill,
    ).state,
    "installed-version-mismatch",
  )
  assert.equal(
    getOrganizationSkillRuntimeStatus(
      new Map([["demo", managedSkillGroup("demo", "@alice/demo", { version: "1.1.0" })]]),
      { ...orgSkill, version: "latest" },
    ).state,
    "installed-same",
  )
  assert.equal(
    getOrganizationSkillRuntimeStatus(
      new Map([["demo", managedSkillGroup("demo", "@other/demo", { version: "1.0.0" })]]),
      orgSkill,
    ).state,
    "same-id-different-package",
  )
  assert.equal(
    getOrganizationSkillRuntimeStatus(
      new Map([["demo", managedSkillGroup("demo", undefined, { kind: "local" })]]),
      orgSkill,
    ).state,
    "local-conflict",
  )
})

test("getInstallableOrganizationSkills only returns runtime-missing skills", () => {
  const installed = managedSkillGroup("installed", "@alice/installed", { version: "1.0.0" })
  const externalOnlyHost = {
    agentId: "claude-code",
    agentName: "Claude Code",
    kind: "registry" as const,
    packageName: "@alice/external",
    scope: "external" as const,
    status: "installed" as const,
    version: "1.0.0",
  }
  const externalOnly: ManagedSkillGroup = {
    ...managedSkillGroup("external", "@alice/external", { version: "1.0.0" }),
    externalHosts: [externalOnlyHost],
    hosts: [externalOnlyHost],
    runtimeHosts: [],
  }
  const groupById = new Map([
    ["installed", installed],
    ["external", externalOnly],
  ])
  const skills = [
    { enabled: true, packageName: "@alice/installed", skillName: "installed", version: "1.0.0" },
    { enabled: true, packageName: "@alice/missing", skillName: "missing", version: "1.0.0" },
    { enabled: true, packageName: "@alice/external", skillName: "external", version: "1.0.0" },
    { enabled: false, packageName: "@alice/disabled", skillName: "disabled", version: "1.0.0" },
  ]

  assert.deepEqual(
    getInstallableOrganizationSkills(groupById, skills).map((skill) => skill.skillName),
    ["missing", "external"],
  )
})

test("getRuntimeSkillRemoveTarget only returns installed runtime skills", () => {
  const runtimeSkill = managedSkillGroup("demo", "@alice/demo")
  const externalHost = {
    agentId: "claude-code",
    agentName: "Claude Code",
    kind: "registry" as const,
    packageName: "@alice/external",
    scope: "external" as const,
    status: "installed" as const,
  }
  const externalOnly: ManagedSkillGroup = {
    ...managedSkillGroup("external", "@alice/external"),
    externalHosts: [externalHost],
    hosts: [externalHost],
    runtimeHosts: [],
  }
  const groupById = new Map([
    ["demo", runtimeSkill],
    ["external", externalOnly],
  ])

  assert.deepEqual(getRuntimeSkillRemoveTarget(groupById, { packageName: "@alice/demo", skillName: "demo" }), {
    displayName: "demo",
    groupId: "demo",
    packageName: "@alice/demo",
    skillName: "demo",
  })
  assert.equal(getRuntimeSkillRemoveTarget(groupById, { packageName: "@alice/external", skillName: "external" }), null)
  assert.equal(getRuntimeSkillRemoveTarget(groupById, { packageName: "@alice/missing", skillName: "missing" }), null)
})

test("getRuntimeSkillRemoveTarget can require matching package names", () => {
  const groupById = new Map([["demo", managedSkillGroup("demo", "@other/demo")]])

  assert.equal(
    getRuntimeSkillRemoveTarget(
      groupById,
      { displayName: "Demo", packageName: "@alice/demo", skillName: "demo" },
      { requirePackageMatch: true },
    ),
    null,
  )
  assert.deepEqual(getRuntimeSkillRemoveTarget(groupById, { packageName: "@alice/demo", skillName: "demo" }), {
    displayName: "demo",
    groupId: "demo",
    packageName: "@alice/demo",
    skillName: "demo",
  })
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

function managedSkillGroup(
  name: string,
  packageName: string | undefined,
  options: {
    controlState?: "controlled" | "modified" | "source-missing" | "unknown"
    kind?: "local" | "registry" | "unknown"
    version?: string
  } = {},
): ManagedSkillGroup {
  const host = {
    agentId: "wanta",
    agentName: "Wanta",
    ...(options.controlState ? { controlState: options.controlState } : {}),
    kind: options.kind ?? ("registry" as const),
    ...(packageName ? { packageName } : {}),
    scope: "runtime" as const,
    status: "installed" as const,
    ...(options.version ? { version: options.version } : {}),
  }

  return {
    externalHosts: [],
    hosts: [host],
    id: name,
    kind: options.kind ?? "registry",
    name,
    ...(packageName ? { packageName } : {}),
    runtimeHosts: [host],
    ...(options.version ? { version: options.version } : {}),
  }
}

function externalManagedSkillGroup(
  name: string,
  packageName: string | undefined,
  agentId: string,
  agentName: string,
): ManagedSkillGroup {
  const host = {
    agentId,
    agentName,
    kind: "registry" as const,
    ...(packageName ? { packageName } : {}),
    scope: "external" as const,
    status: "installed" as const,
  }

  return {
    externalHosts: [host],
    hosts: [host],
    id: name,
    kind: "registry",
    name,
    ...(packageName ? { packageName } : {}),
    runtimeHosts: [],
  }
}

function t(key: string, vars?: Record<string, string | number>): string {
  return vars ? `${key}:${JSON.stringify(vars)}` : key
}
