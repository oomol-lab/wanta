export function isWikiGraphFileName(fileName: string): boolean {
  return fileName.trim().toLocaleLowerCase().endsWith(".wikg")
}

export function wikiGraphDropCandidates<T extends { name: string }>(files: Iterable<T>): T[] {
  return Array.from(files).filter((file) => isWikiGraphFileName(file.name))
}
