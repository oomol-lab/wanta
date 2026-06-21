import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { defaultRegistrySkillSetVersion } from "./default-registry-skills.ts"

export const defaultSkillInstallSchemaVersion = 1

export type DefaultSkillInstallStatus = "failed" | "installed" | "removed-by-user" | "skipped"

export interface DefaultSkillInstallRecord {
  installedAt?: string
  lastAttemptAt?: string
  lastError?: string
  packageName: string
  skillId: string
  status: DefaultSkillInstallStatus
  updatedAt: string
}

export interface DefaultSkillInstallStoreData {
  records: DefaultSkillInstallRecord[]
  schemaVersion: typeof defaultSkillInstallSchemaVersion
  skillSetVersion: number
}

export class DefaultSkillInstallStore {
  private readonly file: string

  public constructor(userDataPath: string) {
    this.file = path.join(userDataPath, "skills", "default-install.json")
  }

  public async read(): Promise<DefaultSkillInstallStoreData> {
    return readDefaultSkillInstallStore(this.file)
  }

  public async write(store: DefaultSkillInstallStoreData): Promise<void> {
    await writeDefaultSkillInstallStore(this.file, store)
  }
}

export async function readDefaultSkillInstallStore(file: string): Promise<DefaultSkillInstallStoreData> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<DefaultSkillInstallStoreData>

    if (parsed.schemaVersion !== defaultSkillInstallSchemaVersion || !Array.isArray(parsed.records)) {
      return emptyDefaultSkillInstallStore()
    }

    return {
      records: parsed.records.filter(isDefaultSkillInstallRecord).map((record) => ({ ...record })),
      schemaVersion: defaultSkillInstallSchemaVersion,
      skillSetVersion:
        typeof parsed.skillSetVersion === "number" && Number.isFinite(parsed.skillSetVersion)
          ? parsed.skillSetVersion
          : defaultRegistrySkillSetVersion,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error
    }
    return emptyDefaultSkillInstallStore()
  }
}

export async function writeDefaultSkillInstallStore(file: string, store: DefaultSkillInstallStoreData): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`
  try {
    await writeFile(tmp, `${JSON.stringify(normalizeDefaultSkillInstallStore(store), null, 2)}\n`, "utf8")
    await rename(tmp, file)
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
}

export function emptyDefaultSkillInstallStore(): DefaultSkillInstallStoreData {
  return {
    records: [],
    schemaVersion: defaultSkillInstallSchemaVersion,
    skillSetVersion: defaultRegistrySkillSetVersion,
  }
}

export function createDefaultSkillKey(request: { packageName: string; skillId: string }): string {
  return `${request.packageName.trim()}\u0000${request.skillId.trim()}`
}

export function readDefaultSkillInstallRecord(
  store: DefaultSkillInstallStoreData,
  request: { packageName: string; skillId: string },
): DefaultSkillInstallRecord | undefined {
  const key = createDefaultSkillKey(request)
  return store.records.find((record) => createDefaultSkillKey(record) === key)
}

export function upsertDefaultSkillInstallRecord(
  store: DefaultSkillInstallStoreData,
  record: DefaultSkillInstallRecord,
): DefaultSkillInstallStoreData {
  const records = [...store.records]
  const key = createDefaultSkillKey(record)
  const index = records.findIndex((item) => createDefaultSkillKey(item) === key)

  if (index === -1) {
    records.push(record)
  } else {
    records[index] = record
  }

  return normalizeDefaultSkillInstallStore({
    records,
    schemaVersion: defaultSkillInstallSchemaVersion,
    skillSetVersion: defaultRegistrySkillSetVersion,
  })
}

function normalizeDefaultSkillInstallStore(store: DefaultSkillInstallStoreData): DefaultSkillInstallStoreData {
  return {
    records: store.records
      .filter(isDefaultSkillInstallRecord)
      .map((record) => ({ ...record }))
      .sort((left, right) => createDefaultSkillKey(left).localeCompare(createDefaultSkillKey(right))),
    schemaVersion: defaultSkillInstallSchemaVersion,
    skillSetVersion: defaultRegistrySkillSetVersion,
  }
}

function isDefaultSkillInstallRecord(value: unknown): value is DefaultSkillInstallRecord {
  if (!value || typeof value !== "object") {
    return false
  }

  const record = value as DefaultSkillInstallRecord
  return (
    typeof record.packageName === "string" &&
    record.packageName.trim().length > 0 &&
    typeof record.skillId === "string" &&
    record.skillId.trim().length > 0 &&
    isDefaultSkillInstallStatus(record.status) &&
    typeof record.updatedAt === "string" &&
    (record.installedAt === undefined || typeof record.installedAt === "string") &&
    (record.lastAttemptAt === undefined || typeof record.lastAttemptAt === "string") &&
    (record.lastError === undefined || typeof record.lastError === "string")
  )
}

function isDefaultSkillInstallStatus(value: unknown): value is DefaultSkillInstallStatus {
  return value === "failed" || value === "installed" || value === "removed-by-user" || value === "skipped"
}
