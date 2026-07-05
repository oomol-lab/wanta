import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

export const removedSkillStoreSchemaVersion = 1

export interface RemovedSkillRecord {
  packageName?: string
  removedAt: string
  scope: "local-machine"
  skillId: string
}

export interface RemovedSkillStoreData {
  records: RemovedSkillRecord[]
  schemaVersion: typeof removedSkillStoreSchemaVersion
}

export class RemovedSkillStore {
  private readonly file: string
  private operationQueue: Promise<unknown> = Promise.resolve()

  public constructor(userDataPath: string) {
    this.file = path.join(userDataPath, "skills", "removed.json")
  }

  public async read(): Promise<RemovedSkillStoreData> {
    return this.enqueue(() => readRemovedSkillStore(this.file))
  }

  public async write(store: RemovedSkillStoreData): Promise<void> {
    await this.enqueue(() => writeRemovedSkillStore(this.file, store))
  }

  public async update(updater: (store: RemovedSkillStoreData) => RemovedSkillStoreData): Promise<void> {
    await this.enqueue(async () => {
      await writeRemovedSkillStore(this.file, updater(await readRemovedSkillStore(this.file)))
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationQueue.then(operation, operation)
    this.operationQueue = next.catch(() => undefined)
    return next
  }
}

export async function readRemovedSkillStore(file: string): Promise<RemovedSkillStoreData> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<RemovedSkillStoreData>

    if (parsed.schemaVersion !== removedSkillStoreSchemaVersion || !Array.isArray(parsed.records)) {
      return emptyRemovedSkillStore()
    }

    return normalizeRemovedSkillStore({
      records: parsed.records.filter(isRemovedSkillRecord).map((record) => ({ ...record })),
      schemaVersion: removedSkillStoreSchemaVersion,
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) {
      return emptyRemovedSkillStore()
    }
    throw error
  }
}

export async function writeRemovedSkillStore(file: string, store: RemovedSkillStoreData): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`
  try {
    await writeFile(tmp, `${JSON.stringify(normalizeRemovedSkillStore(store), null, 2)}\n`, "utf8")
    await rename(tmp, file)
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
}

export function emptyRemovedSkillStore(): RemovedSkillStoreData {
  return {
    records: [],
    schemaVersion: removedSkillStoreSchemaVersion,
  }
}

export function createRemovedSkillKey(record: { packageName?: string; skillId: string }): string {
  return `${record.packageName?.trim() ?? ""}\u0000${record.skillId.trim()}`
}

export function isSkillRemovedByUser(
  store: RemovedSkillStoreData,
  skill: { packageName?: string; skillId: string },
): boolean {
  return store.records.some((record) => removedRecordMatchesSkill(record, skill))
}

export function removeRemovedSkillRecord(
  store: RemovedSkillStoreData,
  skill: { packageName?: string; skillId: string },
): RemovedSkillStoreData {
  return normalizeRemovedSkillStore({
    records: store.records.filter((record) => !removedRecordMatchesSkill(record, skill)),
    schemaVersion: removedSkillStoreSchemaVersion,
  })
}

export function upsertRemovedSkillRecord(
  store: RemovedSkillStoreData,
  record: RemovedSkillRecord,
): RemovedSkillStoreData {
  const records = [...store.records]
  const key = createRemovedSkillKey(record)
  const index = records.findIndex((item) => createRemovedSkillKey(item) === key)

  if (index === -1) {
    records.push(record)
  } else {
    records[index] = record
  }

  return normalizeRemovedSkillStore({
    records,
    schemaVersion: removedSkillStoreSchemaVersion,
  })
}

function removedRecordMatchesSkill(
  record: RemovedSkillRecord,
  skill: { packageName?: string; skillId: string },
): boolean {
  if (record.skillId.trim() !== skill.skillId.trim()) {
    return false
  }

  const recordPackageName = record.packageName?.trim()
  const skillPackageName = skill.packageName?.trim()
  return !recordPackageName || !skillPackageName || recordPackageName === skillPackageName
}

function normalizeRemovedSkillStore(store: RemovedSkillStoreData): RemovedSkillStoreData {
  return {
    records: store.records
      .filter(isRemovedSkillRecord)
      .map((record) => ({ ...record, packageName: record.packageName?.trim() || undefined }))
      .sort((left, right) => createRemovedSkillKey(left).localeCompare(createRemovedSkillKey(right))),
    schemaVersion: removedSkillStoreSchemaVersion,
  }
}

function isRemovedSkillRecord(value: unknown): value is RemovedSkillRecord {
  if (!value || typeof value !== "object") {
    return false
  }

  const record = value as RemovedSkillRecord
  return (
    typeof record.skillId === "string" &&
    record.skillId.trim().length > 0 &&
    record.scope === "local-machine" &&
    typeof record.removedAt === "string" &&
    (record.packageName === undefined || typeof record.packageName === "string")
  )
}
