import { readFile } from "node:fs/promises"
import path from "node:path"
import { atomicWriteText } from "../atomic-file.ts"

export interface ModelCredentialEncryption {
  decryptString(encrypted: Buffer): string
  encryptString(plainText: string): Buffer
  getSelectedStorageBackend?(): string
  isEncryptionAvailable(): boolean
}

interface PersistedModelCredentials {
  version: 1
  credentials: Record<string, string>
}

export class ModelCredentialUnavailableError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = "ModelCredentialUnavailableError"
  }
}

/**
 * 自定义模型凭证仓库：磁盘只保存 safeStorage 密文，明文仅在主进程 runtime 装配期间短暂存在。
 * Linux 的 basic_text 后端不提供真实机密性，因此显式拒绝，不做明文或弱加密降级。
 */
export class ModelCredentialStore {
  private readonly file: string

  public constructor(
    dir: string,
    private readonly encryption: ModelCredentialEncryption,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {
    this.file = path.join(dir, "model-credentials.json")
  }

  public async get(modelId: string): Promise<string | undefined> {
    this.assertAvailable()
    const encoded = (await this.read()).credentials[modelId]
    if (!encoded) return undefined
    return this.encryption.decryptString(Buffer.from(encoded, "base64"))
  }

  public async set(modelId: string, apiKey: string): Promise<void> {
    await this.setMany(new Map([[modelId, apiKey]]))
  }

  public async setMany(credentials: ReadonlyMap<string, string>): Promise<void> {
    if (credentials.size === 0) return
    this.assertAvailable()
    const persisted = await this.read()
    for (const [modelId, apiKey] of credentials) {
      const id = modelId.trim()
      const secret = apiKey.trim()
      if (!isSafeCredentialId(id) || !secret) {
        throw new Error("A valid model ID and API Key are required for secure credential storage.")
      }
      persisted.credentials[id] = this.encryption.encryptString(secret).toString("base64")
    }
    await this.write(persisted)
  }

  public async delete(modelId: string): Promise<void> {
    this.assertAvailable()
    const persisted = await this.read()
    if (!Object.hasOwn(persisted.credentials, modelId)) return
    delete persisted.credentials[modelId]
    await this.write(persisted)
  }

  private assertAvailable(): void {
    if (!this.encryption.isEncryptionAvailable()) {
      throw new ModelCredentialUnavailableError(
        "Secure model credential storage is unavailable. Unlock the operating system keychain and try again.",
      )
    }
    if (this.platform === "linux") {
      const backend = this.encryption.getSelectedStorageBackend?.() ?? "unknown"
      if (backend === "basic_text" || backend === "unknown") {
        throw new ModelCredentialUnavailableError(
          "Secure model credential storage requires GNOME Keyring or KWallet on Linux; plaintext fallback is disabled.",
        )
      }
    }
  }

  private async read(): Promise<PersistedModelCredentials> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as Partial<PersistedModelCredentials>
      if (
        parsed.version !== 1 ||
        !parsed.credentials ||
        typeof parsed.credentials !== "object" ||
        Array.isArray(parsed.credentials)
      ) {
        throw new Error("Model credential store has an unsupported format.")
      }
      const credentials = Object.fromEntries(
        Object.entries(parsed.credentials).filter(
          (entry): entry is [string, string] =>
            Boolean(entry[0].trim()) && typeof entry[1] === "string" && entry[1].length > 0,
        ),
      )
      return { version: 1, credentials }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 1, credentials: {} }
      }
      throw error
    }
  }

  private async write(credentials: PersistedModelCredentials): Promise<void> {
    await atomicWriteText(this.file, JSON.stringify(credentials, null, 2), { mode: 0o600 })
  }
}

function isSafeCredentialId(value: string): boolean {
  return Boolean(value && value !== "__proto__" && value !== "constructor" && value !== "prototype")
}
