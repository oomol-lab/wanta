import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { ManagedSkillGroup, PublicSkillPackage } from "../../../electron/skills/common.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import {
  buildProviderSkillRecommendations,
  createOfficialProviderSkillPackageName,
  getConnectedProviderSkillCandidates,
  getInstallableProviderSkillRecommendations,
} from "./provider-skill-recommendations.ts"

test("createOfficialProviderSkillPackageName uses the current official naming convention", () => {
  assert.equal(createOfficialProviderSkillPackageName("gmail"), "oo-gmail")
  assert.equal(createOfficialProviderSkillPackageName(" googlecalendar "), "oo-googlecalendar")
})

test("getConnectedProviderSkillCandidates only keeps active connected providers", () => {
  const candidates = getConnectedProviderSkillCandidates([
    provider("gmail"),
    provider("github", { appStatus: "reauth_required" }),
    provider("notion", { status: "available" }),
    provider("gmail", { displayName: "Gmail Duplicate" }),
    provider("amap", { appStatus: undefined }),
  ])

  assert.deepEqual(
    candidates.map((candidate) => [candidate.service, candidate.packageName, candidate.providerDisplayName]),
    [
      ["gmail", "oo-gmail", "Gmail"],
      ["amap", "oo-amap", "Amap"],
    ],
  )
})

test("buildProviderSkillRecommendations reads packages by provider service and classifies install state", () => {
  const packagesByService = new Map([
    ["gmail", publicPackage("oo-gmail")],
    ["github", publicPackage("oo-github")],
    ["notion", publicPackage("oo-notion")],
  ])
  const groupById = new Map([
    ["oo-gmail", managedSkillGroup("oo-gmail", "oo-gmail")],
    ["oo-github", managedSkillGroup("oo-github", "@other/github")],
  ])

  const recommendations = buildProviderSkillRecommendations({
    groupById,
    packagesByService,
    providers: [provider("gmail"), provider("github"), provider("notion"), provider("missing")],
  })

  assert.deepEqual(
    recommendations.map((recommendation) => [
      recommendation.service,
      recommendation.packageName,
      recommendation.skillId,
      recommendation.installState,
    ]),
    [
      ["gmail", "oo-gmail", "oo-gmail", "installed"],
      ["github", "oo-github", "oo-github", "name-conflict"],
      ["notion", "oo-notion", "oo-notion", "installable"],
    ],
  )
  assert.deepEqual(
    getInstallableProviderSkillRecommendations(recommendations).map((recommendation) => recommendation.service),
    ["notion"],
  )
})

function provider(
  service: string,
  options: Partial<Pick<ConnectionProvider, "appStatus" | "displayName" | "status">> = {},
): ConnectionProvider {
  return {
    actionKind: "oauth2",
    appCount: 1,
    apps: [],
    authTypes: ["oauth2"],
    canDisconnect: true,
    categoryLabels: [],
    displayName: options.displayName ?? service[0]?.toUpperCase() + service.slice(1),
    service,
    status: options.status ?? "connected",
    ...(Object.hasOwn(options, "appStatus") ? { appStatus: options.appStatus } : { appStatus: "active" }),
  }
}

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
    agentId: "wanta",
    agentName: "Wanta",
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
