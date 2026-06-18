import assert from "node:assert/strict"
import { test } from "vitest"
import {
  assertSkillOperationSucceeded,
  createAdoptLocalSkillArgs,
  createBundledSkillVersionCheck,
  createCliCheckUpdateArgs,
  createCliUpdateArgs,
  createDeleteSkillArgs,
  createFailedRegistrySkillVersionCheck,
  createInstallRegistrySkillArgs,
  createPublishedSkillVersionCheckFromPackageInfo,
  createPublishSkillArgs,
  createRegistryPackageInfoVersionCheckCommand,
  createRegistrySkillVersionCheck,
  createRegistrySkillCheckUpdateArgs,
  createRegistrySkillVersionCheckFromUpdateResult,
  createShareSkillArgs,
  normalizeMyPublishedPackageList,
  normalizePublicSkillPackageCatalog,
  normalizeRegistryPackageVersionInfo,
  normalizeRegistryPackageSkillInfo,
  normalizeSkillShareInfo,
  createSkillSearchArgs,
  normalizeRegistrySkillCheckUpdateResults,
  normalizeSkillSearchResults,
  normalizeSkillShareResult,
  normalizeCliCheckUpdateResult,
  createUpdateRegistrySkillArgs,
} from "./actions.ts"

test("createCliUpdateArgs keeps oo self-update commands", () => {
  assert.deepEqual(createCliCheckUpdateArgs(), ["check-update", "--json"])
  assert.deepEqual(createCliUpdateArgs(), ["update"])
})

test("createSkillSearchArgs uses oo-cli json output", () => {
  assert.deepEqual(createSkillSearchArgs(" image "), ["skills", "search", "image", "--json"])
})

test("createRegistrySkillCheckUpdateArgs checks registry skills as json", () => {
  assert.deepEqual(createRegistrySkillCheckUpdateArgs(), ["skills", "check-update", "--json"])
  assert.deepEqual(createRegistrySkillCheckUpdateArgs([" @alice/demo "]), [
    "skills",
    "check-update",
    "@alice/demo",
    "--json",
  ])
})

test("normalizeSkillSearchResults keeps structured registry skills", () => {
  assert.deepEqual(
    normalizeSkillSearchResults(
      JSON.stringify([
        {
          description: "Generate images",
          name: "gpt-image-2",
          packageName: "@alwaysmavs/gpt-image-2",
          packageVersion: "1.2.3",
          skillDisplayName: "GPT Image",
        },
        {
          name: "",
          packageName: "@invalid/package",
        },
      ]),
    ),
    [
      {
        description: "Generate images",
        displayName: "GPT Image",
        id: "@alwaysmavs/gpt-image-2:gpt-image-2",
        packageName: "@alwaysmavs/gpt-image-2",
        skillId: "gpt-image-2",
        version: "1.2.3",
      },
    ],
  )
})

test("normalizeMyPublishedPackageList keeps account package metadata", () => {
  assert.deepEqual(
    normalizeMyPublishedPackageList(
      JSON.stringify({
        data: [
          {
            description: "Review code",
            displayName: "Autoreview",
            icon: "icon.png",
            name: "@alice/autoreview",
            updateTime: 1770000000000,
            version: "0.0.1",
            visibility: "private",
          },
          {
            name: "",
            version: "0.0.2",
          },
        ],
        next: "next-page",
      }),
    ),
    {
      next: "next-page",
      packages: [
        {
          description: "Review code",
          displayName: "Autoreview",
          icon: "icon.png",
          name: "@alice/autoreview",
          updateTime: 1770000000000,
          version: "0.0.1",
          visibility: "private",
        },
      ],
    },
  )
})

test("normalizePublicSkillPackageCatalog keeps public package metadata", () => {
  assert.deepEqual(
    normalizePublicSkillPackageCatalog(
      JSON.stringify({
        data: [
          {
            description: "Generate images",
            displayName: "GPT Image 2",
            downloadCount: 60,
            extra: {
              maintainers: JSON.stringify([{ id: "user-1", name: "alice", url: "https://example.com/a.png" }]),
            },
            icon: ":simple-icons:openai:",
            isTemplate: false,
            name: "@alice/gpt-image-2",
            skills: [
              {
                description: "Generate images",
                name: "gpt-image-2",
                title: "GPT Image 2",
              },
              {
                name: "",
              },
            ],
            updateTime: 1780000000000,
            version: "1.1.1",
            visibility: "public",
          },
          {
            name: "",
          },
        ],
        next: "next-page",
      }),
      "2026-06-18T00:00:00.000Z",
    ),
    {
      items: [
        {
          description: "Generate images",
          displayName: "GPT Image 2",
          downloadCount: 60,
          icon: ":simple-icons:openai:",
          id: "@alice/gpt-image-2@1.1.1",
          isTemplate: false,
          maintainers: [{ id: "user-1", name: "alice", url: "https://example.com/a.png" }],
          name: "@alice/gpt-image-2",
          skills: [
            {
              description: "Generate images",
              name: "gpt-image-2",
              title: "GPT Image 2",
            },
          ],
          updateTime: 1780000000000,
          version: "1.1.1",
          visibility: "public",
        },
      ],
      next: "next-page",
      updatedAt: "2026-06-18T00:00:00.000Z",
    },
  )
})

test("normalizeRegistryPackageSkillInfo expands published package skills", () => {
  assert.deepEqual(
    normalizeRegistryPackageSkillInfo(
      JSON.stringify({
        description: "Package description",
        icon: "icon.png",
        packageName: "@alice/autoreview",
        packageVersion: "0.0.1",
        skills: [
          {
            description: "Run code review",
            name: "autoreview",
            title: "Autoreview",
          },
          {
            name: "",
          },
        ],
        visibility: "public",
      }),
    ),
    {
      description: "Package description",
      displayName: "@alice/autoreview",
      icon: "icon.png",
      packageName: "@alice/autoreview",
      packageVersion: "0.0.1",
      skills: [
        {
          description: "Run code review",
          displayName: "Autoreview",
          name: "autoreview",
        },
      ],
      visibility: "public",
    },
  )
})

test("createInstallRegistrySkillArgs installs a selected skill non-interactively", () => {
  assert.deepEqual(createInstallRegistrySkillArgs({ packageName: "@alice/demo", skillId: "demo" }), [
    "skills",
    "install",
    "@alice/demo",
    "--skill",
    "demo",
    "--json",
  ])
  assert.deepEqual(createInstallRegistrySkillArgs({ force: true, packageName: "@alice/demo", skillId: "demo" }), [
    "skills",
    "install",
    "@alice/demo",
    "--skill",
    "demo",
    "--force",
    "--json",
  ])
})

test("createUpdateRegistrySkillArgs updates registry skills as json", () => {
  assert.deepEqual(createUpdateRegistrySkillArgs({}), ["skills", "update", "--json"])
  assert.deepEqual(createUpdateRegistrySkillArgs({ packageName: " @alice/demo ", skillId: " demo " }), [
    "skills",
    "update",
    "@alice/demo",
    "--skill",
    "demo",
    "--json",
  ])
  assert.deepEqual(createUpdateRegistrySkillArgs({ packageName: " @alice/demo " }), [
    "skills",
    "update",
    "@alice/demo",
    "--json",
  ])
  assert.deepEqual(createUpdateRegistrySkillArgs({ skillId: " demo " }), [
    "skills",
    "update",
    "--skill",
    "demo",
    "--json",
  ])
  assert.throws(() => createUpdateRegistrySkillArgs({ skillId: " " }), /skillId is required/)
})

test("createPublishSkillArgs publishes a path non-interactively", () => {
  assert.deepEqual(createPublishSkillArgs({ path: "/tmp/demo", visibility: "public" }), [
    "skills",
    "publish",
    "/tmp/demo",
    "-y",
    "--visibility",
    "public",
  ])
})

test("createAdoptLocalSkillArgs adopts a local skill project for one agent", () => {
  assert.deepEqual(
    createAdoptLocalSkillArgs({
      agent: "claude",
      description: "Validates animation durations.",
      icon: ":lucide:timer:",
      name: "baseline-ui",
      path: "/tmp/baseline-ui",
      title: "Baseline UI",
    }),
    [
      "skills",
      "adopt",
      "/tmp/baseline-ui",
      "--agent",
      "claude",
      "--name",
      "baseline-ui",
      "--description",
      "Validates animation durations.",
      "--icon",
      ":lucide:timer:",
      "--title",
      "Baseline UI",
    ],
  )
  assert.throws(() => createAdoptLocalSkillArgs({ path: " " }), /path is required/)
})

test("createShareSkillArgs shares a selected skill non-interactively", () => {
  assert.deepEqual(createShareSkillArgs({ skillId: "demo" }), ["skills", "share", "demo", "-y"])
})

test("createShareSkillArgs supports sharing a selected local skill source path", () => {
  assert.deepEqual(createShareSkillArgs({ sourcePath: "/Users/demo/.codex/skills/demo", skillId: "demo" }), [
    "skills",
    "share",
    "/Users/demo/.codex/skills/demo",
    "-y",
  ])
})

test("createShareSkillArgs places language before the share command", () => {
  assert.deepEqual(createShareSkillArgs({ language: "zh", skillId: "demo" }), [
    "--lang",
    "zh",
    "skills",
    "share",
    "demo",
    "-y",
  ])
})

test("createShareSkillArgs supports private share limits", () => {
  assert.deepEqual(createShareSkillArgs({ days: 3, downloads: 5, language: "en", skillId: "demo" }), [
    "--lang",
    "en",
    "skills",
    "share",
    "demo",
    "-y",
    "--days",
    "3",
    "--downloads",
    "5",
  ])
})

test("createShareSkillArgs rejects invalid requests", () => {
  assert.throws(() => createShareSkillArgs({ skillId: " " }), /skillId is required/)
  assert.throws(() => createShareSkillArgs({ sourcePath: " ", skillId: "demo" }), /sourcePath is required/)
  assert.throws(() => createShareSkillArgs({ days: 0, skillId: "demo" }), /days must be an integer from 1 to 7/)
  assert.throws(() => createShareSkillArgs({ days: 8, skillId: "demo" }), /days must be an integer from 1 to 7/)
  assert.throws(() => createShareSkillArgs({ days: 1.5, skillId: "demo" }), /days must be an integer from 1 to 7/)
  assert.throws(() => createShareSkillArgs({ downloads: 0, skillId: "demo" }), /downloads must be a positive integer/)
  assert.throws(() => createShareSkillArgs({ downloads: 1.5, skillId: "demo" }), /downloads must be a positive integer/)
})

test("normalizeSkillShareResult extracts install command from prompt", () => {
  assert.deepEqual(
    normalizeSkillShareResult("Share prompt:\n```text\nRun this:\noo skills install @alice/demo --skill demo -y\n```"),
    {
      installCommand: "oo skills install @alice/demo --skill demo",
      prompt: "Run this:\noo skills install @alice/demo --skill demo",
    },
  )
})

test("normalizeSkillShareInfo maps public packages to no share limits", () => {
  assert.deepEqual(normalizeSkillShareInfo(JSON.stringify({ access: "public", packageName: "@alice/demo" })), {
    limitsRequired: false,
    packageName: "@alice/demo",
    visibility: "public",
  })
})

test("normalizeSkillShareInfo maps private and restricted packages to share limits", () => {
  assert.deepEqual(normalizeSkillShareInfo(JSON.stringify({ access: "private", packageName: "@alice/demo" })), {
    limitsRequired: true,
    packageName: "@alice/demo",
    visibility: "private",
  })
  assert.deepEqual(normalizeSkillShareInfo(JSON.stringify({ access: "restricted", packageName: "@alice/demo" })), {
    limitsRequired: true,
    packageName: "@alice/demo",
    visibility: "private",
  })
})

test("normalizeSkillShareInfo treats package info without visibility as public", () => {
  assert.deepEqual(normalizeSkillShareInfo(JSON.stringify({ packageName: "@alice/demo" })), {
    limitsRequired: false,
    packageName: "@alice/demo",
    visibility: "public",
  })
})

test("normalizeRegistryPackageVersionInfo reads package info version fields", () => {
  assert.deepEqual(
    normalizeRegistryPackageVersionInfo(JSON.stringify({ packageName: "@alice/demo", version: "1.2.3" })),
    {
      latestVersion: "1.2.3",
      packageName: "@alice/demo",
    },
  )
  assert.deepEqual(
    normalizeRegistryPackageVersionInfo(JSON.stringify({ packageName: "@alice/demo", packageVersion: "1.2.4" })),
    {
      latestVersion: "1.2.4",
      packageName: "@alice/demo",
    },
  )
  assert.throws(
    () => normalizeRegistryPackageVersionInfo(JSON.stringify({ packageName: "@alice/demo" })),
    /Package info/,
  )
})

test("normalizeSkillShareResult extracts private install command from prompt", () => {
  assert.deepEqual(
    normalizeSkillShareResult("Install with:\noo skills install @alice/demo#share-123 --skill demo -y\n"),
    {
      installCommand: "oo skills install @alice/demo#share-123 --skill demo",
      prompt: "Install with:\noo skills install @alice/demo#share-123 --skill demo",
    },
  )
})

test("createRegistrySkillVersionCheck detects exact package update", () => {
  assert.deepEqual(
    createRegistrySkillVersionCheck(
      {
        id: "demo",
        kind: "registry",
        name: "demo",
        packageName: "@alice/demo",
        version: "1.0.0",
      },
      [
        {
          displayName: "Demo",
          id: "@alice/demo:demo",
          packageName: "@alice/demo",
          skillId: "demo",
          version: "1.1.0",
        },
      ],
    ),
    {
      command: ["skills", "search", "@alice/demo", "--json"],
      currentVersion: "1.0.0",
      id: "demo",
      kind: "registry",
      latestVersion: "1.1.0",
      name: "demo",
      packageName: "@alice/demo",
      skillId: "demo",
      status: "update-available",
    },
  )
})

test("createRegistrySkillVersionCheckFromUpdateResult detects scoped private package updates", () => {
  const executedCommand = ["skills", "check-update", "--json"]

  assert.deepEqual(
    createRegistrySkillVersionCheckFromUpdateResult(
      {
        id: "demo",
        kind: "registry",
        name: "demo",
        packageName: "@alice/demo",
        version: "1.0.0",
      },
      normalizeRegistrySkillCheckUpdateResults(
        JSON.stringify({
          summary: {
            registrySkills: 1,
            registrySkillUpdates: 1,
            registrySkillRepairs: 0,
            registrySkillsCurrent: 0,
            registrySkillFailures: 0,
          },
          skills: [
            {
              currentVersion: "1.0.0",
              latestVersion: "1.1.0",
              packageName: "@alice/demo",
              skillId: "demo",
              status: "update-available",
            },
          ],
        }),
      ),
      executedCommand,
    ),
    {
      command: executedCommand,
      currentVersion: "1.0.0",
      id: "demo",
      kind: "registry",
      latestVersion: "1.1.0",
      name: "demo",
      packageName: "@alice/demo",
      skillId: "demo",
      status: "update-available",
    },
  )
})

test("createRegistrySkillVersionCheckFromUpdateResult maps up-to-date registry skills to current", () => {
  assert.equal(
    createRegistrySkillVersionCheckFromUpdateResult(
      {
        id: "demo",
        kind: "registry",
        name: "demo",
        packageName: "@alice/demo",
        version: "1.1.0",
      },
      [
        {
          currentVersion: "1.1.0",
          latestVersion: "1.1.0",
          packageName: "@alice/demo",
          skillId: "demo",
          status: "up-to-date",
        },
      ],
      ["skills", "check-update", "--json"],
    ).status,
    "current",
  )
})

test("createPublishedSkillVersionCheckFromPackageInfo detects local published package updates", () => {
  const command = createRegistryPackageInfoVersionCheckCommand("@alice/demo")

  assert.deepEqual(
    createPublishedSkillVersionCheckFromPackageInfo(
      {
        id: "demo",
        kind: "local",
        name: "demo",
        packageName: "@alice/demo",
        version: "1.0.0",
      },
      {
        latestVersion: "1.1.0",
        packageName: "@alice/demo",
      },
      command,
    ),
    {
      command,
      currentVersion: "1.0.0",
      id: "demo",
      kind: "local",
      latestVersion: "1.1.0",
      name: "demo",
      packageName: "@alice/demo",
      skillId: "demo",
      status: "update-available",
    },
  )
})

test("createPublishedSkillVersionCheckFromPackageInfo avoids downgrades and unknown versions", () => {
  const command = createRegistryPackageInfoVersionCheckCommand("@alice/demo")

  assert.equal(
    createPublishedSkillVersionCheckFromPackageInfo(
      {
        id: "demo",
        kind: "local",
        name: "demo",
        packageName: "@alice/demo",
        version: "1.2.0",
      },
      {
        latestVersion: "1.1.0",
        packageName: "@alice/demo",
      },
      command,
    ).status,
    "current",
  )
  assert.equal(
    createPublishedSkillVersionCheckFromPackageInfo(
      {
        id: "demo",
        kind: "local",
        name: "demo",
        packageName: "@alice/demo",
      },
      {
        latestVersion: "1.1.0",
        packageName: "@alice/demo",
      },
      command,
    ).status,
    "unknown",
  )
  assert.equal(
    createPublishedSkillVersionCheckFromPackageInfo(
      {
        id: "demo",
        kind: "local",
        name: "demo",
        packageName: "@alice/demo",
        version: "not-a-version",
      },
      {
        latestVersion: "1.1.0",
        packageName: "@alice/demo",
      },
      command,
    ).status,
    "unknown",
  )
  assert.equal(
    createPublishedSkillVersionCheckFromPackageInfo(
      {
        id: "demo",
        kind: "local",
        name: "demo",
        packageName: "@alice/demo",
        version: "1.0.0-alpha..1",
      },
      {
        latestVersion: "1.1.0",
        packageName: "@alice/demo",
      },
      command,
    ).status,
    "unknown",
  )
})

test("createPublishedSkillVersionCheckFromPackageInfo compares prerelease versions", () => {
  const command = createRegistryPackageInfoVersionCheckCommand("@alice/demo")

  assert.equal(
    createPublishedSkillVersionCheckFromPackageInfo(
      {
        id: "demo",
        kind: "local",
        name: "demo",
        packageName: "@alice/demo",
        version: "1.0.0-alpha.1",
      },
      {
        latestVersion: "1.0.0-alpha.2",
        packageName: "@alice/demo",
      },
      command,
    ).status,
    "update-available",
  )
  assert.equal(
    createPublishedSkillVersionCheckFromPackageInfo(
      {
        id: "demo",
        kind: "local",
        name: "demo",
        packageName: "@alice/demo",
        version: "1.0.0-alpha.2",
      },
      {
        latestVersion: "1.0.0-alpha.1",
        packageName: "@alice/demo",
      },
      command,
    ).status,
    "current",
  )
  assert.equal(
    createPublishedSkillVersionCheckFromPackageInfo(
      {
        id: "demo",
        kind: "local",
        name: "demo",
        packageName: "@alice/demo",
        version: "1.0.0",
      },
      {
        latestVersion: "01.0.0",
        packageName: "@alice/demo",
      },
      command,
    ).status,
    "unknown",
  )
})

test("createFailedRegistrySkillVersionCheck records check-update command metadata", () => {
  const executedCommand = ["skills", "check-update", "--json"]

  assert.deepEqual(
    createFailedRegistrySkillVersionCheck(
      {
        id: "demo",
        kind: "registry",
        name: "demo",
        packageName: "@alice/demo",
        version: "1.0.0",
      },
      "Network unavailable.",
      executedCommand,
    ),
    {
      command: executedCommand,
      currentVersion: "1.0.0",
      error: "Network unavailable.",
      id: "demo",
      kind: "registry",
      name: "demo",
      packageName: "@alice/demo",
      skillId: "demo",
      status: "failed",
    },
  )
})

test("createBundledSkillVersionCheck follows cli update availability", () => {
  assert.equal(
    createBundledSkillVersionCheck(
      {
        id: "oo",
        kind: "bundled",
        name: "oo",
        version: "1.0.0",
      },
      {
        command: ["check-update", "--json"],
        currentVersion: "1.0.0",
        latestVersion: "1.1.0",
        status: "update-available",
      },
    ).status,
    "update-available",
  )
})

test("normalizeCliCheckUpdateResult recognizes update notices", () => {
  assert.deepEqual(
    normalizeCliCheckUpdateResult(
      JSON.stringify({
        currentVersion: "1.0.0",
        latestVersion: "1.2.0",
        status: "update-available",
      }),
    ),
    {
      command: ["check-update", "--json"],
      currentVersion: "1.0.0",
      latestVersion: "1.2.0",
      raw: '{"currentVersion":"1.0.0","latestVersion":"1.2.0","status":"update-available"}',
      status: "update-available",
    },
  )
})

test("normalizeCliCheckUpdateResult recognizes current version", () => {
  assert.deepEqual(
    normalizeCliCheckUpdateResult(
      JSON.stringify({
        currentVersion: "1.2.3",
        latestVersion: "1.2.3",
        status: "up-to-date",
      }),
    ),
    {
      command: ["check-update", "--json"],
      currentVersion: "1.2.3",
      latestVersion: "1.2.3",
      raw: '{"currentVersion":"1.2.3","latestVersion":"1.2.3","status":"up-to-date"}',
      status: "up-to-date",
    },
  )
})

test("normalizeCliCheckUpdateResult reports structured failures", () => {
  assert.deepEqual(
    normalizeCliCheckUpdateResult(
      JSON.stringify({
        currentVersion: "development",
        message: "Current CLI version is not a recognized semantic version.",
        status: "failed",
      }),
    ),
    {
      command: ["check-update", "--json"],
      currentVersion: "development",
      error: "Current CLI version is not a recognized semantic version.",
      raw: '{"currentVersion":"development","message":"Current CLI version is not a recognized semantic version.","status":"failed"}',
      status: "failed",
    },
  )
})

test("assertSkillOperationSucceeded accepts completed and noop json results", () => {
  assert.doesNotThrow(() =>
    assertSkillOperationSucceeded(JSON.stringify({ command: "skills.update", status: "completed" }), "skills.update"),
  )
  assert.doesNotThrow(() =>
    assertSkillOperationSucceeded(JSON.stringify({ command: "skills.update", status: "noop" }), "skills.update"),
  )
})

test("assertSkillOperationSucceeded rejects partial failures", () => {
  assert.throws(
    () =>
      assertSkillOperationSucceeded(
        JSON.stringify({
          command: "skills.update",
          errors: [{ message: "Network unavailable." }],
          status: "partial-failure",
        }),
        "skills.update",
      ),
    /Network unavailable/,
  )
})

test("assertSkillOperationSucceeded reports skill entry failures", () => {
  assert.throws(
    () =>
      assertSkillOperationSucceeded(
        JSON.stringify({
          command: "skills.update",
          skills: [
            {
              error: {
                code: "package_not_installed",
                message: "No installed oo-managed skill belongs to the package.",
              },
              skillId: "@alice/demo",
              status: "failed",
            },
          ],
          status: "failed",
        }),
        "skills.update",
      ),
    /No installed oo-managed skill belongs to the package/,
  )
})

test("assertSkillOperationSucceeded reports skill entry failures with code-only errors", () => {
  assert.throws(
    () =>
      assertSkillOperationSucceeded(
        JSON.stringify({
          command: "skills.update",
          skills: [
            {
              error: { code: "package_not_installed" },
              skillId: "@alice/demo",
              status: "failed",
            },
          ],
          status: "failed",
        }),
        "skills.update",
      ),
    /package_not_installed/,
  )
})

test("assertSkillOperationSucceeded reports target entry failures", () => {
  assert.throws(
    () =>
      assertSkillOperationSucceeded(
        JSON.stringify({
          command: "skills.install",
          skills: [
            {
              skillId: "demo",
              status: "failed",
              targets: [
                {
                  error: { code: "name_conflict", message: "Skill name is already used by a non-OOMOL skill." },
                  status: "failed",
                },
              ],
            },
          ],
          status: "failed",
        }),
        "skills.install",
      ),
    /Skill name is already used by a non-OOMOL skill/,
  )
})

test("assertSkillOperationSucceeded rejects unexpected command responses", () => {
  assert.throws(
    () =>
      assertSkillOperationSucceeded(
        JSON.stringify({ command: "skills.install", status: "completed" }),
        "skills.update",
      ),
    /unexpected command/,
  )
})

test("createDeleteSkillArgs blocks built-in skills", () => {
  assert.throws(() => createDeleteSkillArgs({ skillId: "oo" }), /Built-in Skills/)
})

test("createDeleteSkillArgs can target one agent install instance", () => {
  assert.deepEqual(createDeleteSkillArgs({ agentId: "codex", skillId: "demo" }), [
    "skills",
    "uninstall",
    "demo",
    "--json",
    "--agent",
    "codex",
  ])
})
