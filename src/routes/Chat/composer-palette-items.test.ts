import type { ManagedSkillGroup } from "../../../electron/skills/common.ts"
import type { TranslateFn } from "@/i18n/i18n"

import { describe, expect, it } from "vitest"
import { buildSkillPaletteItems, creatorSkillId, slashCommandItems } from "./composer-palette-items.ts"

const translations: Record<string, string> = {
  "chat.commandBilling": "Billing",
  "chat.commandBillingDescription": "View credits and subscription",
  "chat.commandConnections": "Connections",
  "chat.commandConnectionsDescription": "Choose connector context for this turn",
  "chat.commandCreatorSkill": "Creator Skill",
  "chat.commandCreatorSkillDescription": "Create or adopt a reusable skill with ooCLI",
  "chat.commandSkills": "Skills",
  "chat.commandSkillsDescription": "Choose skill context for this turn",
}

const t = ((key: string) => translations[key] ?? key) as TranslateFn

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

    expect(items.map((item) => item.id)).toEqual(["creator-skill", "skills", "connections", "billing"])
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
})
