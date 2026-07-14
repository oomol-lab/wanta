import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { logStoreReadFailure } from "../store-diagnostics.ts"

export interface PersistedSettings {
  themeSource?: string
  /** 知识库仍为 Beta 功能；缺失或非 true 时默认关闭。 */
  knowledgeBaseBetaEnabled?: boolean
  /** 更新渠道（"stable" | "beta"）；缺失/非法按未设置处理（见 update/channel.ts）。 */
  updateChannel?: string
}

/** 设置持久化到 userData/settings.json。仅存非密配置（themeSource、Beta 开关等），不存凭证（R8）。 */
export class SettingsStore {
  private readonly file: string

  public constructor(dir: string) {
    this.file = path.join(dir, "settings.json")
  }

  public read(): PersistedSettings {
    try {
      return JSON.parse(readFileSync(this.file, "utf-8")) as PersistedSettings
    } catch (error) {
      logStoreReadFailure("settings", this.file, error)
      return {}
    }
  }

  /** 原子写（tmp + rename，对齐 auth.json）：updateChannel 决定更新源，截断损坏会静默回落 stable。 */
  public write(settings: PersistedSettings): void {
    mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp-${process.pid}`
    try {
      writeFileSync(tmp, JSON.stringify(settings, null, 2), "utf-8")
      renameSync(tmp, this.file)
    } catch (error) {
      rmSync(tmp, { force: true })
      throw error
    }
  }
}
