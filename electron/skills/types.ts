import type { SupportedAgent } from "../agents/catalog.ts"
import type { ManagedSkillKind } from "./common.ts"
import type { manifestSchemaVersion } from "./constants.ts"

export interface ManagedSkillMetadata {
  description?: string
  icon?: string
  kind?: ManagedSkillKind
  packageName?: string
  version?: string
}

export interface InstalledSkill {
  agent: SupportedAgent
  hash: string
  metadata: ManagedSkillMetadata
  name: string
  path: string
  sourceHash?: string
  sourcePath: string
}

export interface SkillManifestRecord {
  agentId: string
  hash: string
  installedPath: string
  packageName?: string
  scannedAt: string
  skillName: string
  sourcePath: string
  version?: string
}

export interface SkillManifestStore {
  records: SkillManifestRecord[]
  schemaVersion: typeof manifestSchemaVersion
}
