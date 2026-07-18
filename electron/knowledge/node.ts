import type { KnowledgeBaseSummary, KnowledgeService } from "./common.ts"
import type { WikiGraphInspect, WikiGraphMetadata, WikiGraphRuntime } from "./runner.ts"
import type { KnowledgeBaseRecord, KnowledgeStore } from "./store.ts"
import type { IConnectionService } from "@oomol/connection"

import { ConnectionService } from "@oomol/connection"
import { dialog, shell } from "electron"
import path from "node:path"
import { ServiceEvent } from "../service-events.ts"
import { KnowledgeService as KnowledgeServiceName } from "./common.ts"
import { inspectWikiGraph, readWikiGraphCover, readWikiGraphMetadata, wikiGraphCoverageReady } from "./runner.ts"
import { knowledgeArchiveUri } from "./uri.ts"

export interface KnowledgeServiceDeps {
  runtime: WikiGraphRuntime
  store: KnowledgeStore
  trustedImportPaths?: Iterable<string>
}

function coverDataUrl(cover: Buffer | null): string | undefined {
  if (!cover) return undefined
  if (cover.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return `data:image/jpeg;base64,${cover.toString("base64")}`
  }
  if (cover.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return `data:image/png;base64,${cover.toString("base64")}`
  }
  return undefined
}

function summaryFromInspection(
  base: Pick<KnowledgeBaseRecord, "id" | "fingerprint" | "filePath" | "importedAt" | "size" | "sourceFileName">,
  metadata: WikiGraphMetadata,
  inspect: WikiGraphInspect,
  cover: Buffer | null,
): KnowledgeBaseRecord {
  const encodedCover = coverDataUrl(cover)
  return {
    ...base,
    title: metadata.title?.trim() || path.basename(base.sourceFileName, path.extname(base.sourceFileName)),
    authors: (metadata.authors ?? []).flatMap((author) =>
      typeof author === "string" && author.trim() ? [author.trim()] : [],
    ),
    ...(metadata.publisher?.trim() ? { publisher: metadata.publisher.trim() } : {}),
    ...(metadata.publishedAt?.trim() ? { publishedAt: metadata.publishedAt.trim() } : {}),
    ...(metadata.language?.trim() ? { language: metadata.language.trim() } : {}),
    ...(encodedCover ? { coverDataUrl: encodedCover } : {}),
    capabilities: {
      fullTextSearch: inspect.index?.querySupport === true,
      knowledgeGraph: wikiGraphCoverageReady(inspect.coverage?.knowledgeGraph),
      readingGraph: wikiGraphCoverageReady(inspect.coverage?.readingGraph),
      summary: wikiGraphCoverageReady(inspect.coverage?.summary),
    },
    statistics: {
      ...(typeof inspect.content?.chapters?.total === "number"
        ? { totalChapters: inspect.content.chapters.total }
        : {}),
      ...(typeof inspect.content?.chapters?.content === "number"
        ? { contentChapters: inspect.content.chapters.content }
        : {}),
      ...(typeof inspect.content?.sourceWords === "number" ? { sourceWords: inspect.content.sourceWords } : {}),
    },
  }
}

function publicSummary(record: KnowledgeBaseRecord): KnowledgeBaseSummary {
  const { filePath: _filePath, fingerprint: _fingerprint, ...summary } = record
  return summary
}

export class KnowledgeServiceImpl
  extends ConnectionService<KnowledgeService>
  implements IConnectionService<KnowledgeService>
{
  public readonly changed = new ServiceEvent<{ reason: string }>()

  public constructor(private readonly deps: KnowledgeServiceDeps) {
    super(KnowledgeServiceName)
  }

  public async list(): Promise<KnowledgeBaseSummary[]> {
    return (await this.deps.store.listRecords())
      .sort((left, right) => right.importedAt - left.importedAt)
      .map(publicSummary)
  }

  public async importKnowledgeBase(sourcePath?: string): Promise<KnowledgeBaseSummary | null> {
    const selectedPath = sourcePath?.trim() || (await this.selectKnowledgeBasePath())
    if (!selectedPath) return null
    if (sourcePath && this.deps.trustedImportPaths) {
      const normalized = path.resolve(selectedPath)
      if (![...this.deps.trustedImportPaths].some((candidate) => path.resolve(candidate) === normalized)) {
        throw new Error("Knowledge base path was not selected with a trusted file picker")
      }
    }
    if (path.extname(selectedPath).toLowerCase() !== ".wikg") {
      throw new Error("Only .wikg knowledge bases are supported")
    }
    const imported = await this.deps.store.copyForImport(selectedPath)
    if (imported.duplicate) return publicSummary(imported.duplicate)
    try {
      const archiveUri = knowledgeArchiveUri(imported.managedPath)
      const [metadata, inspect, cover] = await Promise.all([
        readWikiGraphMetadata(this.deps.runtime, archiveUri),
        inspectWikiGraph(this.deps.runtime, archiveUri),
        readWikiGraphCover(this.deps.runtime, archiveUri),
      ])
      const record = summaryFromInspection(
        {
          id: imported.id,
          filePath: imported.managedPath,
          fingerprint: imported.fingerprint,
          importedAt: Date.now(),
          size: imported.size,
          sourceFileName: path.basename(selectedPath),
        },
        metadata,
        inspect,
        cover,
      )
      const duplicate = await this.deps.store.commitImport(record)
      if (duplicate) {
        await this.deps.store.discardManagedFile(imported.managedPath)
        return publicSummary(duplicate)
      }
      this.broadcastChanged("import knowledge base")
      return publicSummary(record)
    } catch (error) {
      await this.deps.store.discardManagedFile(imported.managedPath)
      throw error
    }
  }

  private async selectKnowledgeBasePath(): Promise<string | undefined> {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "WikiGraph knowledge base", extensions: ["wikg"] }],
    })
    return result.canceled ? undefined : result.filePaths[0]
  }

  public async refresh(id: string): Promise<KnowledgeBaseSummary> {
    const current = await this.requireRecord(id)
    const archiveUri = knowledgeArchiveUri(current.filePath)
    const [metadata, inspect, cover] = await Promise.all([
      readWikiGraphMetadata(this.deps.runtime, archiveUri),
      inspectWikiGraph(this.deps.runtime, archiveUri),
      readWikiGraphCover(this.deps.runtime, archiveUri),
    ])
    const record = summaryFromInspection(current, metadata, inspect, cover)
    await this.deps.store.save(record)
    this.broadcastChanged("refresh knowledge base")
    return publicSummary(record)
  }

  public async remove(id: string): Promise<void> {
    await this.deps.store.remove(id)
    this.broadcastChanged("remove knowledge base")
  }

  public async reveal(id: string): Promise<void> {
    const record = await this.requireRecord(id)
    shell.showItemInFolder(record.filePath)
  }

  private async requireRecord(id: string): Promise<KnowledgeBaseRecord> {
    const record = await this.deps.store.record(id.trim())
    if (!record) throw new Error("Knowledge base not found")
    return record
  }

  private broadcastChanged(reason: string): void {
    this.changed.emit({ reason })
    void this.send("knowledgeBasesChanged", { reason }).catch((error: unknown) => {
      console.warn("[wanta] knowledge library broadcast failed:", error)
    })
  }
}
