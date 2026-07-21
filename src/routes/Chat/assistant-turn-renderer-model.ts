import { renderBlocks } from "./render-blocks.ts"

export type AssistantBlockType = ReturnType<typeof renderBlocks>[number]

export function assistantBlockClassName(blocks: AssistantBlockType[], index: number): string | undefined {
  if (index === 0) return undefined
  const previous = blocks[index - 1]
  const current = blocks[index]
  if (!previous || !current) return undefined
  if (previous.kind === "tools" && current.kind === "tools") return "mt-1"
  if (previous.kind !== current.kind) return "mt-3"
  return "mt-2"
}
