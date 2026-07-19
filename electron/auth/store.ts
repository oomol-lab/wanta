import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { ooEndpoint } from "../domain.ts"
import { logStoreReadFailure } from "../store-diagnostics.ts"

/** 持久化的账号资料：只存身份与展示信息，**不含任何凭证**。唯一凭证是会话 token（见 AuthRuntimeAccount）。 */
export interface AuthAccount {
  id: string
  name: string
  avatarUrl?: string
}

/**
 * 运行时账号：profile + 会话 token（oomol-token）。会话 token 是全应用唯一凭证——
 * 聊天/连接器/团队/技能/账单一律用它鉴权（网关层接受 cookie/token/api-key），不再获取或落盘长期 api-key。
 * token 只活在 Electron 会话 cookie（持久但会过期）与运行态内存，永不写入 auth.json。
 */
export interface AuthRuntimeAccount extends AuthAccount {
  sessionToken: string
}

export interface PersistedAuth {
  /** 当前账号 id（见 selectAccount）。 */
  currentId?: string
  accounts?: AuthAccount[]
}

function asAccounts(value: PersistedAuth): AuthAccount[] {
  return Array.isArray(value.accounts) ? value.accounts : []
}

function persistableAccount(account: AuthRuntimeAccount): AuthAccount {
  return {
    id: account.id,
    name: account.name,
    ...(account.avatarUrl ? { avatarUrl: account.avatarUrl } : {}),
  }
}

/** 登录成功：插入或替换账号（按 id），并把它设为当前账号。 */
export function upsertAccount(auth: PersistedAuth, account: AuthRuntimeAccount): PersistedAuth {
  const next = persistableAccount(account)
  const accounts = asAccounts(auth)
  const index = accounts.findIndex((existing) => existing.id === next.id)
  return {
    currentId: next.id,
    accounts: index === -1 ? [...accounts, next] : accounts.map((a, i) => (i === index ? next : a)),
  }
}

/** 登出：移除该账号；若它是当前账号则清空 currentId。 */
export function removeAccount(auth: PersistedAuth, account: { id: string }): PersistedAuth {
  const accounts = asAccounts(auth).filter((existing) => existing.id !== account.id)
  const currentStillExists = accounts.some((a) => a.id === auth.currentId)
  return {
    currentId: currentStillExists ? auth.currentId : undefined,
    accounts,
  }
}

/** 取生效账号：优先 currentId 命中，否则第一个账号。 */
export function selectAccount(auth: PersistedAuth): AuthAccount | null {
  const accounts = asAccounts(auth)
  return accounts.find((a) => a.id === auth.currentId) ?? accounts[0] ?? null
}

/**
 * 读取时归一历史数据：
 *  - 早期多 endpoint 残留：丢弃 endpoint 与当前构建不符的历史账号（其凭证对当前构建无效），剥离 endpoint 字段；
 *  - 早期把长期 api-key 落盘的残留：一律剥离 `apiKey`——凭证不再落盘（见 AuthAccount），唯一凭证是会话 cookie。
 * 无任何遗留字段（新格式 / 空数据）时原样返回，避免无谓重写。
 */
function migrateLegacyAccounts(auth: PersistedAuth): PersistedAuth {
  const accounts = asAccounts(auth) as Array<AuthAccount & { endpoint?: string; apiKey?: string }>
  if (!accounts.some((a) => a.endpoint !== undefined || a.apiKey !== undefined)) {
    return auth
  }
  const normalized: AuthAccount[] = accounts
    .filter((a) => a.endpoint === undefined || a.endpoint === ooEndpoint)
    .map((a) => ({ id: a.id, name: a.name, ...(a.avatarUrl ? { avatarUrl: a.avatarUrl } : {}) }))
  const currentId = normalized.some((a) => a.id === auth.currentId) ? auth.currentId : undefined
  return { currentId, accounts: normalized }
}

/** 是否仍有历史遗留字段（endpoint / 落盘 apiKey）需要清洗 —— 供启动时一次性磁盘清理用。 */
export function hasLegacyAccountFields(auth: PersistedAuth): boolean {
  return asAccounts(auth).some(
    (a) => (a as { endpoint?: unknown }).endpoint !== undefined || (a as { apiKey?: unknown }).apiKey !== undefined,
  )
}

/** 凭证持久化到 userData/auth.json（与 settings.json 分离：R8 settings 不存凭证）。 */
export class AuthStore {
  private readonly file: string

  public constructor(dir: string) {
    this.file = path.join(dir, "auth.json")
  }

  public read(): PersistedAuth {
    try {
      return migrateLegacyAccounts(JSON.parse(readFileSync(this.file, "utf-8")) as PersistedAuth)
    } catch (error) {
      logStoreReadFailure("auth", this.file, error)
      return {}
    }
  }

  /**
   * 启动时一次性清除磁盘上残留的旧凭证（早期落盘的长期 api-key / endpoint 字段）。
   * read() 在内存里已剥离这些字段，但磁盘文件要等下次写才更新；此方法主动重写以尽快抹除长期 key。
   * 无残留则不写（避免无谓 IO）。
   */
  public purgeLegacy(): void {
    let parsed: PersistedAuth
    try {
      parsed = JSON.parse(readFileSync(this.file, "utf-8")) as PersistedAuth
    } catch {
      return
    }
    if (hasLegacyAccountFields(parsed)) {
      this.write(migrateLegacyAccounts(parsed))
    }
  }

  /** 原子写（tmp + rename），避免崩溃时截断凭证文件。 */
  public write(auth: PersistedAuth): void {
    mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp-${process.pid}`
    try {
      writeFileSync(tmp, JSON.stringify(auth, null, 2), { encoding: "utf-8", mode: 0o600 })
      renameSync(tmp, this.file)
    } catch (error) {
      rmSync(tmp, { force: true })
      throw error
    }
  }
}
