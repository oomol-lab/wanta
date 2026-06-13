import type { SkillControlState } from "./common.ts"
import type { InstalledSkill, SkillManifestRecord, SkillManifestStore } from "./types.ts"

import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { manifestSchemaVersion } from "./constants.ts"

export async function readManifestStore(manifestPath: string): Promise<SkillManifestStore> {
  try {
    const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as Partial<SkillManifestStore>

    if (parsed.schemaVersion !== manifestSchemaVersion || !Array.isArray(parsed.records)) {
      return {
        schemaVersion: manifestSchemaVersion,
        records: [],
      }
    }

    return {
      schemaVersion: manifestSchemaVersion,
      records: parsed.records.filter((record): record is SkillManifestRecord => {
        return (
          typeof record === "object" &&
          record !== null &&
          typeof record.agentId === "string" &&
          typeof record.hash === "string" &&
          typeof record.installedPath === "string" &&
          typeof record.scannedAt === "string" &&
          typeof record.skillName === "string" &&
          typeof record.sourcePath === "string"
        )
      }),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error
    }
    return {
      schemaVersion: manifestSchemaVersion,
      records: [],
    }
  }
}

export async function writeManifestStore(manifestPath: string, store: SkillManifestStore): Promise<void> {
  await mkdir(path.dirname(manifestPath), { recursive: true })
  const tmp = `${manifestPath}.tmp-${process.pid}-${randomUUID()}`
  try {
    await writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, "utf8")
    await rename(tmp, manifestPath)
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
}

export function areManifestStoresEqual(left: SkillManifestStore, right: SkillManifestStore): boolean {
  return JSON.stringify(normalizeManifestStore(left)) === JSON.stringify(normalizeManifestStore(right))
}

export function createManifestRecord(skill: InstalledSkill): SkillManifestRecord {
  return {
    agentId: skill.agent.id,
    hash: skill.hash,
    installedPath: skill.path,
    packageName: skill.metadata.packageName,
    scannedAt: new Date().toISOString(),
    skillName: skill.name,
    sourcePath: skill.sourcePath,
    version: skill.metadata.version,
  }
}

function normalizeManifestStore(store: SkillManifestStore): SkillManifestStore {
  return {
    schemaVersion: store.schemaVersion,
    records: store.records.map(normalizeManifestRecord).sort((left, right) => {
      return `${left.agentId}:${left.installedPath}`.localeCompare(`${right.agentId}:${right.installedPath}`)
    }),
  }
}

function normalizeManifestRecord(record: SkillManifestRecord): SkillManifestRecord {
  return {
    agentId: record.agentId,
    hash: record.hash,
    installedPath: record.installedPath,
    packageName: record.packageName,
    scannedAt: "",
    skillName: record.skillName,
    sourcePath: record.sourcePath,
    version: record.version,
  }
}

export function upsertManifestRecords(
  store: SkillManifestStore,
  installedSkills: InstalledSkill[],
): SkillManifestStore {
  const activeRecordKeys = new Set(installedSkills.map((skill) => `${skill.agent.id}:${skill.path}`))
  const records = store.records.filter((record) => activeRecordKeys.has(`${record.agentId}:${record.installedPath}`))

  for (const skill of installedSkills) {
    const existingIndex = records.findIndex(
      (record) => record.agentId === skill.agent.id && record.installedPath === skill.path,
    )

    if (existingIndex === -1) {
      records.push(createManifestRecord(skill))
    }
  }

  return {
    schemaVersion: manifestSchemaVersion,
    records,
  }
}

export function replaceManifestRecords(
  store: SkillManifestStore,
  installedSkills: InstalledSkill[],
): SkillManifestStore {
  const records = [...store.records]

  for (const skill of installedSkills) {
    const nextRecord = createManifestRecord(skill)
    const existingIndex = records.findIndex(
      (record) => record.agentId === skill.agent.id && record.installedPath === skill.path,
    )

    if (existingIndex === -1) {
      records.push(nextRecord)
      continue
    }

    records[existingIndex] = nextRecord
  }

  return {
    schemaVersion: manifestSchemaVersion,
    records,
  }
}

function readManifestRecord(store: SkillManifestStore, skill: InstalledSkill): SkillManifestRecord | undefined {
  return store.records.find((record) => record.agentId === skill.agent.id && record.installedPath === skill.path)
}

export function readControlState(skill: InstalledSkill, manifestStore: SkillManifestStore): SkillControlState {
  if (skill.sourceHash) {
    return skill.hash === skill.sourceHash ? "controlled" : "modified"
  }

  const manifestRecord = readManifestRecord(manifestStore, skill)

  if (!manifestRecord) {
    return "unknown"
  }

  if (manifestRecord.sourcePath !== skill.sourcePath) {
    return "source-missing"
  }

  return manifestRecord.hash === skill.hash ? "controlled" : "modified"
}
