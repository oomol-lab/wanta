export const WANTA_DEFAULT_REASONING_LEVEL = "default"
export const WANTA_REASONING_VARIANT_LEVELS = ["low", "medium", "high", "max"] as const
export const WANTA_REASONING_LEVELS = [WANTA_DEFAULT_REASONING_LEVEL, ...WANTA_REASONING_VARIANT_LEVELS] as const

export type WantaReasoningLevel = (typeof WANTA_REASONING_LEVELS)[number]
export type WantaReasoningVariant = (typeof WANTA_REASONING_VARIANT_LEVELS)[number]

export function opencodeReasoningVariant(level: WantaReasoningLevel | undefined): WantaReasoningVariant | undefined {
  return level && level !== WANTA_DEFAULT_REASONING_LEVEL ? level : undefined
}
