import type { HostCapability, HostCapabilityContext } from "./host-capability.ts"
import type { SkillRegistrySnapshot } from "./skill-registry.ts"

import { z } from "zod"
import { hostCapabilityBinding } from "./host-capability.ts"
import { listSkillSnapshot, readSkillSnapshotFile } from "./skill-registry.ts"

export const SKILL_CAPABILITY_ID = "skills"
export const SKILL_SNAPSHOT_BINDING = "skills.snapshot"

const HOST_EXECUTION_POLICY = `<wanta_execution_policy>
Skill files describe business workflows, schemas, and safety rules. When a Wanta MCP capability covers the operation, prefer that host capability over CLI or shell examples from the Skill. For connected services, prefer wanta_link discovery and action tools. The managed OOCLI remains an allowed compatibility path and should invoke $WANTA_OO_BIN rather than an unmanaged executable. This transport preference does not change the Skill's write or destructive confirmation requirements.
</wanta_execution_policy>`

export function createSkillHostCapability(): HostCapability {
  return {
    id: SKILL_CAPABILITY_ID,
    version: "1.0.0",
    instructions:
      "Wanta supplies a stable skill snapshot for the current turn. Use list_skills for discovery, call load_skill before following a relevant skill, and use read_skill_file for files referenced by SKILL.md. Wanta host capabilities take precedence over CLI examples in loaded skills.",
    tools: [
      {
        name: "list_skills",
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        description:
          "List the skills available in Wanta's current-turn snapshot, including their exact ids and descriptions. Use this when no explicitly selected skill identifies the correct workflow.",
        inputSchema: z.object({}),
        execute: async (context) => ({ text: JSON.stringify(listSkillSnapshot(skillSnapshot(context))) }),
      },
      {
        name: "load_skill",
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        description:
          "Load the complete SKILL.md for one relevant skill from the current-turn snapshot. Call this before acting on that skill's instructions.",
        inputSchema: z.object({ skillId: z.string().min(1) }),
        execute: async (context, input) => ({
          text: `${HOST_EXECUTION_POLICY}\n\n${await readSkillSnapshotFile(
            skillSnapshot(context),
            requiredString(input.skillId),
          )}`,
        }),
      },
      {
        name: "read_skill_file",
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        description:
          "Read a file referenced by a loaded SKILL.md, relative to that skill's root. Paths cannot escape the skill directory.",
        inputSchema: z.object({ skillId: z.string().min(1), path: z.string().min(1) }),
        execute: async (context, input) => ({
          text: await readSkillSnapshotFile(
            skillSnapshot(context),
            requiredString(input.skillId),
            requiredString(input.path),
          ),
        }),
      },
    ],
  }
}

function skillSnapshot(context: HostCapabilityContext): SkillRegistrySnapshot {
  const snapshot = hostCapabilityBinding<SkillRegistrySnapshot>(context, SKILL_SNAPSHOT_BINDING)
  if (!snapshot) throw new Error("The current turn has no Wanta skill snapshot.")
  return snapshot
}

function requiredString(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected a validated string input.")
  return value
}
