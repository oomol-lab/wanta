export interface NativeSkillSourceObservation {
  skillId: string
  source: "native_global"
}

/** Detect native home-directory Skill reads without retaining paths or tool payloads. */
export function nativeSkillSourceObservation(input: unknown): NativeSkillSourceObservation | undefined {
  for (const value of stringValues(input)) {
    const match = value.match(/(?:^|[\\/])\.(?:agents|claude|codex)[\\/]skills[\\/]([^\\/\s"']+)/iu)
    const skillId = match?.[1]?.trim()
    if (skillId && /^[a-z0-9][a-z0-9._-]*$/iu.test(skillId)) {
      return { skillId, source: "native_global" }
    }
  }
  return undefined
}

function stringValues(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(stringValues)
  if (!value || typeof value !== "object") return []
  return Object.values(value as Record<string, unknown>).flatMap(stringValues)
}
