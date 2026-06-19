import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "vitest"
import { metadataFileName } from "./constants.ts"
import { scanInstalledSkills, scanLumoInstalledSkills } from "./scan.ts"

test("scanInstalledSkills reads managed skill frontmatter metadata from SKILL.md", async () => {
  const homeEnvVar = "OO_DESKTOP_TEST_AGENT_HOME"
  const originalHome = process.env[homeEnvVar]
  const homePath = await mkdtemp(path.join(os.tmpdir(), "oo-desktop-installed-skills-"))
  const skillRoot = path.join(homePath, "skills")
  const managedPath = path.join(skillRoot, "managed")

  process.env[homeEnvVar] = homePath

  try {
    await mkdir(managedPath, { recursive: true })
    await Promise.all([
      writeFile(
        path.join(managedPath, "SKILL.md"),
        [
          "---",
          "name: managed",
          "description: Managed skill description",
          "icon: ':lucide:captions:'",
          "metadata:",
          "  packageName: '@alice/managed'",
          "  version: '0.2.0'",
          "---",
          "# Managed",
          "",
        ].join("\n"),
      ),
      writeFile(path.join(managedPath, metadataFileName), JSON.stringify({ kind: "local" })),
    ])

    const skills = await scanInstalledSkills([
      {
        cliCommands: [],
        homeEnvVar,
        homeRoot: ".unused",
        id: "codex",
        name: "Codex",
        ooCliAgentId: "codex",
      },
    ])

    assert.equal(skills[0]?.metadata.description, "Managed skill description")
    assert.equal(skills[0]?.metadata.icon, ":lucide:captions:")
    assert.equal(skills[0]?.metadata.kind, "local")
    assert.equal(skills[0]?.metadata.packageName, "@alice/managed")
    assert.equal(skills[0]?.metadata.version, "0.2.0")
  } finally {
    if (originalHome === undefined) {
      delete process.env[homeEnvVar]
    } else {
      process.env[homeEnvVar] = originalHome
    }
    await rm(homePath, { force: true, recursive: true })
  }
})

test("scanInstalledSkills ignores hidden skill root directories", async () => {
  const homeEnvVar = "OO_DESKTOP_TEST_AGENT_HOME"
  const originalHome = process.env[homeEnvVar]
  const homePath = await mkdtemp(path.join(os.tmpdir(), "oo-desktop-hidden-installed-skills-"))
  const skillRoot = path.join(homePath, "skills")
  const visiblePath = path.join(skillRoot, "visible")
  const hiddenPath = path.join(skillRoot, ".system")

  process.env[homeEnvVar] = homePath

  try {
    await Promise.all([mkdir(visiblePath, { recursive: true }), mkdir(hiddenPath, { recursive: true })])
    await Promise.all([
      writeFile(
        path.join(visiblePath, "SKILL.md"),
        ["---", "name: visible", "description: Visible skill", "---", "# Visible", ""].join("\n"),
      ),
      writeFile(path.join(visiblePath, metadataFileName), JSON.stringify({ kind: "local" })),
      writeFile(
        path.join(hiddenPath, "SKILL.md"),
        ["---", "name: .system", "description: Hidden skill", "---", "# Hidden", ""].join("\n"),
      ),
      writeFile(path.join(hiddenPath, metadataFileName), JSON.stringify({ kind: "local" })),
    ])

    const skills = await scanInstalledSkills([
      {
        cliCommands: [],
        homeEnvVar,
        homeRoot: ".unused",
        id: "codex",
        name: "Codex",
        ooCliAgentId: "codex",
      },
    ])

    assert.deepEqual(
      skills.map((skill) => skill.name),
      ["visible"],
    )
  } finally {
    if (originalHome === undefined) {
      delete process.env[homeEnvVar]
    } else {
      process.env[homeEnvVar] = originalHome
    }
    await rm(homePath, { force: true, recursive: true })
  }
})

test("scanInstalledSkills includes callable SKILL.md directories without OOMOL metadata", async () => {
  const homeEnvVar = "OO_DESKTOP_TEST_AGENT_HOME"
  const originalHome = process.env[homeEnvVar]
  const homePath = await mkdtemp(path.join(os.tmpdir(), "oo-desktop-local-installed-skills-"))
  const skillRoot = path.join(homePath, "skills")
  const localPath = path.join(skillRoot, "local-callable")

  process.env[homeEnvVar] = homePath

  try {
    await mkdir(localPath, { recursive: true })
    await writeFile(
      path.join(localPath, "SKILL.md"),
      [
        "---",
        "name: local-callable",
        "description: Callable local skill",
        "icon: ':lucide:terminal:'",
        "metadata:",
        "  packageName: '@alice/local-callable'",
        "  version: '0.1.0'",
        "---",
        "# Local Callable",
        "",
      ].join("\n"),
    )

    const skills = await scanInstalledSkills([
      {
        cliCommands: [],
        homeEnvVar,
        homeRoot: ".unused",
        id: "codex",
        name: "Codex",
        ooCliAgentId: "codex",
      },
    ])

    assert.equal(skills.length, 1)
    assert.equal(skills[0]?.metadata.description, "Callable local skill")
    assert.equal(skills[0]?.metadata.icon, ":lucide:terminal:")
    assert.equal(skills[0]?.metadata.kind, "local")
    assert.equal(skills[0]?.metadata.packageName, "@alice/local-callable")
    assert.equal(skills[0]?.metadata.version, "0.1.0")
    assert.equal(skills[0]?.sourcePath, localPath)
  } finally {
    if (originalHome === undefined) {
      delete process.env[homeEnvVar]
    } else {
      process.env[homeEnvVar] = originalHome
    }
    await rm(homePath, { force: true, recursive: true })
  }
})

test("scanInstalledSkills ignores backup skill directories", async () => {
  const homeEnvVar = "OO_DESKTOP_TEST_AGENT_HOME"
  const originalHome = process.env[homeEnvVar]
  const homePath = await mkdtemp(path.join(os.tmpdir(), "oo-desktop-backup-installed-skills-"))
  const skillRoot = path.join(homePath, "skills")
  const currentPath = path.join(skillRoot, "video-subtitle-translator")
  const backupPath = path.join(skillRoot, "video-subtitle-translator.backup-20260527-091243")

  process.env[homeEnvVar] = homePath

  try {
    await Promise.all([mkdir(currentPath, { recursive: true }), mkdir(backupPath, { recursive: true })])
    await Promise.all([
      writeFile(
        path.join(currentPath, "SKILL.md"),
        ["---", "name: video-subtitle-translator", "description: Current subtitle skill", "---", "# Current", ""].join(
          "\n",
        ),
      ),
      writeFile(path.join(currentPath, metadataFileName), JSON.stringify({ kind: "registry", version: "0.0.9" })),
      writeFile(
        path.join(backupPath, "SKILL.md"),
        ["---", "name: video-subtitle-translator", "description: Backup subtitle skill", "---", "# Backup", ""].join(
          "\n",
        ),
      ),
      writeFile(path.join(backupPath, metadataFileName), JSON.stringify({ kind: "registry", version: "0.0.7" })),
    ])

    const skills = await scanInstalledSkills([
      {
        cliCommands: [],
        homeEnvVar,
        homeRoot: ".unused",
        id: "codex",
        name: "Codex",
        ooCliAgentId: "codex",
      },
    ])

    assert.deepEqual(
      skills.map((skill) => skill.name),
      ["video-subtitle-translator"],
    )
    assert.equal(skills[0]?.metadata.version, "0.0.9")
  } finally {
    if (originalHome === undefined) {
      delete process.env[homeEnvVar]
    } else {
      process.env[homeEnvVar] = originalHome
    }
    await rm(homePath, { force: true, recursive: true })
  }
})

test("scanLumoInstalledSkills reads shared Agent Skills and prefers app cache as source", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "lumo-shared-skills-"))
  const sharedSkillRoot = path.join(rootPath, ".agents", "skills")
  const cacheSkillStoreRoot = path.join(rootPath, "cache", "skills")
  const sharedManagedPath = path.join(sharedSkillRoot, "managed")
  const cachedManagedPath = path.join(cacheSkillStoreRoot, "registry", "managed")
  const sharedUncachedPath = path.join(sharedSkillRoot, "uncached")

  try {
    await Promise.all([
      mkdir(sharedManagedPath, { recursive: true }),
      mkdir(cachedManagedPath, { recursive: true }),
      mkdir(sharedUncachedPath, { recursive: true }),
    ])
    await Promise.all([
      writeFile(
        path.join(sharedManagedPath, "SKILL.md"),
        ["---", "name: managed", "description: Shared managed Skill", "---", "# Managed", ""].join("\n"),
      ),
      writeFile(
        path.join(sharedManagedPath, metadataFileName),
        JSON.stringify({ kind: "registry", packageName: "@alice/managed", version: "0.2.0" }),
      ),
      writeFile(
        path.join(cachedManagedPath, "SKILL.md"),
        ["---", "name: managed", "description: Cached managed Skill", "---", "# Managed", ""].join("\n"),
      ),
      writeFile(
        path.join(cachedManagedPath, metadataFileName),
        JSON.stringify({ kind: "registry", packageName: "@alice/managed", version: "0.2.0" }),
      ),
      writeFile(
        path.join(sharedUncachedPath, "SKILL.md"),
        ["---", "name: uncached", "description: Shared uncached Skill", "---", "# Uncached", ""].join("\n"),
      ),
      writeFile(
        path.join(sharedUncachedPath, metadataFileName),
        JSON.stringify({ kind: "registry", packageName: "@alice/uncached", version: "0.1.0" }),
      ),
    ])

    const skills = await scanLumoInstalledSkills({ cacheSkillStoreRoot, sharedSkillRoot })
    const managed = skills.find((skill) => skill.name === "managed")
    const uncached = skills.find((skill) => skill.name === "uncached")

    assert.equal(managed?.agent.id, "lumo")
    assert.equal(managed?.path, sharedManagedPath)
    assert.equal(managed?.sourcePath, cachedManagedPath)
    assert.equal(uncached?.path, sharedUncachedPath)
    assert.equal(uncached?.sourcePath, sharedUncachedPath)
  } finally {
    await rm(rootPath, { force: true, recursive: true })
  }
})
