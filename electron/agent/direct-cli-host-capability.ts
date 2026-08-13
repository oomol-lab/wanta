import type { HostCapability } from "./host-capability.ts"
import type { SkillRegistrySnapshot } from "./skill-registry.ts"

import { z } from "zod"
import { hostCapabilityBinding } from "./host-capability.ts"
import { SKILL_SNAPSHOT_BINDING } from "./skill-host-capability.ts"

export const DIRECT_CLI_CAPABILITY_ID = "direct_cli"

export type DirectCliProvider = "dingtalk" | "lark" | "wecom"

export interface DirectCliExecutor {
  connected(): Promise<DirectCliProvider[]>
  execute(provider: DirectCliProvider, args: string[]): Promise<{ stderr: string; stdout: string }>
}

const forbiddenCommands = new Set(["auth", "completion", "config", "init", "login", "logout", "update", "upgrade"])
const directArgsSchema = z
  .array(
    z
      .string()
      .min(1)
      .max(64 * 1024),
  )
  .min(1)
  .max(100)
  .refine((args) => args.reduce((total, value) => total + Buffer.byteLength(value), 0) <= 256 * 1024, {
    message: "Direct-provider arguments exceed the 256 KiB safety limit.",
  })
  .refine((args) => !args.some(hasControlLineCharacter), {
    message: "Direct-provider arguments cannot contain control-line characters.",
  })
  .refine((args) => !forbiddenCommands.has(args[0]?.trim().toLowerCase() ?? ""), {
    message: "Direct-provider administration is host-only.",
  })

function hasControlLineCharacter(value: string): boolean {
  return value.includes("\n") || value.includes("\r") || value.includes(String.fromCharCode(0))
}

export function createDirectCliHostCapability(executor: DirectCliExecutor): HostCapability {
  return {
    id: DIRECT_CLI_CAPABILITY_ID,
    version: "1.0.0",
    instructions:
      "Direct provider commands use Wanta-owned isolated identities. Load the matching provider skill before execution. Authentication, configuration, logout, and runtime administration are host-only.",
    tools: [
      {
        name: "list_direct_providers",
        description: "List the direct Lark, WeCom, or DingTalk identities currently connected in Wanta.",
        inputSchema: z.object({}),
        execute: async () => ({ text: JSON.stringify({ providers: await executor.connected() }) }),
      },
      {
        name: "call_direct_provider",
        description:
          "Run one business command using a connected Wanta direct-provider identity. Pass the exact current-turn skillId you loaded and build argv exactly as that Skill documents. The host verifies the Skill belongs to the selected provider; administrative commands are rejected.",
        inputSchema: z.object({
          provider: z.enum(["lark", "wecom", "dingtalk"]),
          skillId: z.string().min(1),
          args: directArgsSchema,
        }),
        execute: async (context, input) => {
          const provider = input.provider as DirectCliProvider
          const skillId = input.skillId as string
          const snapshot = hostCapabilityBinding<SkillRegistrySnapshot>(context, SKILL_SNAPSHOT_BINDING)
          const skill = snapshot?.entries.get(skillId)
          if (!skill || skill.source.id !== `direct-${provider}`) {
            throw new Error(`skillId must identify an active ${provider} Skill from the current-turn snapshot.`)
          }
          const result = await executor.execute(provider, input.args as string[])
          return { text: JSON.stringify(result) }
        },
      },
    ],
  }
}
