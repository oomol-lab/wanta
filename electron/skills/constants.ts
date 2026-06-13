export const builtInSkillDefinitions = [
  { id: "oo", icon: ":lucide:sparkles:" },
  { id: "oo-find-skills", icon: ":lucide:search:" },
  { id: "oo-create-skill", icon: ":lucide:wand-sparkles:" },
  { id: "oo-publish-skill", icon: ":lucide:upload-cloud:" },
] as const
export type BuiltInSkillId = (typeof builtInSkillDefinitions)[number]["id"]
export const builtInSkillIds = builtInSkillDefinitions.map((skill) => skill.id)
export const builtInSkillIconById = Object.fromEntries(
  builtInSkillDefinitions.map((skill) => [skill.id, skill.icon]),
) as Record<BuiltInSkillId, string>
export const builtInSkillOrderById = Object.fromEntries(
  builtInSkillDefinitions.map((skill, index) => [skill.id, index]),
) as Record<BuiltInSkillId, number>
export const metadataFileName = ".oo-metadata.json"
export const manifestSchemaVersion = 1

export const skippedDirectoryNames = new Set([
  ".git",
  ".DS_Store",
  "node_modules",
  "__pycache__",
  ".cache",
  "dist",
  "build",
])
