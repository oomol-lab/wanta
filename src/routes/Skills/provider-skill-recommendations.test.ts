import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { ManagedSkillGroup, PublicSkillPackage } from "../../../electron/skills/common.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import {
  buildProviderSkillRecommendations,
  getConventionalProviderSkillPackageName,
  getConnectedProviderSkillCandidates,
  getInstallableProviderSkillRecommendations,
  getProviderSkillSearchQueries,
  isHighConfidenceProviderSkillPackage,
  scoreProviderSkillPackage,
  selectProviderSkillPackage,
} from "./provider-skill-recommendations.ts"

test("getProviderSkillSearchQueries derives registry search terms from provider metadata", () => {
  assert.deepEqual(
    getProviderSkillSearchQueries({
      providerDisplayName: "Google BigQuery",
      service: "google_bigquery",
    }),
    ["Google BigQuery", "google_bigquery"],
  )
})

test("getConventionalProviderSkillPackageName derives the official package convention without a mapping table", () => {
  assert.equal(getConventionalProviderSkillPackageName(providerCandidate("posthog", "PostHog")), "oo-posthog")
  assert.equal(
    getConventionalProviderSkillPackageName(providerCandidate("google_bigquery", "Google BigQuery")),
    "oo-google_bigquery",
  )
  assert.equal(getConventionalProviderSkillPackageName(providerCandidate("bad service", "Bad Service")), null)
})

test("getConnectedProviderSkillCandidates keeps active connected providers as package candidates", () => {
  const candidates = getConnectedProviderSkillCandidates([
    provider("Gmail"),
    provider("github", { appStatus: "reauth_required" }),
    provider("notion", { status: "available" }),
    provider("gmail", { displayName: "Gmail Duplicate" }),
    provider("amap", { appStatus: undefined }),
    provider("posthog", { displayName: "PostHog" }),
    provider("google_bigquery"),
    provider("bad service"),
  ])

  assert.deepEqual(
    candidates.map((candidate) => [candidate.service, candidate.providerDisplayName]),
    [
      ["gmail", "Gmail"],
      ["amap", "Amap"],
      ["posthog", "PostHog"],
      ["google_bigquery", "Google_bigquery"],
    ],
  )
})

test("selectProviderSkillPackage ranks registry search results without a provider mapping table", () => {
  const candidate = providerCandidate("posthog", "PostHog")
  const selected = selectProviderSkillPackage(candidate, [
    publicPackageWithOptions("analytics-helper", { description: "Generic product analytics workflows" }),
    publicPackageWithOptions("oo-posthog", {
      description: "PostHog connector workflows",
      displayName: "PostHog",
    }),
  ])

  assert.equal(selected?.name, "oo-posthog")
  assert.equal(scoreProviderSkillPackage(candidate, publicPackage("unrelated")), 0)
})

test("isHighConfidenceProviderSkillPackage only accepts exact provider/package matches", () => {
  const candidate = providerCandidate("posthog", "PostHog")

  assert.equal(isHighConfidenceProviderSkillPackage(candidate, publicPackage("oo-posthog")), true)
  assert.equal(
    isHighConfidenceProviderSkillPackage(
      candidate,
      publicPackageWithOptions("analytics-helper", { skills: [{ name: "posthog", title: "PostHog" }] }),
    ),
    true,
  )
  assert.equal(
    isHighConfidenceProviderSkillPackage(
      candidate,
      publicPackageWithOptions("analytics-helper", { description: "PostHog workflows" }),
    ),
    false,
  )
})

test("buildProviderSkillRecommendations reads packages by provider service and classifies install state", () => {
  const packagesByService = new Map([
    ["gmail", publicPackage("oo-gmail")],
    ["github", publicPackage("oo-github")],
    ["notion", publicPackage("oo-notion")],
    ["posthog", publicPackage("oo-posthog")],
    ["unmapped", publicPackage("oo-unmapped")],
  ])
  const groupById = new Map([
    ["oo-gmail", managedSkillGroup("oo-gmail", "oo-gmail")],
    ["oo-github", managedSkillGroup("oo-github", "@other/github")],
  ])

  const recommendations = buildProviderSkillRecommendations({
    groupById,
    packagesByService,
    providers: [
      provider("gmail"),
      provider("github"),
      provider("notion"),
      provider("posthog"),
      provider("unmapped"),
      provider("missing"),
    ],
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
      ["posthog", "oo-posthog", "oo-posthog", "installable"],
      ["unmapped", "oo-unmapped", "oo-unmapped", "installable"],
    ],
  )
  assert.deepEqual(
    getInstallableProviderSkillRecommendations(recommendations).map((recommendation) => recommendation.service),
    ["notion", "posthog", "unmapped"],
  )
})

test("getInstallableProviderSkillRecommendations de-duplicates the same runtime Skill", () => {
  const recommendations = [
    {
      ...providerCandidate("gmail", "Gmail"),
      installState: "installable" as const,
      package: publicPackage("oo-gmail"),
      packageName: "oo-gmail",
      skillId: "gmail",
    },
    {
      ...providerCandidate("google-mail", "Google Mail"),
      installState: "partially-installed" as const,
      package: publicPackage("oo-gmail"),
      packageName: "OO-GMAIL",
      skillId: "GMAIL",
    },
  ]

  assert.deepEqual(
    getInstallableProviderSkillRecommendations(recommendations).map((recommendation) => recommendation.service),
    ["gmail"],
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
  return publicPackageWithOptions(name, {})
}

function publicPackageWithOptions(name: string, options: Partial<PublicSkillPackage>): PublicSkillPackage {
  return {
    description: options.description,
    displayName: name,
    id: `${name}@1.0.0`,
    isTemplate: false,
    maintainers: options.maintainers ?? [],
    name,
    skills: [{ name, title: name }],
    version: "1.0.0",
    visibility: "public",
    ...options,
  }
}

function providerCandidate(service: string, providerDisplayName: string) {
  return { providerDisplayName, service }
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
