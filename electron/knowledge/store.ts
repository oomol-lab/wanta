import type { KnowledgeBaseSummary } from "./common.ts"

import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { copyFile, mkdir, readFile, rename, rm, stat } from "node:fs/promises"
import path from "node:path"
import { atomicWriteText } from "../atomic-file.ts"
import { logStoreReadFailure } from "../store-diagnostics.ts"

export interface KnowledgeBaseRecord extends KnowledgeBaseSummary {
  filePath: string
  fingerprint: string
}

interface PersistedKnowledgeLibrary {
  version: 1
  records: KnowledgeBaseRecord[]
}

function isRecord(value: unknown): value is KnowledgeBaseRecord {
  if (!value || typeof value !== "object") return false
  const record = value as Partial<KnowledgeBaseRecord>
  return Boolean(
    typeof record.id === "string" &&
    typeof record.title === "string" &&
    typeof record.filePath === "string" &&
    typeof record.fingerprint === "string" &&
    typeof record.sourceFileName === "string" &&
    typeof record.size === "number" &&
    typeof record.importedAt === "number" &&
    Array.isArray(record.authors) &&
    record.capabilities &&
    record.statistics,
  )
}

export async function fileSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256")
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("error", reject)
    stream.on("end", resolve)
  })
  return hash.digest("hex")
}

export class KnowledgeStore {
  private readonly rootDir: string
  private readonly filesDir: string
  private readonly libraryFile: string
  private mutationQueue: Promise<void> = Promise.resolve()

  public constructor(userDataDir: string) {
    this.rootDir = path.join(userDataDir, "knowledge-bases")
    this.filesDir = path.join(this.rootDir, "files")
    this.libraryFile = path.join(this.rootDir, "library.json")
  }

  public registryPath(): string {
    return this.libraryFile
  }

  public async listRecords(): Promise<KnowledgeBaseRecord[]> {
    try {
      const parsed = JSON.parse(await readFile(this.libraryFile, "utf-8")) as Partial<PersistedKnowledgeLibrary>
      return Array.isArray(parsed.records) ? parsed.records.filter(isRecord) : []
    } catch (error) {
      logStoreReadFailure("knowledge library", this.libraryFile, error)
      return []
    }
  }

  public async record(id: string): Promise<KnowledgeBaseRecord | null> {
    return (await this.listRecords()).find((record) => record.id === id) ?? null
  }

  public async copyForImport(sourcePath: string): Promise<{
    duplicate: KnowledgeBaseRecord | null
    fingerprint: string
    id: string
    managedPath: string
    size: number
  }> {
    const source = await stat(sourcePath)
    if (!source.isFile()) throw new Error("Knowledge base must be a regular file")
    const fingerprint = await fileSha256(sourcePath)
    const records = await this.listRecords()
    const duplicate = records.find((record) => record.fingerprint === fingerprint) ?? null
    if (duplicate) {
      return { duplicate, fingerprint, id: duplicate.id, managedPath: duplicate.filePath, size: source.size }
    }
    await mkdir(this.filesDir, { recursive: true })
    const id = randomUUID()
    const managedPath = path.join(this.filesDir, `${id}.wikg`)
    const temporaryPath = `${managedPath}.importing`
    try {
      await copyFile(sourcePath, temporaryPath)
      await rename(temporaryPath, managedPath)
    } catch (error) {
      await rm(temporaryPath, { force: true })
      throw error
    }
    return { duplicate: null, fingerprint, id, managedPath, size: source.size }
  }

  public async save(record: KnowledgeBaseRecord): Promise<void> {
    await this.enqueueMutation(async () => {
      const records = (await this.listRecords()).filter((item) => item.id !== record.id)
      records.push(record)
      await this.write(records)
    })
  }

  /** 导入提交时再次按 fingerprint 去重，封住“复制与耗时 inspect 之间”的并发窗口。 */
  public async commitImport(record: KnowledgeBaseRecord): Promise<KnowledgeBaseRecord | null> {
    let duplicate: KnowledgeBaseRecord | null = null
    await this.enqueueMutation(async () => {
      const records = await this.listRecords()
      duplicate = records.find((item) => item.fingerprint === record.fingerprint) ?? null
      if (duplicate) return
      await this.write([...records, record])
    })
    return duplicate
  }

  public async remove(id: string): Promise<void> {
    await this.enqueueMutation(async () => {
      const records = await this.listRecords()
      const record = records.find((item) => item.id === id)
      if (!record) return
      if (path.dirname(record.filePath) !== this.filesDir) throw new Error("Invalid managed knowledge base path")
      const stagedPath = `${record.filePath}.deleting-${randomUUID()}`
      let staged = false
      try {
        await rename(record.filePath, stagedPath)
        staged = true
      } catch (error) {
        if (!isMissingFileError(error)) throw error
      }
      try {
        await this.write(records.filter((item) => item.id !== id))
      } catch (error) {
        if (staged) {
          try {
            await rename(stagedPath, record.filePath)
          } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], "Failed to remove and restore knowledge base record")
          }
        }
        throw error
      }
      if (staged) await rm(stagedPath, { force: true })
    })
  }

  public async discardManagedFile(filePath: string): Promise<void> {
    if (path.dirname(filePath) === this.filesDir) await rm(filePath, { force: true })
  }

  /** 串行化实例内的读改写事务，避免并发更新互相覆盖。 */
  private async enqueueMutation(mutation: () => Promise<void>): Promise<void> {
    const queued = this.mutationQueue.catch(() => undefined).then(mutation)
    this.mutationQueue = queued.catch(() => undefined)
    await queued
  }

  private async write(records: KnowledgeBaseRecord[]): Promise<void> {
    await atomicWriteText(
      this.libraryFile,
      JSON.stringify({ version: 1, records } satisfies PersistedKnowledgeLibrary, null, 2),
      { mode: 0o600 },
    )
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT")
}
