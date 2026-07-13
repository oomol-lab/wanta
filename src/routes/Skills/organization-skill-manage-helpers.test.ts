import type { PublicSkillPackage } from "../../../electron/skills/common.ts"
import type { OrganizationSkillConfigItem } from "@/lib/organization-skills-client"
import type { ProviderSkillRecommendation } from "@/routes/Skills/provider-skill-recommendations.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import {
  buildInstallableOrganizationRecommendationSkills,
  buildOrganizationSkillRecommendationItems,
  canOpenManagedProviderRecommendation,
  shouldOpenOrganizationSkillManagement,
} from "./organization-skill-manage-helpers.ts"

function organizationSkill(input: Partial<OrganizationSkillConfigItem>): OrganizationSkillConfigItem {
  return {
    displayName: input.displayName ?? "Gmail",
    enabled: input.enabled ?? true,
    id: input.id ?? "org-gmail",
    order: input.order ?? 0,
    packageName: input.packageName ?? "oo-gmail",
    skillName: input.skillName ?? "gmail",
    version: input.version ?? "1.0.0",
    versionPolicy: input.versionPolicy ?? "pinned",
    visibility: input.visibility ?? "public",
    ...(input.description ? { description: input.description } : {}),
    ...(input.icon ? { icon: input.icon } : {}),
  }
}

function publicPackage(input: Partial<PublicSkillPackage>): PublicSkillPackage {
  return {
    displayName: input.displayName ?? "Gmail",
    id: input.id ?? input.name ?? "oo-gmail",
    isTemplate: input.isTemplate ?? false,
    maintainers: input.maintainers ?? [],
    name: input.name ?? "oo-gmail",
    skills: input.skills ?? [{ name: "gmail", title: "Gmail" }],
    version: input.version ?? "1.0.0",
    visibility: input.visibility ?? "public",
    ...(input.description ? { description: input.description } : {}),
    ...(input.icon ? { icon: input.icon } : {}),
  }
}

function providerRecommendation(input: Partial<ProviderSkillRecommendation>): ProviderSkillRecommendation {
  const packageName = input.packageName ?? "oo-gmail"
  const skillId = input.skillId ?? "gmail"
  return {
    installState: input.installState ?? "installable",
    package: input.package ?? publicPackage({ name: packageName, skills: [{ name: skillId, title: skillId }] }),
    packageName,
    providerDisplayName: input.providerDisplayName ?? "Gmail",
    service: input.service ?? "gmail",
    skillId,
  }
}

test("buildOrganizationSkillRecommendationItems merges sources and lets organization recommendations win", () => {
  const items = buildOrganizationSkillRecommendationItems({
    filter: "all",
    normalizedQuery: "",
    providerRecommendations: [
      providerRecommendation({ packageName: "OO-GMAIL", skillId: "gmail" }),
      providerRecommendation({ packageName: "oo-slack", service: "slack", skillId: "slack" }),
    ],
    skills: [organizationSkill({ packageName: "oo-gmail", skillName: "gmail" })],
  })

  assert.deepEqual(
    items.map((item) => item.type),
    ["configured", "recommended"],
  )
  assert.deepEqual(
    items.map((item) => (item.type === "configured" ? item.skill.skillName : item.recommendation.skillId)),
    ["gmail", "slack"],
  )
})

test("buildOrganizationSkillRecommendationItems applies source filter and query", () => {
  const items = buildOrganizationSkillRecommendationItems({
    filter: "recommended",
    normalizedQuery: "posthog",
    providerRecommendations: [
      providerRecommendation({ packageName: "oo-posthog", providerDisplayName: "PostHog", skillId: "posthog" }),
      providerRecommendation({
        packageName: "oo-slack",
        providerDisplayName: "Slack",
        service: "slack",
        skillId: "slack",
      }),
    ],
    skills: [organizationSkill({ displayName: "PostHog", packageName: "oo-posthog", skillName: "posthog" })],
  })

  assert.deepEqual(
    items.map((item) => item.id),
    [],
  )
})

test("buildInstallableOrganizationRecommendationSkills includes runtime-missing and external-only recommendations", () => {
  const items = buildOrganizationSkillRecommendationItems({
    filter: "all",
    normalizedQuery: "",
    providerRecommendations: [
      providerRecommendation({ installState: "external-installed", packageName: "oo-slack", skillId: "slack" }),
      providerRecommendation({ installState: "installed", packageName: "oo-linear", skillId: "linear" }),
    ],
    skills: [organizationSkill({ packageName: "oo-gmail", skillName: "gmail" })],
  })

  const targets = buildInstallableOrganizationRecommendationSkills({
    groupById: new Map(),
    items,
  })

  assert.deepEqual(targets, [
    { packageName: "oo-gmail", skillName: "gmail" },
    { packageName: "oo-slack", skillName: "slack" },
  ])
})

test("downloaded organization skills open management directly", () => {
  assert.equal(shouldOpenOrganizationSkillManagement("installed-same"), true)
  assert.equal(shouldOpenOrganizationSkillManagement("installed-modified"), true)
  assert.equal(shouldOpenOrganizationSkillManagement("installed-version-mismatch"), true)
  assert.equal(shouldOpenOrganizationSkillManagement("external-only"), true)
  assert.equal(shouldOpenOrganizationSkillManagement("missing"), false)
  assert.equal(shouldOpenOrganizationSkillManagement("local-conflict"), false)
  assert.equal(shouldOpenOrganizationSkillManagement("same-id-different-package"), false)
  assert.equal(shouldOpenOrganizationSkillManagement("unknown-conflict"), false)
})

test("provider recommendations use the same direct-management policy as the market", () => {
  assert.equal(canOpenManagedProviderRecommendation(providerRecommendation({ installState: "installed" })), true)
  assert.equal(
    canOpenManagedProviderRecommendation(providerRecommendation({ installState: "external-installed" })),
    true,
  )
  assert.equal(canOpenManagedProviderRecommendation(providerRecommendation({ installState: "name-conflict" })), false)
  assert.equal(canOpenManagedProviderRecommendation(providerRecommendation({ installState: "installable" })), false)
})
