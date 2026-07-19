import assert from "node:assert/strict"
import { afterEach, test, vi } from "vitest"
import {
  addTeamSkill,
  listTeamSkills,
  normalizeTeamSkillPackages,
  teamSkillMentionId,
  teamSkillsApiEnabled,
  removeTeamSkill,
} from "./team-skills-client.ts"
import { packageAssetsBaseUrl, registryBaseUrl } from "@/lib/domain"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

test("teamSkillMentionId uses the stable team prefix", () => {
  assert.equal(teamSkillMentionId({ id: "config-1", packageName: "@acme/skills", skillName: "alpha" }), "team:config-1")
})

test("normalizeTeamSkillPackages expands registry package infos into skills", () => {
  const config = normalizeTeamSkillPackages({
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

test("normalizeTeamSkillPackages preserves emoji registry icons", () => {
  const config = normalizeTeamSkillPackages({
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

test("listTeamSkills reads registry team package infos", async () => {
  const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
    return new Response(JSON.stringify({ data: [{ name: "@acme/skills", skills: [{ name: "alpha" }] }] }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })
  })
  vi.stubGlobal("fetch", fetchMock)

  const config = await listTeamSkills("team/id")

  assert.equal(config.skills.length, 1)
  assert.equal(String(fetchMock.mock.calls[0]?.[0]), `${registryBaseUrl}/-/oomol/orgs/team%2Fid/package-infos`)
  assert.equal(fetchMock.mock.calls[0]?.[1]?.credentials, "include")
})

test("addTeamSkill and removeTeamSkill use registry team package endpoints", async () => {
  const fetchMock = vi.fn(
    async (_input: string | URL | Request, _init?: RequestInit) => new Response("", { status: 200 }),
  )
  vi.stubGlobal("fetch", fetchMock)

  await addTeamSkill("team/id", {
    packageName: "@acme/skills",
    skillName: "alpha",
    version: "1.2.3",
  })
  await removeTeamSkill("team/id", "@acme/skills")

  const expectedUrl = `${registryBaseUrl}/-/oomol/packages/@acme/skills/orgs/team%2Fid`
  assert.equal(String(fetchMock.mock.calls[0]?.[0]), expectedUrl)
  assert.equal(fetchMock.mock.calls[0]?.[1]?.method, "PUT")
  assert.equal(String(fetchMock.mock.calls[1]?.[0]), expectedUrl)
  assert.equal(fetchMock.mock.calls[1]?.[1]?.method, "DELETE")
})

test("teamSkillsApiEnabled prefers the team flag and supports the legacy flag", () => {
  assert.equal(teamSkillsApiEnabled(), true)

  vi.stubEnv("VITE_WANTA_TEAM_SKILLS_API", "0")
  vi.stubEnv("VITE_WANTA_ORGANIZATION_SKILLS_API", "true")
  assert.equal(teamSkillsApiEnabled(), false)

  vi.unstubAllEnvs()
  vi.stubEnv("VITE_WANTA_ORGANIZATION_SKILLS_API", "0")
  assert.equal(teamSkillsApiEnabled(), false)

  vi.stubEnv("VITE_WANTA_ORGANIZATION_SKILLS_API", "false")
  assert.equal(teamSkillsApiEnabled(), false)

  vi.stubEnv("VITE_WANTA_ORGANIZATION_SKILLS_API", "off")
  assert.equal(teamSkillsApiEnabled(), false)

  vi.stubEnv("VITE_WANTA_ORGANIZATION_SKILLS_API", "true")
  assert.equal(teamSkillsApiEnabled(), true)
})
