import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { ManagedSkillGroup } from "../../../electron/skills/common.ts"
import type { TranslateFn } from "@/i18n/i18n"

import * as React from "react"
import { describe, expect, it } from "vitest"
import {
  buildConnectionAccountPaletteItems,
  buildConnectionPaletteItems,
  buildContextPaletteItems,
  buildSlashRootPaletteItems,
  buildSkillPaletteItems,
  browserSkillId,
  filterComposerPaletteItems,
  skillPaletteContextMention,
  creatorSkillId,
  slashCommandItems,
} from "./composer-palette-items.ts"

const translations: Record<string, string> = {
  "chat.attachFileAction": "Add file",
  "chat.attachFileOrFolderAction": "Add file or folder",
  "chat.attachFolderAction": "Add folder",
  "chat.commandAttachFile": "Attach file",
  "chat.commandAttachFileDescription": "Add a file from disk as context",
  "chat.commandAttachFileOrFolder": "Attach file or folder",
  "chat.commandAttachFileOrFolderDescription": "Add a file or folder from disk as context",
  "chat.commandAttachFolder": "Attach folder",
  "chat.commandAttachFolderDescription": "Add a folder from disk as context",
  "chat.commandBilling": "Billing",
  "chat.commandBillingDescription": "View credits and subscription",
  "chat.commandBugReport": "Bug report",
  "chat.commandBugReportDescription": "Generate a Markdown report for Wanta developers from this task",
  "chat.commandConnections": "Connections",
  "chat.commandConnectionsDescription": "Choose connector context for this turn",
  "chat.commandBrowserSkill": "Browser",
  "chat.commandBrowserSkillDescription": "Use the visible integrated browser for this request",
  "chat.commandCreatorSkill": "Creator Skill",
  "chat.commandCreatorSkillDescription": "Create or adopt a reusable skill with ooCLI",
  "chat.commandSkills": "Skills",
  "chat.commandSkillsDescription": "Choose skill context for this turn",
  "chat.contextAttachFileDescription": "Choose a file from disk for this turn",
  "chat.contextAttachFileOrFolderDescription": "Choose a file or folder from disk for this turn",
  "chat.contextAttachFolderDescription": "Choose a folder from disk for this turn",
  "chat.contextGeneratedArtifactDescription": "Reference a generated file from this chat",
  "chat.contextGeneratedImageDescription": "Reference a generated image from this chat",
  "chat.connectionAccountCount": "{count} accounts",
  "chat.connectionConnectDescription": "Connect it to use this connector",
  "chat.connectionDefaultAccountDescription": "Default · {account}",
  "chat.connectionUnsupportedDescription": "Connection setup is not supported in Wanta yet",
}

const t = ((key: string) => translations[key] ?? key) as TranslateFn
const browserSkillCopy = {
  description: translations["chat.commandBrowserSkillDescription"] ?? "",
  title: translations["chat.commandBrowserSkill"] ?? "",
}
const creatorSkillCopy = {
  description: translations["chat.commandCreatorSkillDescription"] ?? "",
  title: translations["chat.commandCreatorSkill"] ?? "",
}
const connectionPaletteCopy = {
  accountActiveHint: "Click right arrow to choose",
  accountCount: (count: number) => `${count} accounts`,
  accountFallbackLabel: (auth: string, index: number) => `${auth} connection ${index}`,
  authLabel: (authType: string | null) => (authType === "oauth2" ? "OAuth" : (authType ?? "Unknown auth")),
  connectProvider: t("chat.connectionConnectDescription"),
  defaultAccountDescription: (account: string) => t("chat.connectionDefaultAccountDescription", { account }),
  defaultLabel: "Default",
  needsAttention: "Needs attention",
  unsupportedProvider: t("chat.connectionUnsupportedDescription"),
}
function runtimeSkillGroup(
  id: string,
  kind: ManagedSkillGroup["kind"] = "local",
  icon?: string,
  packageName?: string,
): ManagedSkillGroup {
  return {
    externalHosts: [],
    hosts: [
      {
        agentId: "wanta",
        agentName: "Wanta",
        scope: "runtime",
        status: "installed",
        kind,
      },
    ],
    id,
    ...(icon ? { icon } : {}),
    kind,
    name: id,
    ...(packageName ? { packageName } : {}),
    runtimeHosts: [
      {
        agentId: "wanta",
        agentName: "Wanta",
        scope: "runtime",
        status: "installed",
        kind,
      },
    ],
  }
}

describe("composer palette items", () => {
  it("shows Creator Skill first in slash commands and removes prompt inserts", () => {
    const items = slashCommandItems({ canViewBilling: true, t })

    expect(items.map((item) => item.id)).toEqual([
      "creator-skill",
      "skills",
      "connections",
      "bug-report",
      "attach-file",
      "attach-folder",
      "billing",
    ])
    expect(items.some((item) => ["review", "summarize", "status"].includes(item.id))).toBe(false)
  })

  it("merges file and folder slash commands on macOS", () => {
    const items = slashCommandItems({ canViewBilling: true, platform: "darwin", t })

    expect(items.map((item) => item.id)).toEqual([
      "creator-skill",
      "skills",
      "connections",
      "bug-report",
      "attach-file-or-folder",
      "billing",
    ])
  })

  it("pins built-in skills first and deduplicates inventory entries", () => {
    const items = buildSkillPaletteItems(
      [
        runtimeSkillGroup("zeta"),
        runtimeSkillGroup(browserSkillId),
        runtimeSkillGroup(creatorSkillId),
        runtimeSkillGroup("team-skill"),
      ],
      "Fallback",
      creatorSkillCopy,
      browserSkillCopy,
      [{ id: "team:team-skill", name: "team-skill", packageName: "@acme/skills" }],
    )

    expect(items.map((item) => item.skillId)).toEqual([creatorSkillId, browserSkillId, "team:team-skill", "zeta"])
    expect(items[0]?.title).toBe("Creator Skill")
    expect(items[1]).toMatchObject({
      description: "Use the visible integrated browser for this request",
      iconSource: ":lucide:search:",
      meta: "built-in",
      title: "Browser",
    })
    expect(skillPaletteContextMention(items[1]!)).toMatchObject({
      displayName: "Browser",
      id: "browser",
      kind: "skill",
      name: "browser",
    })
    expect(items[2]?.meta).toBe("team")
  })

  it("hides the explicit browser skill when Browser is disabled", () => {
    const items = buildSkillPaletteItems(
      [runtimeSkillGroup(browserSkillId), runtimeSkillGroup("zeta")],
      "Fallback",
      creatorSkillCopy,
      null,
    )

    expect(items.map((item) => item.skillId)).toEqual([creatorSkillId, "zeta"])
  })

  it("deduplicates team skills against matching runtime inventory skills", () => {
    const items = buildSkillPaletteItems(
      [runtimeSkillGroup("gpt-image-2", "registry", ":simple-icons:openai:", "@openai/gpt-image-2")],
      "Fallback",
      creatorSkillCopy,
      browserSkillCopy,
      [
        {
          description: "Generate images",
          id: "team:@openai/gpt-image-2:gpt-image-2",
          name: "GPT Image 2",
          packageName: "@openai/gpt-image-2",
          skillName: "gpt-image-2",
        },
      ],
    )

    expect(items.map((item) => item.skillId)).toEqual([
      creatorSkillId,
      browserSkillId,
      "team:@openai/gpt-image-2:gpt-image-2",
    ])
    expect(items[2]).toMatchObject({
      meta: "team",
      title: "GPT Image 2",
    })
  })

  it("marks built-in oo skills consistently in the skill palette", () => {
    const items = buildSkillPaletteItems(
      [
        runtimeSkillGroup("oo", "registry"),
        runtimeSkillGroup("oo-find-skills", "registry"),
        runtimeSkillGroup("oo-publish-skill", "registry"),
        runtimeSkillGroup("packaging-copy-proofreader", "local"),
      ],
      "Fallback",
      creatorSkillCopy,
      browserSkillCopy,
    )
    const metaBySkillId = new Map(items.map((item) => [item.skillId, item.meta]))

    expect(metaBySkillId.get(creatorSkillId)).toBe("built-in")
    expect(metaBySkillId.get(browserSkillId)).toBe("built-in")
    expect(metaBySkillId.get("oo")).toBe("built-in")
    expect(metaBySkillId.get("oo-find-skills")).toBe("built-in")
    expect(metaBySkillId.get("oo-publish-skill")).toBe("built-in")
    expect(metaBySkillId.get("packaging-copy-proofreader")).toBe("local")
  })

  it("uses inventory skill icons in the skill palette", () => {
    const items = buildSkillPaletteItems(
      [runtimeSkillGroup("ecommerce-image-studio", "registry", ":lucide:shopping-bag:")],
      "Fallback",
      creatorSkillCopy,
      browserSkillCopy,
    )
    const item = items.find((candidate) => candidate.skillId === "ecommerce-image-studio")
    const icon = item?.icon

    expect(React.isValidElement<{ icon?: string }>(icon)).toBe(true)
    expect(item?.iconSource).toBe(":lucide:shopping-bag:")
    expect(React.isValidElement<{ icon?: string }>(icon) ? icon.props.icon : undefined).toBe(":lucide:shopping-bag:")
  })

  it("surfaces installed skills directly in slash search", () => {
    const slashItems = slashCommandItems({ canViewBilling: true, t })
    const skillItems = buildSkillPaletteItems(
      [
        runtimeSkillGroup(creatorSkillId),
        runtimeSkillGroup("gpt-image-2", "registry", ":simple-icons:openai:"),
        runtimeSkillGroup("ai-elements", "local"),
      ],
      "Fallback",
      creatorSkillCopy,
      browserSkillCopy,
    )
    const rootItems = buildSlashRootPaletteItems({ connectionItems: [], skillItems, slashItems })

    expect(rootItems.some((item) => item.kind === "skill" && item.skillId === "gpt-image-2")).toBe(true)
    expect(rootItems.filter((item) => item.title === "Creator Skill")).toHaveLength(1)
    expect(filterComposerPaletteItems(rootItems, "gpt").map((item) => item.id)).toEqual(["skill:gpt-image-2"])
  })

  it("surfaces connector providers directly in slash search", () => {
    const rootItems = buildSlashRootPaletteItems({
      slashItems: slashCommandItems({ canViewBilling: true, t }),
      skillItems: [],
      connectionItems: buildConnectionPaletteItems(
        [
          {
            actionKind: "oauth2",
            appCount: 1,
            appId: "app-gmail",
            appStatus: "active",
            apps: [
              {
                accountLabel: "work@example.com",
                authType: "oauth2",
                createdAt: 1,
                id: "app-gmail",
                isDefault: true,
                service: "gmail",
                status: "active",
                updatedAt: 1,
              },
            ],
            authTypes: ["oauth2"],
            canDisconnect: true,
            categoryLabels: [],
            displayName: "Gmail",
            service: "gmail",
            status: "connected",
          },
        ],
        (service) => `Use ${service}`,
        connectionPaletteCopy,
      ),
    })

    expect(filterComposerPaletteItems(rootItems, "gmail").map((item) => item.id)).toEqual(["connection-provider:gmail"])
  })

  it("merges file and folder context actions on macOS", () => {
    const items = buildContextPaletteItems({ connectionItems: [], platform: "darwin", t })

    expect(items.map((item) => item.id)).toEqual(["context:attach-file-or-folder"])
    expect(items[0]).toMatchObject({
      action: "attach-file-or-folder",
      meta: "file/folder",
      title: "Add file or folder",
    })
  })

  it("builds account-aware connection palette items", () => {
    const provider: ConnectionProvider = {
      actionKind: "oauth2",
      appCount: 2,
      appId: "app-work",
      appStatus: "active",
      apps: [
        {
          accountLabel: "team@example.com",
          alias: "team",
          authType: "oauth2",
          createdAt: 1,
          id: "app-team",
          isDefault: false,
          service: "gmail",
          status: "active",
          updatedAt: 1,
        },
        {
          accountLabel: "work@example.com",
          authType: "oauth2",
          createdAt: 2,
          id: "app-work",
          isDefault: true,
          service: "gmail",
          status: "active",
          updatedAt: 2,
        },
      ],
      authTypes: ["oauth2"],
      canDisconnect: true,
      categoryLabels: [],
      displayName: "Gmail",
      service: "gmail",
      status: "connected",
    }
    const items = buildConnectionPaletteItems([provider], (service) => `Use ${service}`, connectionPaletteCopy)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      accountCount: 2,
      accountLabel: "work@example.com",
      appId: "app-work",
      canOpenAccounts: true,
      connectionAction: "use",
      description: "Default · {account}",
      id: "connection-provider:gmail",
      meta: undefined,
      secondaryActionActiveLabel: "Click right arrow to choose",
      secondaryActionLabel: "2 accounts",
      secondaryActionTitle: "2 accounts · Click right arrow to choose",
    })

    const accountItems = buildConnectionAccountPaletteItems(provider, connectionPaletteCopy)
    expect(accountItems.map((item) => item.id)).toEqual([
      "connection-account:gmail:app-work",
      "connection-account:gmail:app-team",
    ])
    expect(accountItems[0]).toMatchObject({
      appId: "app-work",
      connectionAction: "use",
      description: "OAuth",
      isDefault: true,
      meta: "Default",
      title: "work@example.com",
    })
    expect(accountItems[1]).toMatchObject({
      appId: "app-team",
      description: "OAuth",
      isDefault: false,
      title: "team",
    })
    expect(accountItems[0]).not.toHaveProperty("secondaryActionLabel")
    expect(accountItems[1]).not.toHaveProperty("secondaryActionLabel")
  })

  it("includes available and attention providers in connection search", () => {
    const providers: ConnectionProvider[] = [
      {
        actionKind: "oauth2",
        appCount: 0,
        apps: [],
        authTypes: ["oauth2"],
        canDisconnect: false,
        categoryLabels: [],
        displayName: "Supabase",
        service: "supabase",
        status: "available",
      },
      {
        actionKind: "oauth2",
        appCount: 1,
        appId: "app-slack",
        appStatus: "reauth_required",
        apps: [
          {
            accountLabel: "team@example.com",
            authType: "oauth2",
            createdAt: 1,
            id: "app-slack",
            isDefault: true,
            service: "slack",
            status: "reauth_required",
            updatedAt: 1,
          },
        ],
        authTypes: ["oauth2"],
        canDisconnect: true,
        categoryLabels: [],
        displayName: "Slack",
        service: "slack",
        status: "needs_attention",
      },
      {
        actionKind: "unavailable",
        appCount: 0,
        apps: [],
        authTypes: [],
        canDisconnect: false,
        categoryLabels: [],
        displayName: "Unsupported",
        service: "unsupported",
        status: "available",
      },
    ]

    const items = buildConnectionPaletteItems(providers, (service) => `Use ${service}`, connectionPaletteCopy)

    expect(items.map((item) => item.id)).toEqual([
      "connection-provider:supabase",
      "connection-provider:slack",
      "connection-provider:unsupported",
    ])
    expect(items[0]).toMatchObject({
      appId: undefined,
      connectionAction: "connect",
      description: "Connect it to use this connector",
      disabled: false,
    })
    expect(items[1]).toMatchObject({
      connectionAction: "attention",
      description: "Needs attention",
      meta: "Needs attention",
    })
    expect(items[2]).toMatchObject({
      connectionAction: "unsupported",
      disabled: true,
    })
  })

  it("uses active connection accounts even when another account needs attention", () => {
    const provider: ConnectionProvider = {
      actionKind: "oauth2",
      appCount: 2,
      appId: "app-active",
      appStatus: "active",
      apps: [
        {
          accountLabel: "active@example.com",
          authType: "oauth2",
          createdAt: 1,
          id: "app-active",
          isDefault: true,
          service: "gmail",
          status: "active",
          updatedAt: 2,
        },
        {
          accountLabel: "stale@example.com",
          authType: "oauth2",
          createdAt: 1,
          id: "app-stale",
          isDefault: false,
          service: "gmail",
          status: "reauth_required",
          updatedAt: 1,
        },
      ],
      authTypes: ["oauth2"],
      canDisconnect: true,
      categoryLabels: [],
      displayName: "Gmail",
      service: "gmail",
      status: "needs_attention",
    }

    const items = buildConnectionPaletteItems([provider], (service) => `Use ${service}`, connectionPaletteCopy)

    expect(items[0]).toMatchObject({
      appId: "app-active",
      connectionAction: "use",
      disabled: false,
      secondaryActionActiveLabel: "Click right arrow to choose",
      secondaryActionLabel: "2 accounts",
      secondaryActionTitle: "2 accounts · Click right arrow to choose",
    })
  })
})
