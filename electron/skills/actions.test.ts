import assert from "node:assert/strict"
import { test } from "vitest"
import {
  assertSkillOperationSucceeded,
  createCliCheckUpdateArgs,
  createCliUpdateArgs,
  createDeleteSkillArgs,
  createFailedRegistrySkillVersionCheck,
  createInstallRegistrySkillArgs,
  createPublishSkillArgs,
  createRegistrySkillVersionCheck,
  createRegistrySkillCheckUpdateArgs,
  createRegistrySkillVersionCheckFromUpdateResult,
  createSkillPublishErrorMessage,
  normalizePublicSkillPackageCatalog,
  normalizeRegistrySkillPackageInfo,
  createSkillSearchArgs,
  normalizeRegistrySkillCheckUpdateResults,
  normalizeSkillSearchResults,
  normalizeCliCheckUpdateResult,
  createUpdateRegistrySkillArgs,
  readSkillPublishRequiredScope,
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

test("normalizePublicSkillPackageCatalog keeps package metadata without skill details", () => {
  assert.deepEqual(
    normalizePublicSkillPackageCatalog(
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
        ],
        next: "next-page",
      }),
      "2026-06-18T00:00:00.000Z",
    ),
    {
      items: [
        {
          description: "Review code",
          displayName: "Autoreview",
          downloadCount: undefined,
          icon: "icon.png",
          id: "@alice/autoreview@0.0.1",
          isTemplate: false,
          maintainers: [],
          name: "@alice/autoreview",
          skills: [],
          updateTime: 1770000000000,
          version: "0.0.1",
          visibility: "private",
        },
      ],
      next: "next-page",
      updatedAt: "2026-06-18T00:00:00.000Z",
    },
  )
})

test("normalizePublicSkillPackageCatalog ignores malformed maintainer metadata", () => {
  const catalog = normalizePublicSkillPackageCatalog(
    JSON.stringify({
      data: [
        {
          extra: {
            maintainers: "[",
          },
          name: "@alice/broken-maintainers",
          version: "0.0.1",
          visibility: "public",
        },
      ],
    }),
    "2026-06-18T00:00:00.000Z",
  )

  assert.equal(catalog.items.length, 1)
  assert.deepEqual(catalog.items[0]?.maintainers, [])
})

test("normalizePublicSkillPackageCatalog keeps unknown visibility non-fatal", () => {
  const catalog = normalizePublicSkillPackageCatalog(
    JSON.stringify({
      data: [
        {
          name: "@alice/unknown-visibility",
          version: "0.0.1",
          visibility: "team",
        },
      ],
    }),
    "2026-06-18T00:00:00.000Z",
  )

  assert.equal(catalog.items.length, 1)
  assert.equal(catalog.items[0]?.visibility, "unknown")
})

test("normalizeRegistrySkillPackageInfo maps package-info into discover package metadata", () => {
  assert.deepEqual(
    normalizeRegistrySkillPackageInfo(
      JSON.stringify({
        description: "Private package",
        icon: ":lucide:box",
        isPrivate: true,
        packageName: "@alice/private-skill",
        packageVersion: "0.2.0",
        skills: [
          {
            description: "Do private work",
            name: "private-skill",
            title: "Private Skill",
          },
        ],
        title: "Private Package",
      }),
      { id: "user-1", name: "alice", url: "https://example.com/a.png" },
    ),
    {
      description: "Private package",
      displayName: "Private Package",
      icon: ":lucide:box",
      id: "@alice/private-skill@0.2.0",
      isTemplate: false,
      maintainers: [{ id: "user-1", name: "alice", url: "https://example.com/a.png" }],
      name: "@alice/private-skill",
      skills: [
        {
          description: "Do private work",
          name: "private-skill",
          title: "Private Skill",
        },
      ],
      version: "0.2.0",
      visibility: "private",
    },
  )
})

test("normalizeRegistrySkillPackageInfo recognizes package access visibility", () => {
  assert.equal(
    normalizeRegistrySkillPackageInfo(
      JSON.stringify({
        access: "restricted",
        packageName: "@alice/restricted-skill",
        packageVersion: "0.2.0",
        skills: [
          {
            name: "restricted-skill",
            title: "Restricted Skill",
          },
        ],
      }),
      { id: "user-1", name: "alice" },
    )?.visibility,
    "private",
  )
})

test("normalizeRegistrySkillPackageInfo ignores packages without skills", () => {
  assert.equal(
    normalizeRegistrySkillPackageInfo(
      JSON.stringify({
        packageName: "@alice/block-only",
        packageVersion: "0.1.0",
        skills: [],
      }),
      { id: "user-1", name: "alice" },
    ),
    undefined,
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

test("createPublishSkillArgs publishes a Skill path non-interactively", () => {
  assert.deepEqual(createPublishSkillArgs({ path: "/tmp/demo" }), [
    "skills",
    "publish",
    "/tmp/demo",
    "-y",
    "--visibility",
    "private",
  ])
  assert.deepEqual(createPublishSkillArgs({ path: "/tmp/demo", visibility: "public" }), [
    "skills",
    "publish",
    "/tmp/demo",
    "-y",
    "--visibility",
    "public",
  ])
})

test("createSkillPublishErrorMessage prefers publish stderr details", () => {
  assert.equal(
    createSkillPublishErrorMessage({
      message: "Command failed",
      stderr: "Package version already exists.",
      stdout: "ignored",
    }),
    "Package version already exists.",
  )
})

test("readSkillPublishRequiredScope parses registry scope mismatch errors", () => {
  assert.equal(
    readSkillPublishRequiredScope({
      stderr:
        'The skill package publish request returned HTTP 422: {"error":"[UNPROCESSABLE_ENTITY] For create package, scope \\"@shaun\\" must equal to \\"@alwaysmavs\\", user: \\"u1\\""}',
    }),
    "@alwaysmavs",
  )
  assert.equal(readSkillPublishRequiredScope({ stderr: "Package version already exists." }), undefined)
})

test("createSkillPublishErrorMessage extracts json failure messages", () => {
  assert.equal(
    createSkillPublishErrorMessage({
      stderr: JSON.stringify({ error: { message: "Package name is invalid." } }),
      stdout: "",
    }),
    "Package name is invalid.",
  )
  assert.equal(
    createSkillPublishErrorMessage({
      stderr: "",
      stdout: JSON.stringify({ errors: [{ message: "Missing SKILL.md." }] }),
    }),
    "Missing SKILL.md.",
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

test("createDeleteSkillArgs uninstalls a Skill from Wanta", () => {
  assert.deepEqual(createDeleteSkillArgs({ skillId: "demo" }), ["skills", "uninstall", "demo", "--json"])
})
