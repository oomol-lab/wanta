import type { AuthorizationInfo } from "../../../electron/chat/common.ts"
import type { ConnectionProvider } from "../../../electron/connections/common.ts"

import { isConnectionlessNoAuthProvider } from "../../../electron/connections/summary.ts"
import { renderBlocks } from "./render-blocks.ts"
import { normalizeServiceSlug } from "./tool-display.ts"

export type AssistantBlockType = ReturnType<typeof renderBlocks>[number]

export function shouldRenderConnectionSuggestion(
  authorization: AuthorizationInfo | undefined,
  providerByService: Map<string, ConnectionProvider>,
): AuthorizationInfo | undefined {
  if (!authorization) return undefined
  const provider = providerByService.get(normalizeServiceSlug(authorization.service))
  if (!provider) return authorization
  return provider.status === "connected" || isConnectionlessNoAuthProvider(provider) ? undefined : authorization
}

export function assistantBlockClassName(blocks: AssistantBlockType[], index: number): string | undefined {
  if (index === 0) return undefined
  const previous = blocks[index - 1]
  const current = blocks[index]
  if (!previous || !current) return undefined
  if (previous.kind === "tools" && current.kind === "tools") return "mt-1"
  if (previous.kind !== current.kind) return "mt-3"
  return "mt-2"
}
