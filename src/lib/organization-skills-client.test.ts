import assert from "node:assert/strict"
import { afterEach, test, vi } from "vitest"
import {
  addOrganizationSkill,
  listOrganizationSkills,
  normalizeOrganizationSkillConfig,
  normalizeOrganizationSkillPackages,
  normalizeResolvedOrganizationSkills,
  organizationSkillMentionId,
  organizationSkillsApiEnabled,
  removeOrganizationSkill,
} from "./organization-skills-client.ts"
import { packageAssetsBaseUrl, registryBaseUrl } from "@/lib/domain"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

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

test("normalizeOrganizationSkillPackages expands registry package infos into skills", () => {
  const config = normalizeOrganizationSkillPackages({
    data: [
      {
        description: "Package description",
        icon: "assets/icon.png",
        isPrivate: false,
        name: "@acme/skills",
        packageVersion: "1.2.3",
        skills: [{ description: "Skill description", name: "alpha", title: "Alpha" }, { name: "beta" }],
      },
    ],
  })

  assert.equal(config.skills.length, 2)
  assert.equal(config.skills[0]?.id, "@acme/skills:alpha")
  assert.equal(config.skills[0]?.displayName, "Alpha")
  assert.equal(config.skills[0]?.description, "Skill description")
  assert.equal(config.skills[0]?.packageName, "@acme/skills")
  assert.equal(config.skills[0]?.version, "1.2.3")
  assert.equal(config.skills[0]?.visibility, "public")
  assert.equal(
    config.skills[0]?.icon,
    `${packageAssetsBaseUrl}/packages/@acme/skills/1.2.3/files/package/assets/icon.png`,
  )
  assert.equal(config.skills[1]?.displayName, "beta")
})

test("normalizeOrganizationSkillPackages preserves emoji registry icons", () => {
  const config = normalizeOrganizationSkillPackages({
    data: [
      {
        icon: "🛍️",
        name: "@acme/ecommerce",
        packageVersion: "1.0.0",
        skills: [{ name: "image-studio", title: "Image Studio" }],
      },
    ],
  })

  assert.equal(config.skills[0]?.icon, "🛍️")
})

test("listOrganizationSkills reads registry organization package infos", async () => {
  const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
    return new Response(JSON.stringify({ data: [{ name: "@acme/skills", skills: [{ name: "alpha" }] }] }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })
  })
  vi.stubGlobal("fetch", fetchMock)

  const config = await listOrganizationSkills("org/id")

  assert.equal(config.skills.length, 1)
  assert.equal(String(fetchMock.mock.calls[0]?.[0]), `${registryBaseUrl}/-/oomol/orgs/org%2Fid/package-infos`)
  assert.equal(fetchMock.mock.calls[0]?.[1]?.credentials, "include")
})

test("addOrganizationSkill and removeOrganizationSkill use registry organization package endpoints", async () => {
  const fetchMock = vi.fn(
    async (_input: string | URL | Request, _init?: RequestInit) => new Response("", { status: 200 }),
  )
  vi.stubGlobal("fetch", fetchMock)

  await addOrganizationSkill("org/id", {
    packageName: "@acme/skills",
    skillName: "alpha",
    version: "1.2.3",
  })
  await removeOrganizationSkill("org/id", "@acme/skills")

  const expectedUrl = `${registryBaseUrl}/-/oomol/packages/@acme/skills/orgs/org%2Fid`
  assert.equal(String(fetchMock.mock.calls[0]?.[0]), expectedUrl)
  assert.equal(fetchMock.mock.calls[0]?.[1]?.method, "PUT")
  assert.equal(String(fetchMock.mock.calls[1]?.[0]), expectedUrl)
  assert.equal(fetchMock.mock.calls[1]?.[1]?.method, "DELETE")
})

test("organizationSkillsApiEnabled defaults on unless explicitly disabled", () => {
  assert.equal(organizationSkillsApiEnabled(), true)

  vi.stubEnv("VITE_WANTA_ORGANIZATION_SKILLS_API", "0")
  assert.equal(organizationSkillsApiEnabled(), false)

  vi.stubEnv("VITE_WANTA_ORGANIZATION_SKILLS_API", "false")
  assert.equal(organizationSkillsApiEnabled(), false)

  vi.stubEnv("VITE_WANTA_ORGANIZATION_SKILLS_API", "off")
  assert.equal(organizationSkillsApiEnabled(), false)

  vi.stubEnv("VITE_WANTA_ORGANIZATION_SKILLS_API", "true")
  assert.equal(organizationSkillsApiEnabled(), true)
})
