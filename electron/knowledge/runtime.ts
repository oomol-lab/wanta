import { installWikiGraphPlatform, withWikiGraphStorage } from "wiki-graph-core"
import { createNodeWikiGraphStorage, nodeWikiGraphPlatform } from "./node-platform.ts"

// Install only host services. Every operation must explicitly supply Wanta's storage.
installWikiGraphPlatform(nodeWikiGraphPlatform)

export async function withWikiGraphRuntime<T>(stateDir: string, operation: () => Promise<T> | T): Promise<T> {
  return await withWikiGraphStorage(createNodeWikiGraphStorage(stateDir), operation)
}
