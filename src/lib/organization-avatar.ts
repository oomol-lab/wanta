import type { CSSProperties } from "react"

export interface OrganizationAvatarStyle extends CSSProperties {
  backgroundColor: string
  borderColor: string
  color: string
}

export const organizationAvatarPalette = [
  { backgroundColor: "oklch(0.94 0.045 24)", borderColor: "oklch(0.82 0.075 24)", color: "oklch(0.35 0.11 24)" },
  { backgroundColor: "oklch(0.94 0.045 38)", borderColor: "oklch(0.82 0.075 38)", color: "oklch(0.35 0.11 38)" },
  { backgroundColor: "oklch(0.94 0.046 52)", borderColor: "oklch(0.82 0.076 52)", color: "oklch(0.34 0.105 52)" },
  { backgroundColor: "oklch(0.94 0.047 70)", borderColor: "oklch(0.82 0.076 70)", color: "oklch(0.34 0.095 70)" },
  { backgroundColor: "oklch(0.93 0.05 94)", borderColor: "oklch(0.8 0.078 94)", color: "oklch(0.34 0.085 94)" },
  { backgroundColor: "oklch(0.93 0.05 122)", borderColor: "oklch(0.8 0.078 122)", color: "oklch(0.32 0.09 122)" },
  { backgroundColor: "oklch(0.93 0.047 145)", borderColor: "oklch(0.8 0.075 145)", color: "oklch(0.31 0.09 145)" },
  { backgroundColor: "oklch(0.93 0.045 162)", borderColor: "oklch(0.8 0.074 162)", color: "oklch(0.31 0.085 162)" },
  { backgroundColor: "oklch(0.93 0.044 182)", borderColor: "oklch(0.8 0.072 182)", color: "oklch(0.31 0.08 182)" },
  { backgroundColor: "oklch(0.93 0.043 202)", borderColor: "oklch(0.8 0.07 202)", color: "oklch(0.32 0.08 202)" },
  { backgroundColor: "oklch(0.94 0.043 224)", borderColor: "oklch(0.81 0.07 224)", color: "oklch(0.33 0.09 224)" },
  { backgroundColor: "oklch(0.94 0.043 244)", borderColor: "oklch(0.81 0.07 244)", color: "oklch(0.34 0.1 244)" },
  { backgroundColor: "oklch(0.94 0.044 262)", borderColor: "oklch(0.81 0.072 262)", color: "oklch(0.35 0.11 262)" },
  { backgroundColor: "oklch(0.94 0.044 278)", borderColor: "oklch(0.81 0.072 278)", color: "oklch(0.36 0.11 278)" },
  { backgroundColor: "oklch(0.94 0.044 294)", borderColor: "oklch(0.81 0.072 294)", color: "oklch(0.36 0.11 294)" },
  { backgroundColor: "oklch(0.94 0.045 310)", borderColor: "oklch(0.81 0.074 310)", color: "oklch(0.36 0.11 310)" },
  { backgroundColor: "oklch(0.94 0.045 326)", borderColor: "oklch(0.81 0.074 326)", color: "oklch(0.36 0.11 326)" },
  { backgroundColor: "oklch(0.94 0.045 342)", borderColor: "oklch(0.81 0.074 342)", color: "oklch(0.36 0.11 342)" },
  { backgroundColor: "oklch(0.93 0.026 250)", borderColor: "oklch(0.78 0.04 250)", color: "oklch(0.34 0.055 250)" },
  { backgroundColor: "oklch(0.93 0.025 285)", borderColor: "oklch(0.78 0.04 285)", color: "oklch(0.34 0.055 285)" },
] as const satisfies readonly OrganizationAvatarStyle[]

export function organizationInitials(name: string): string {
  const characters = Array.from(name.trim())
  return characters.slice(0, 2).join("").toLocaleUpperCase() || "OR"
}

export function organizationAvatarStyle(seed: string): OrganizationAvatarStyle {
  return organizationAvatarPalette[stablePaletteIndex(seed)] ?? organizationAvatarPalette[0]
}

function stablePaletteIndex(seed: string): number {
  const normalized = seed.trim().toLocaleLowerCase() || "organization"
  let hash = 2166136261
  for (const character of normalized) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % organizationAvatarPalette.length
}
