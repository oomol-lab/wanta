export const knowledgeFileStatuses = [
  "queued",
  "upload_sending",
  "parsing",
  "parsed",
  "index_sending",
  "indexing",
  "mapping",
  "ready",
  "failed",
  "uncertain",
  "deleting",
  "deleted",
] as const
export type KnowledgeFileStatus = (typeof knowledgeFileStatuses)[number]
export interface KnowledgeFile {
  id: string
  name: string
  size_bytes: number
  status: KnowledgeFileStatus
  error_code?: string
  created_at: string
  updated_at: string
}
export interface KnowledgeFilePage {
  items: KnowledgeFile[]
  next_cursor: string
}
export interface KnowledgeHit {
  file_id: string
  filename: string
  text: string
  score: number
}
export interface KnowledgeResults {
  request_id: string
  items: KnowledgeHit[]
}
export const knowledgeUploadMaxBytes = 150 * 1024 * 1024
export const knowledgeUploadAccept = ".txt,.docx,.pdf,.xlsx,.epub,.mobi,.md,.bmp,.png,.jpg,.jpeg,.gif"
export function knowledgeUploadError(file: { name: string; size: number }): "tooLarge" | "unsupportedType" | null {
  if (file.size > knowledgeUploadMaxBytes) return "tooLarge"
  return file.name.includes(".") &&
    knowledgeUploadAccept.split(",").includes(`.${file.name.toLowerCase().split(".").pop()}`)
    ? null
    : "unsupportedType"
}
export function knowledgeFilePending(status: KnowledgeFileStatus): boolean {
  return !["ready", "failed", "uncertain", "deleted"].includes(status)
}
