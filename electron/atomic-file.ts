import { randomUUID } from "node:crypto"
import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

export interface AtomicWriteTextOptions {
  mode?: number
}

/** 统一异步文本文件的同目录临时写入、原子替换和失败清理。 */
export async function atomicWriteText(
  filePath: string,
  content: string,
  options: AtomicWriteTextOptions = {},
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`
  try {
    await writeFile(temporaryPath, content, {
      encoding: "utf8",
      ...(options.mode === undefined ? {} : { mode: options.mode }),
    })
    await rename(temporaryPath, filePath)
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  }
}
