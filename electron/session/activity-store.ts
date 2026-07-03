import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { logStoreReadFailure } from "../store-diagnostics.ts"

export interface PersistedSessionActivity {
  sessions?: Record<string, number>
}

function normalizeActivity(value: unknown): Map<string, number> {
  const record = value && typeof value === "object" ? (value as PersistedSessionActivity).sessions : undefined
  const activity = new Map<string, number>()
  if (!record || typeof record !== "object") {
    return activity
  }
  for (const [id, usedAt] of Object.entries(record)) {
    if (typeof id === "string" && Number.isFinite(usedAt) && usedAt > 0) {
      activity.set(id, usedAt)
    }
  }
  return activity
}

function serializeActivity(activity: Map<string, number>): PersistedSessionActivity {
  return {
    sessions: Object.fromEntries(
      [...activity.entries()].filter((entry): entry is [string, number] => {
        const [id, usedAt] = entry
        return Boolean(id) && Number.isFinite(usedAt) && usedAt > 0
      }),
    ),
  }
}

/** 最近使用时间兜底持久化：OpenCode 若不更新 time.updated，侧边栏仍能跨重启显示最近使用。 */
export class SessionActivityStore {
  private readonly file: string

  public constructor(dir: string) {
    this.file = path.join(dir, "session-activity.json")
  }

  public async read(): Promise<Map<string, number>> {
    try {
      return normalizeActivity(JSON.parse(await readFile(this.file, "utf-8")))
    } catch (error) {
      logStoreReadFailure("session activity", this.file, error)
      return new Map()
    }
  }

  public async write(activity: Map<string, number>): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp-${process.pid}-${randomUUID()}`
    try {
      await writeFile(tmp, JSON.stringify(serializeActivity(activity), null, 2), "utf-8")
      await rename(tmp, this.file)
    } catch (error) {
      await rm(tmp, { force: true })
      throw error
    }
  }
}
