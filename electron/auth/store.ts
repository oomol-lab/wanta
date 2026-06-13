import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { ooEndpoint } from "../domain.ts"

/** 登录账号（apiKey 即网关 api-key，等价于旧 OO_API_KEY env）。 */
export interface AuthAccount {
  id: string
  name: string
  apiKey: string
}

/** 运行时账号：sessionToken 只留在主进程内存，用于 Studio authFetchJSON 同源的服务调用，不落盘。 */
export interface AuthRuntimeAccount extends AuthAccount {
  sessionToken?: string
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
  return { id: account.id, name: account.name, apiKey: account.apiKey }
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
 * 历史数据迁移：早期版本曾支持多 endpoint，auth.json 可能残留带 `endpoint` 字段的账号，
 * 甚至同一 uid 在不同 endpoint 各有一行。endpoint 概念已移除（编译期单一常量），读取时
 * 一次性归一：丢弃 endpoint 与当前构建不符的历史账号（其凭证对当前构建无效），并剥离已
 * 无意义的 endpoint 字段。无历史字段（新格式 / 空数据）时原样返回。
 */
function migrateLegacyAccounts(auth: PersistedAuth): PersistedAuth {
  const accounts = asAccounts(auth) as Array<AuthAccount & { endpoint?: string }>
  if (!accounts.some((a) => a.endpoint !== undefined)) {
    return auth
  }
  const normalized: AuthAccount[] = accounts
    .filter((a) => a.endpoint === undefined || a.endpoint === ooEndpoint)
    .map((a) => ({ id: a.id, name: a.name, apiKey: a.apiKey }))
  const currentId = normalized.some((a) => a.id === auth.currentId) ? auth.currentId : undefined
  return { currentId, accounts: normalized }
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
    } catch {
      return {}
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
