import type { KnowledgeBaseSummary, KnowledgeService } from "./common.ts"
import type { WikiGraphInspect, WikiGraphLibraryArchive, WikiGraphMetadata, WikiGraphRuntime } from "./runner.ts"
import type { IConnectionService } from "@oomol/connection"

import { ConnectionService } from "@oomol/connection"
import { dialog, nativeImage, shell } from "electron"
import path from "node:path"
import { ServiceEvent } from "../service-events.ts"
import { KnowledgeService as KnowledgeServiceName } from "./common.ts"
import {
  addWikiGraphLibraryArchive,
  inspectWikiGraph,
  listWikiGraphLibraryArchives,
  readWikiGraphCover,
  readWikiGraphIndex,
  readWikiGraphMetadata,
  removeWikiGraphLibraryArchive,
  wikiGraphCoverageReady,
} from "./runner.ts"
import { isBoundedKnowledgeCoverDataUrl, knowledgeCoverDataUrl } from "./thumbnail.ts"

export interface KnowledgeServiceDeps {
  onRemoved?: (id: string) => Promise<void>
  runtime: WikiGraphRuntime
  trustedImportPaths?: Iterable<string>
}

function archiveSourceFileName(archive: WikiGraphLibraryArchive): string {
  const source = archive.relativePath || archive.path || `${archive.id}.wikg`
  return path.basename(source)
}

function archiveImportedAt(archive: WikiGraphLibraryArchive): number {
  const timestamp = Date.parse(archive.createdAt || archive.updatedAt || "")
  return Number.isFinite(timestamp) ? timestamp : 0
}

function archiveSize(archive: WikiGraphLibraryArchive): number {
  return typeof archive.lastSeenSize === "number" && Number.isFinite(archive.lastSeenSize) ? archive.lastSeenSize : 0
}

function summaryFromInspection(
  archive: WikiGraphLibraryArchive,
  metadata: WikiGraphMetadata,
  inspect: WikiGraphInspect,
  cover: Buffer | null,
): KnowledgeBaseSummary {
  const sourceFileName = archiveSourceFileName(archive)
  const encodedCover = knowledgeCoverDataUrl(cover, (buffer) => nativeImage.createFromBuffer(buffer))
  const titleValue = metadata.title
  const title =
    typeof titleValue === "string" && titleValue.trim()
      ? titleValue.trim()
      : path.basename(sourceFileName, path.extname(sourceFileName))
  return {
    id: archive.id,
    title,
    authors: (metadata.authors ?? []).flatMap((author) =>
      typeof author === "string" && author.trim() ? [author.trim()] : [],
    ),
    ...(metadata.publisher?.trim() ? { publisher: metadata.publisher.trim() } : {}),
    ...(metadata.publishedAt?.trim() ? { publishedAt: metadata.publishedAt.trim() } : {}),
    ...(metadata.language?.trim() ? { language: metadata.language.trim() } : {}),
    sourceFileName,
    size: archiveSize(archive),
    importedAt: archiveImportedAt(archive),
    ...(encodedCover && isBoundedKnowledgeCoverDataUrl(encodedCover) ? { coverDataUrl: encodedCover } : {}),
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

export class KnowledgeServiceImpl
  extends ConnectionService<KnowledgeService>
  implements IConnectionService<KnowledgeService>
{
  public readonly changed = new ServiceEvent<{ reason: string }>()

  public constructor(private readonly deps: KnowledgeServiceDeps) {
    super(KnowledgeServiceName)
  }

  public async list(): Promise<KnowledgeBaseSummary[]> {
    const archives = await listWikiGraphLibraryArchives(this.deps.runtime)
    const summaries = await Promise.all(archives.map((archive) => this.summary(archive)))
    return summaries.sort((left, right) => right.importedAt - left.importedAt)
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
    const archive = await addWikiGraphLibraryArchive(this.deps.runtime, selectedPath)
    const summary = await this.summary(archive)
    this.broadcastChanged("import knowledge base")
    return summary
  }

  private async selectKnowledgeBasePath(): Promise<string | undefined> {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "WikiGraph knowledge base", extensions: ["wikg"] }],
    })
    return result.canceled ? undefined : result.filePaths[0]
  }

  public async refresh(id: string): Promise<KnowledgeBaseSummary> {
    const archive = await this.requireArchive(id)
    const summary = await this.summary(archive)
    this.broadcastChanged("refresh knowledge base")
    return summary
  }

  public async remove(id: string): Promise<void> {
    const normalizedId = id.trim()
    if (!normalizedId) return
    await removeWikiGraphLibraryArchive(this.deps.runtime, normalizedId)
    await this.deps.onRemoved?.(normalizedId).catch((error: unknown) => {
      console.warn("[wanta] failed to clean removed knowledge base references:", error)
    })
    this.broadcastChanged("remove knowledge base")
  }

  public async reveal(id: string): Promise<void> {
    const archive = await this.requireArchive(id)
    if (!archive.path) throw new Error("Knowledge base managed file path is unavailable")
    shell.showItemInFolder(archive.path)
  }

  private async requireArchive(id: string): Promise<WikiGraphLibraryArchive> {
    const normalizedId = id.trim()
    const archive = (await listWikiGraphLibraryArchives(this.deps.runtime)).find((item) => item.id === normalizedId)
    if (!archive) throw new Error("Knowledge base not found")
    return archive
  }

  private async summary(archive: WikiGraphLibraryArchive): Promise<KnowledgeBaseSummary> {
    const [metadata, inspect, _index, cover] = await Promise.all([
      readWikiGraphMetadata(this.deps.runtime, archive.id),
      inspectWikiGraph(this.deps.runtime, archive.id),
      readWikiGraphIndex(this.deps.runtime, archive.id).catch(() => ({})),
      readWikiGraphCover(this.deps.runtime, archive.id),
    ])
    return summaryFromInspection(archive, metadata, inspect, cover)
  }

  private broadcastChanged(reason: string): void {
    this.changed.emit({ reason })
    void this.send("knowledgeBasesChanged", { reason }).catch((error: unknown) => {
      console.warn("[wanta] knowledge library broadcast failed:", error)
    })
  }
}
