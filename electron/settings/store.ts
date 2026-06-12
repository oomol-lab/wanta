import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

export interface PersistedSettings {
  themeSource?: string
}

/** 设置持久化到 userData/settings.json。仅存非密配置（themeSource），不存凭证（R8）。 */
export class SettingsStore {
  private readonly file: string

  public constructor(dir: string) {
    this.file = path.join(dir, "settings.json")
  }

  public read(): PersistedSettings {
    try {
      return JSON.parse(readFileSync(this.file, "utf-8")) as PersistedSettings
    } catch {
      return {}
    }
  }

  public write(settings: PersistedSettings): void {
    mkdirSync(path.dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(settings, null, 2), "utf-8")
  }
}
