import type { KnowledgeBaseSummary } from "./common.ts"

import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
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
    const records = (await this.listRecords()).filter((item) => item.id !== record.id)
    records.push(record)
    await this.write(records)
  }

  public async remove(id: string): Promise<void> {
    const records = await this.listRecords()
    const record = records.find((item) => item.id === id)
    if (!record) return
    if (path.dirname(record.filePath) !== this.filesDir) throw new Error("Invalid managed knowledge base path")
    await rm(record.filePath, { force: true })
    await this.write(records.filter((item) => item.id !== id))
  }

  public async discardManagedFile(filePath: string): Promise<void> {
    if (path.dirname(filePath) === this.filesDir) await rm(filePath, { force: true })
  }

  private async write(records: KnowledgeBaseRecord[]): Promise<void> {
    await mkdir(this.rootDir, { recursive: true })
    const temporaryPath = `${this.libraryFile}.tmp-${process.pid}-${randomUUID()}`
    try {
      await writeFile(
        temporaryPath,
        JSON.stringify({ version: 1, records } satisfies PersistedKnowledgeLibrary, null, 2),
        { encoding: "utf-8", mode: 0o600 },
      )
      await rename(temporaryPath, this.libraryFile)
    } catch (error) {
      await rm(temporaryPath, { force: true })
      throw error
    }
  }
}
