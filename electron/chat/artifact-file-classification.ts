import type { ArtifactItemOrigin } from "./common.ts"

import { readFile, stat } from "node:fs/promises"
import path from "node:path"

const maxOperationalStateBytes = 256 * 1024
const operationalStateNamePattern = /\.(?:checkpoint|resume|session|state)\.json$/iu
const identifierKeys = new Set(["job_id", "jobId", "session_id", "sessionId", "task_id", "taskId"])
const runtimeStateKeys = new Set([
  "local_paths",
  "mode",
  "out_dir",
  "output_format",
  "payload",
  "poll_count",
  "remote_urls",
  "result_action",
  "submitted_at",
  "uploads",
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function hasMeaningfulValue(record: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  return [...keys].some((key) => {
    const value = record[key]
    return typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null
  })
}

export interface ArtifactFileClassificationInput {
  content: string
  filePath: string
  origin?: ArtifactItemOrigin
  size: number
}

export function isOperationalStateArtifactContent(input: ArtifactFileClassificationInput): boolean {
  if (
    input.origin === "assistant_attachment" ||
    input.origin === "assistant_preview" ||
    !hasOperationalStateFileName(input.filePath) ||
    input.size <= 0 ||
    input.size > maxOperationalStateBytes
  ) {
    return false
  }
  try {
    const parsed = JSON.parse(input.content) as unknown
    return (
      isRecord(parsed) && hasMeaningfulValue(parsed, identifierKeys) && hasMeaningfulValue(parsed, runtimeStateKeys)
    )
  } catch {
    return false
  }
}

export function hasOperationalStateFileName(filePath: string): boolean {
  return operationalStateNamePattern.test(path.basename(filePath))
}

/**
 * 第三方 Skill 可能把断点恢复状态和最终成果写进同一目录。这里只排除证据充分的运行状态文件；
 * 明确来自 assistant 的附件或预览始终保留，无法可靠判断时也保留。
 */
export async function isOperationalStateArtifact(
  filePath: string,
  origin: ArtifactItemOrigin | undefined,
): Promise<boolean> {
  if (origin === "assistant_attachment" || origin === "assistant_preview" || !hasOperationalStateFileName(filePath)) {
    return false
  }
  try {
    const info = await stat(filePath)
    if (!info.isFile() || info.size <= 0 || info.size > maxOperationalStateBytes) {
      return false
    }
    return isOperationalStateArtifactContent({
      content: await readFile(filePath, "utf-8"),
      filePath,
      origin,
      size: info.size,
    })
  } catch {
    return false
  }
}
