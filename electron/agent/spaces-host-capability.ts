import type { HostCapability } from "./host-capability.ts"

import { z } from "zod"
import { SpacesService, SPACES_INSTRUCTIONS } from "./spaces-service.ts"

export const SPACES_CAPABILITY_ID = "spaces"
const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/)
export const spacesReadSchema = z
  .object({
    operation: z.enum(["list", "get", "deploys", "job", "usage"]),
    space: identifier.optional(),
    jobId: identifier.optional(),
    cursor: z.string().max(2000).optional(),
  })
  .strict()
export const spacesCreateSchema = z
  .object({
    project: z.string().min(1).max(4096),
    slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/),
    name: z.string().trim().min(1).max(100),
    requirement: z.enum(["shared_persistent_data", "server_functions_and_database"]),
    reason: z.string().trim().min(20).max(2000),
  })
  .strict()
export const spacesDeploySchema = z
  .object({
    space: identifier,
    project: z.string().min(1).max(4096),
    reason: z.string().trim().min(10).max(2000),
  })
  .strict()

export function createSpacesHostCapability(service: SpacesService): HostCapability {
  return {
    id: SPACES_CAPABILITY_ID,
    version: "1.0.0",
    instructions: SPACES_INSTRUCTIONS,
    tools: [
      {
        name: "spaces_read",
        description:
          "Read Spaces in the current Wanta team. Only for explicit Spaces management or a confirmed full-stack website workflow. Poll deployment job status; queued is not success.",
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
        inputSchema: spacesReadSchema,
        execute: async (context, input, signal) => ({
          text: JSON.stringify(await service.read(context, spacesReadSchema.parse(input), signal)),
        }),
      },
      {
        name: "spaces_create",
        description:
          "Propose one paid Convex-backed website. Requires a prepared full-stack project and a concrete reason why static hosting is insufficient. Wanta displays authoritative billing and waits for user confirmation before creating. Never use for static websites or existing backends. No model-supplied approval or price is accepted.",
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        inputSchema: spacesCreateSchema,
        execute: async (context, input, signal) => ({
          text: JSON.stringify(await service.create(context, spacesCreateSchema.parse(input), signal)),
        }),
      },
      {
        name: "spaces_deploy",
        description:
          "Deploy the prepared Convex backend and dist frontend to an existing Space. Wanta confirms the exact target, or uses its scoped first-deploy confirmation. Returns a job to poll. Backend changes may remain live after a frontend failure. Never resume a suspended Space automatically.",
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
        inputSchema: spacesDeploySchema,
        execute: async (context, input, signal) => ({
          text: JSON.stringify(await service.deploy(context, spacesDeploySchema.parse(input), signal)),
        }),
      },
    ],
  }
}
