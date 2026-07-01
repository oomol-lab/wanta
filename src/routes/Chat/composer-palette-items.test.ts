import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { ManagedSkillGroup } from "../../../electron/skills/common.ts"
import type { TranslateFn } from "@/i18n/i18n"

import { describe, expect, it } from "vitest"
import {
  buildArtifactPaletteItems,
  buildConnectionAccountPaletteItems,
  buildConnectionPaletteItems,
  buildContextPaletteItems,
  buildSkillPaletteItems,
  creatorSkillId,
  slashCommandItems,
} from "./composer-palette-items.ts"

const translations: Record<string, string> = {
  "chat.attachFileAction": "Add file",
  "chat.attachFolderAction": "Add folder",
  "chat.commandAttachFile": "Attach file",
  "chat.commandAttachFileDescription": "Add a file from disk as context",
  "chat.commandAttachFolder": "Attach folder",
  "chat.commandAttachFolderDescription": "Add a folder from disk as context",
  "chat.commandBilling": "Billing",
  "chat.commandBillingDescription": "View credits and subscription",
  "chat.commandConnections": "Connections",
  "chat.commandConnectionsDescription": "Choose connector context for this turn",
  "chat.commandCreatorSkill": "Creator Skill",
  "chat.commandCreatorSkillDescription": "Create or adopt a reusable skill with ooCLI",
  "chat.commandSkills": "Skills",
  "chat.commandSkillsDescription": "Choose skill context for this turn",
  "chat.contextAttachFileDescription": "Choose a file from disk for this turn",
  "chat.contextAttachFolderDescription": "Choose a folder from disk for this turn",
  "chat.contextGeneratedArtifactDescription": "Reference a generated file from this chat",
  "chat.contextGeneratedImageDescription": "Reference a generated image from this chat",
  "chat.connectionAccountCount": "{count} accounts ›",
  "chat.connectionConnectDescription": "Connect it to use this connector",
  "chat.connectionDefaultAccountDescription": "Default · {account}",
  "chat.connectionSetDefaultAndUse": "Set default and use",
  "chat.connectionUnsupportedDescription": "Connection setup is not supported in Wanta yet",
  "chat.connectionUseForThisTurn": "Use for this turn",
}

const t = ((key: string) => translations[key] ?? key) as TranslateFn
const connectionPaletteCopy = {
  accountCount: (count: number) => `${count} accounts ›`,
  connectProvider: t("chat.connectionConnectDescription"),
  defaultAccountDescription: (account: string) => t("chat.connectionDefaultAccountDescription", { account }),
  defaultLabel: "Default",
  needsAttention: "Needs attention",
  setDefaultAndUse: t("chat.connectionSetDefaultAndUse"),
  unsupportedProvider: t("chat.connectionUnsupportedDescription"),
  useForThisTurn: t("chat.connectionUseForThisTurn"),
}

function runtimeSkillGroup(id: string): ManagedSkillGroup {
  return {
    externalHosts: [],
    hosts: [
      {
        agentId: "wanta",
        agentName: "Wanta",
        scope: "runtime",
        status: "installed",
      },
    ],
    id,
    kind: "local",
    name: id,
    runtimeHosts: [
      {
        agentId: "wanta",
        agentName: "Wanta",
        scope: "runtime",
        status: "installed",
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
      "attach-file",
      "attach-folder",
      "billing",
    ])
    expect(items.some((item) => ["review", "summarize", "status"].includes(item.id))).toBe(false)
  })

  it("pins Creator Skill first in skill items and deduplicates inventory entries", () => {
    const items = buildSkillPaletteItems(
      [runtimeSkillGroup("zeta"), runtimeSkillGroup(creatorSkillId), runtimeSkillGroup("org-skill")],
      "Fallback",
      {
        description: translations["chat.commandCreatorSkillDescription"] ?? "",
        title: translations["chat.commandCreatorSkill"] ?? "",
      },
      [{ id: "organization:org-skill", name: "org-skill", packageName: "@acme/skills" }],
    )

    expect(items.map((item) => item.skillId)).toEqual([creatorSkillId, "organization:org-skill", "zeta"])
    expect(items[0]?.title).toBe("Creator Skill")
    expect(items[1]?.meta).toBe("organization")
  })

  it("builds context items from attachments and connected providers", () => {
    const artifacts = buildArtifactPaletteItems(
      {
        group: {
          items: [
            {
              kind: "file",
              mime: "text/markdown",
              name: "notes.md",
              path: "/tmp/artifacts/notes.md",
              size: 12,
            },
            {
              kind: "file",
              mime: "image/png",
              name: "corgi.png",
              path: "/tmp/artifacts/corgi.png",
              size: 42,
            },
          ],
          totalItems: 2,
          truncated: false,
        },
        messageId: "assistant-1",
        selectedPath: "/tmp/artifacts/corgi.png",
      },
      t,
    )
    const connections = buildConnectionPaletteItems(
      [
        {
          actionKind: "oauth2",
          appCount: 1,
          appId: "app-1",
          appStatus: "active",
          apps: [
            {
              accountLabel: "work@example.com",
              authType: "oauth2",
              createdAt: 1,
              id: "app-1",
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
        {
          actionKind: "oauth2",
          appCount: 0,
          apps: [],
          authTypes: ["oauth2"],
          canDisconnect: false,
          categoryLabels: [],
          displayName: "Slack",
          service: "slack",
          status: "available",
        },
      ],
      (service) => `Use ${service}`,
      connectionPaletteCopy,
    )
    const items = buildContextPaletteItems({ artifactItems: artifacts, connectionItems: connections, t })

    expect(items.map((item) => item.id)).toEqual([
      "context:attach-file",
      "context:attach-folder",
      "artifact:/tmp/artifacts/corgi.png",
      "artifact:/tmp/artifacts/notes.md",
      "connection-provider:gmail",
      "connection-provider:slack",
    ])
  })

  it("builds account-aware connection palette items", () => {
    const provider: ConnectionProvider = {
      actionKind: "oauth2",
      appCount: 2,
      appId: "app-work",
      appStatus: "active",
      apps: [
        {
          accountLabel: "personal@example.com",
          authType: "oauth2",
          createdAt: 1,
          id: "app-personal",
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
      id: "connection-provider:gmail",
      secondaryActionLabel: "2 accounts ›",
    })

    const accountItems = buildConnectionAccountPaletteItems(provider, connectionPaletteCopy)
    expect(accountItems.map((item) => item.id)).toEqual([
      "connection-account:gmail:app-work",
      "connection-account:gmail:app-personal",
    ])
    expect(accountItems[0]).toMatchObject({
      appId: "app-work",
      connectionAction: "use",
      isDefault: true,
      meta: "Default",
      secondaryActionLabel: undefined,
    })
    expect(accountItems[1]).toMatchObject({
      appId: "app-personal",
      isDefault: false,
      secondaryActionLabel: "Set default and use",
    })
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
      secondaryActionLabel: "2 accounts ›",
    })
  })
})
