import type { KnowledgeBaseSummary } from "./common.ts"

import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { copyFile, mkdir, readFile, rename, rm, stat } from "node:fs/promises"
import path from "node:path"
import { atomicWriteText } from "../atomic-file.ts"
import { isMissingFileError, logStoreReadFailure } from "../store-diagnostics.ts"

export interface KnowledgeBaseRecord extends KnowledgeBaseSummary {
  filePath: string
  fingerprint: string
}

interface PersistedKnowledgeLibrary {
  version: 1
  records: KnowledgeBaseRecord[]
}

function parseKnowledgeLibrary(value: unknown): KnowledgeBaseRecord[] {
  if (!value || typeof value !== "object") {
    throw new Error("Knowledge library must be an object")
  }
  const library = value as Partial<PersistedKnowledgeLibrary>
  if (library.version !== 1 || !Array.isArray(library.records) || !library.records.every(isRecord)) {
    throw new Error("Knowledge library has an unsupported or corrupt schema")
  }
  return library.records
}

function isRecord(value: unknown): value is KnowledgeBaseRecord {
  if (!value || typeof value !== "object") return false
  const record = value as Partial<KnowledgeBaseRecord>
  const capabilities = record.capabilities
  const statistics = record.statistics
  return Boolean(
    nonEmptyString(record.id) &&
    nonEmptyString(record.title) &&
    nonEmptyString(record.filePath) &&
    nonEmptyString(record.fingerprint) &&
    nonEmptyString(record.sourceFileName) &&
    nonNegativeFiniteNumber(record.size) &&
    nonNegativeFiniteNumber(record.importedAt) &&
    Array.isArray(record.authors) &&
    record.authors.every((author) => typeof author === "string") &&
    optionalString(record.publisher) &&
    optionalString(record.publishedAt) &&
    optionalString(record.language) &&
    optionalString(record.coverDataUrl) &&
    Boolean(
      capabilities &&
      typeof capabilities.fullTextSearch === "boolean" &&
      typeof capabilities.knowledgeGraph === "boolean" &&
      typeof capabilities.readingGraph === "boolean" &&
      typeof capabilities.summary === "boolean",
    ) &&
    Boolean(
      statistics &&
      optionalNonNegativeFiniteNumber(statistics.totalChapters) &&
      optionalNonNegativeFiniteNumber(statistics.contentChapters) &&
      optionalNonNegativeFiniteNumber(statistics.sourceWords),
    ),
  )
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim())
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string"
}

function nonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function optionalNonNegativeFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || nonNegativeFiniteNumber(value)
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
      const records = parseKnowledgeLibrary(JSON.parse(await readFile(this.libraryFile, "utf-8")))
      if (records.some((record) => path.dirname(record.filePath) !== this.filesDir)) {
        throw new Error("Knowledge library contains an invalid managed file path")
      }
      return records
    } catch (error) {
      if (isMissingFileError(error)) return []
      logStoreReadFailure("knowledge library", this.libraryFile, error)
      throw new Error("Knowledge library could not be read safely", { cause: error })
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

  /** refresh 只能更新仍存在的记录，避免与 remove 并发时复活已经删除的知识库。 */
  public async update(record: KnowledgeBaseRecord): Promise<boolean> {
    let updated = false
    await this.enqueueMutation(async () => {
      const records = await this.listRecords()
      const index = records.findIndex((item) => item.id === record.id)
      if (index < 0) return
      const next = [...records]
      next[index] = record
      await this.write(next)
      updated = true
    })
    return updated
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
      if (staged) {
        try {
          await rm(stagedPath, { force: true })
        } catch (error) {
          // registry 已经提交删除，不能再把逻辑成功报告为失败；残留暂存文件不再可被查询。
          console.warn("[wanta] failed to remove staged knowledge base file:", error)
        }
      }
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
