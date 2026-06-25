import assert from "node:assert/strict"
import { test } from "vitest"
import {
  normalizeOrganizationSkillConfig,
  normalizeResolvedOrganizationSkills,
  organizationSkillMentionId,
} from "./organization-skills-client.ts"

test("normalizeOrganizationSkillConfig keeps valid skills sorted by order", () => {
  const config = normalizeOrganizationSkillConfig({
    skills: [
      {
        enabled: false,
        id: "b",
        order: 20,
        package_name: "@acme/skills",
        skill_name: "beta",
        version: "1.0.0",
      },
      {
        description: "Use Gmail consistently",
        display_name: "Alpha Skill",
        enabled: true,
        id: "a",
        order: 10,
        packageName: "@acme/skills",
        skillName: "alpha",
        version: "latest",
        version_policy: "latest",
        visibility: "private",
      },
      { id: "invalid" },
    ],
    updated_at: "now",
  })

  assert.equal(config.updatedAt, "now")
  assert.deepEqual(
    config.skills.map((skill) => skill.id),
    ["a", "b"],
  )
  assert.equal(config.skills[0]?.displayName, "Alpha Skill")
  assert.equal(config.skills[0]?.versionPolicy, "latest")
  assert.equal(config.skills[0]?.visibility, "private")
  assert.equal(config.skills[1]?.displayName, "beta")
  assert.equal(config.skills[1]?.enabled, false)
})

test("normalizeResolvedOrganizationSkills drops incomplete entries", () => {
  const resolved = normalizeResolvedOrganizationSkills({
    skills: [
      {
        archive_url: "https://example.com/skill.tgz",
        checksum: "sha256:abc",
        config_id: "config-1",
        manifest: {
          entry: "SKILL.md",
          files: [{ checksum: "sha256:file", path: "SKILL.md" }, { checksum: 123 }, { path: "assets/logo.png" }],
          format: "oomol-skill-archive",
        },
        package_name: "@acme/skills",
        skill_name: "alpha",
        version: "1.0.0",
      },
      { config_id: "missing-version", package_name: "@acme/skills", skill_name: "beta" },
    ],
  })

  assert.equal(resolved.skills.length, 1)
  assert.equal(resolved.skills[0]?.archiveUrl, "https://example.com/skill.tgz")
  assert.equal(resolved.skills[0]?.configId, "config-1")
  assert.deepEqual(resolved.skills[0]?.manifest, {
    entry: "SKILL.md",
    files: [{ checksum: "sha256:file", path: "SKILL.md" }, { path: "assets/logo.png" }],
    format: "oomol-skill-archive",
  })
})

test("organizationSkillMentionId uses the stable organization prefix", () => {
  assert.equal(
    organizationSkillMentionId({ id: "config-1", packageName: "@acme/skills", skillName: "alpha" }),
    "organization:config-1",
  )
})
