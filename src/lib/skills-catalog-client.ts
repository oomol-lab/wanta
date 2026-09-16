import type {
  PublicSkillPackage,
  PublicSkillPackageCatalog,
  PublicSkillPackageMaintainer,
} from "../../electron/skills/common.ts"

import { normalizePublicSkillPackageCatalog, normalizeRegistrySkillPackageInfo } from "../../electron/skills/actions.ts"
import { registryBaseUrl, searchBaseUrl } from "@/lib/domain"
import { oomolFetch } from "@/lib/oomol-http"
import { readCachedSkillCatalog, invalidateSkillCatalogKeys } from "@/lib/skill-catalog-cache"
export { clearSkillCatalogCache } from "@/lib/skill-catalog-cache"
import { resolvePackageAssetIconSource } from "@/lib/skill-icon-assets.ts"

// 技能 Discover 标签的注册表浏览/搜索请求在渲染层直接发起：原先这些是渲染业务驱动、却由主进程
// SkillService 代发的只读 GET。安装/更新（写盘 + oo CLI spawn + 刷新 agent）本就不是 fetch，仍留主进程。
// 公共目录匿名读取；"我发布的"用 httpOnly 会话 cookie 自动鉴权（oomolFetch 内 credentials:"include"），
// token 不进渲染层（守 R4）；域名从 @/lib/domain 派生（守 R2）。normalize* 复用主进程同款纯函数。

const publicSkillPackagePageSize = 100
const publicSkillSearchResultSize = 100
const myPublishedSkillPackagePageSize = 20
const myPublishedSkillPackageInfoConcurrency = 10
const skillCatalogRequestTimeoutMs = 10_000
export const publicSkillPackageListCacheMs = 5 * 60_000
export const publicSkillSearchCacheMs = 2 * 60_000
const publicSkillPackageInfoCacheMs = 10 * 60_000
export const myPublishedSkillPackageCacheMs = 2 * 60_000

export interface MyPublishedSkillAccount {
  id: string
  name: string
  avatarUrl?: string
}

export interface ListPublicSkillPackagesInput {
  lang?: string
  forceRefresh?: boolean
  next?: string
  signal?: AbortSignal
  size?: number
}

export interface SearchPublicSkillPackagesInput {
  lang?: string
  forceRefresh?: boolean
  next?: string
  query: string
  signal?: AbortSignal
  size?: number
}

export interface ListMyPublishedSkillPackagesInput {
  lang?: string
  account: MyPublishedSkillAccount
  forceRefresh?: boolean
  next?: string
  signal?: AbortSignal
}

function skillCatalogPageKey(next: string | undefined, size: number | undefined): string {
  return JSON.stringify({ next: next?.trim() || null, size: size ?? null })
}

function skillCatalogPackageKey(scope: string, packageName: string, version: string): string {
  return `${scope}:package:${packageName.trim().toLowerCase()}:${version.trim().toLowerCase() || "latest"}`
}

export function invalidatePublicSkillCatalog(): void {
  invalidateSkillCatalogKeys((key) => key.startsWith("public:") || key.startsWith("search:"))
}

export function invalidateMyPublishedSkillCatalog(accountId: string): void {
  const keyPrefix = `my:${accountId}:`
  const packagePrefix = `account:${accountId}:package:`
  invalidateSkillCatalogKeys((key) => key.startsWith(keyPrefix) || key.startsWith(packagePrefix))
}

export async function listPublicSkillPackages(
  input: ListPublicSkillPackagesInput = {},
): Promise<PublicSkillPackageCatalog> {
  const next = input.next?.trim()
  const size =
    input.size && Number.isFinite(input.size)
      ? Math.min(Math.max(Math.trunc(input.size), 1), publicSkillPackagePageSize)
      : undefined
  const cacheKey = `public:list:${input.lang ?? ""}:${skillCatalogPageKey(next, size)}`
  return readCachedSkillCatalog(
    cacheKey,
    publicSkillPackageListCacheMs,
    input.forceRefresh,
    async (signal) => {
      const url = new URL("/v1/packages/-/skills-list", searchBaseUrl)
      if (input.lang) url.searchParams.set("lang", input.lang)
      if (next) {
        url.searchParams.set("next", next)
      }
      if (size) {
        url.searchParams.set("size", String(size))
      }
      const response = await oomolFetch(url, { signal, timeoutMs: skillCatalogRequestTimeoutMs })
      if (!response.ok) {
        throw new Error(`Public Skill list request failed with status ${response.status}.`)
      }
      return resolvePublicSkillPackageCatalog(normalizePublicSkillPackageCatalog(await response.text()))
    },
    input.signal,
  )
}

export async function searchPublicSkillPackages(
  input: SearchPublicSkillPackagesInput,
): Promise<PublicSkillPackageCatalog> {
  const query = input.query.trim()
  if (!query) {
    return listPublicSkillPackages({
      forceRefresh: input.forceRefresh,
      lang: input.lang,
      next: input.next,
      signal: input.signal,
      size: input.size,
    })
  }

  const next = input.next?.trim()
  const size = Math.min(Math.max(Math.trunc(input.size ?? publicSkillSearchResultSize), 1), publicSkillSearchResultSize)
  const cacheKey = `search:skills:${input.lang ?? ""}:${query.toLocaleLowerCase()}:${skillCatalogPageKey(next, size)}`
  return readCachedSkillCatalog(
    cacheKey,
    publicSkillSearchCacheMs,
    input.forceRefresh,
    async (signal) => {
      const url = new URL("/v1/packages/-/skills-list", searchBaseUrl)
      if (input.lang) url.searchParams.set("lang", input.lang)
      url.searchParams.set("text", query)
      url.searchParams.set("sort", "relevance")
      if (next) {
        url.searchParams.set("next", next)
      }
      url.searchParams.set("size", String(size))

      const response = await oomolFetch(url, { signal, timeoutMs: skillCatalogRequestTimeoutMs })
      if (!response.ok) {
        throw new Error(`Public Skill search request failed with status ${response.status}.`)
      }

      return resolvePublicSkillPackageCatalog(normalizePublicSkillPackageCatalog(await response.text()))
    },
    input.signal,
  )
}

async function readMyPublishedSkillPackageList(
  next?: string,
  signal?: AbortSignal,
  lang?: string,
): Promise<PublicSkillPackageCatalog> {
  const url = new URL("/v1/packages/-/my-skills", searchBaseUrl)
  url.searchParams.set("size", String(myPublishedSkillPackagePageSize))
  if (lang) url.searchParams.set("lang", lang)
  const trimmed = next?.trim()
  if (trimmed) {
    url.searchParams.set("next", trimmed)
  }
  const response = await oomolFetch(url, { signal, timeoutMs: skillCatalogRequestTimeoutMs })
  if (!response.ok) {
    throw new Error(`Published Skill package list request failed with status ${response.status}.`)
  }
  return resolvePublicSkillPackageCatalog(normalizePublicSkillPackageCatalog(await response.text()))
}

async function fetchRegistrySkillPackageInfo(
  packageName: string,
  maintainer: PublicSkillPackageMaintainer,
  options: {
    cacheScope?: string
    forceRefresh?: boolean
    returnNullOnNotFound?: boolean
    signal?: AbortSignal
    version?: string
  } = {},
): Promise<PublicSkillPackage | null | undefined> {
  const version = options.version?.trim() || "latest"
  const cacheScope = options.cacheScope ?? "public"
  const cacheKey = skillCatalogPackageKey(cacheScope, packageName, version)
  return readCachedSkillCatalog(
    cacheKey,
    publicSkillPackageInfoCacheMs,
    options.forceRefresh,
    async (signal) => {
      const url = new URL(
        `/-/oomol/package-info/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`,
        registryBaseUrl,
      )
      const response = await oomolFetch(url, { signal, timeoutMs: skillCatalogRequestTimeoutMs })
      if (response.status === 404 && options.returnNullOnNotFound) {
        return null
      }
      if (!response.ok) {
        throw new Error(`Registry Skill package info request failed with status ${response.status}.`)
      }
      const packageInfo = normalizeRegistrySkillPackageInfo(await response.text(), maintainer)
      return packageInfo ? resolvePublicSkillPackageIcon(packageInfo) : packageInfo
    },
    options.signal,
  )
}

async function readRegistrySkillPackageInfo(
  packageName: string,
  maintainer: PublicSkillPackageMaintainer,
  options: { cacheScope?: string; forceRefresh?: boolean; signal?: AbortSignal; version?: string } = {},
): Promise<PublicSkillPackage | undefined> {
  return (await fetchRegistrySkillPackageInfo(packageName, maintainer, options)) ?? undefined
}

export async function readPublicSkillPackageByName(
  packageName: string,
  signal?: AbortSignal,
): Promise<PublicSkillPackage | null> {
  const normalizedPackageName = packageName.trim()
  if (!normalizedPackageName) {
    throw new Error("Skill package name is empty.")
  }

  return (
    (await fetchRegistrySkillPackageInfo(
      normalizedPackageName,
      {
        name: "OOMOL",
      },
      { returnNullOnNotFound: true, signal },
    )) ?? null
  )
}

function mergeMyPublishedPackage(
  publishedPackage: PublicSkillPackage,
  packageInfo: PublicSkillPackage | undefined,
): PublicSkillPackage | undefined {
  if (!packageInfo) {
    return undefined
  }
  return {
    ...packageInfo,
    description: packageInfo.description ?? publishedPackage.description,
    displayName: packageInfo.displayName || publishedPackage.displayName,
    icon: packageInfo.icon ?? publishedPackage.icon,
    isTemplate: publishedPackage.isTemplate || packageInfo.isTemplate,
    updateTime: publishedPackage.updateTime,
    version: packageInfo.version === "latest" ? publishedPackage.version : packageInfo.version,
    visibility: packageInfo.visibility === "unknown" ? publishedPackage.visibility : packageInfo.visibility,
  }
}

function compareMyPublishedPackages(left: PublicSkillPackage, right: PublicSkillPackage): number {
  const leftTime = left.updateTime ?? 0
  const rightTime = right.updateTime ?? 0
  if (leftTime !== rightTime) {
    return rightTime - leftTime
  }
  return left.displayName.localeCompare(right.displayName)
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let nextIndex = 0
  let failed = false
  const workerCount = Math.min(Math.max(1, concurrency), items.length)
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (!failed && nextIndex < items.length) {
        const index = nextIndex
        nextIndex += 1
        try {
          results[index] = await mapper(items[index] as T)
        } catch (cause) {
          failed = true
          throw cause
        }
      }
    }),
  )
  return results
}

export async function listMyPublishedSkillPackages(
  input: ListMyPublishedSkillPackagesInput,
): Promise<PublicSkillPackageCatalog> {
  const cacheKey = `my:${input.account.id}:${input.lang ?? ""}:${skillCatalogPageKey(input.next, undefined)}`
  return readCachedSkillCatalog(
    cacheKey,
    myPublishedSkillPackageCacheMs,
    input.forceRefresh,
    async (signal) => {
      const publishedPackages = await readMyPublishedSkillPackageList(input.next, signal, input.lang)
      const maintainer: PublicSkillPackageMaintainer = {
        id: input.account.id,
        name: input.account.name,
        url: input.account.avatarUrl,
      }
      const items = (
        await mapWithConcurrency(
          publishedPackages.items.slice(0, myPublishedSkillPackagePageSize),
          myPublishedSkillPackageInfoConcurrency,
          async (publishedPackage) => {
            signal.throwIfAborted()
            if (publishedPackage.skills.length > 0) {
              return {
                ...publishedPackage,
                maintainers: publishedPackage.maintainers.length ? publishedPackage.maintainers : [maintainer],
              }
            }
            const packageInfo = await readRegistrySkillPackageInfo(publishedPackage.name, maintainer, {
              cacheScope: `account:${input.account.id}`,
              forceRefresh: input.forceRefresh,
              signal,
              version: publishedPackage.version,
            })
            return mergeMyPublishedPackage(publishedPackage, packageInfo)
          },
        )
      ).filter((item): item is PublicSkillPackage => Boolean(item))

      return {
        items: items.sort(compareMyPublishedPackages).map(resolvePublicSkillPackageIcon),
        next: publishedPackages.next,
        updatedAt: new Date().toISOString(),
      }
    },
    input.signal,
  )
}

function resolvePublicSkillPackageCatalog(catalog: PublicSkillPackageCatalog): PublicSkillPackageCatalog {
  return {
    ...catalog,
    items: catalog.items.map(resolvePublicSkillPackageIcon),
  }
}

export function resolvePublicSkillPackageIcon(pkg: PublicSkillPackage): PublicSkillPackage {
  const icon = resolvePackageAssetIconSource(pkg.icon, pkg.name, pkg.version)
  if (icon === pkg.icon) {
    return pkg
  }
  return {
    ...pkg,
    ...(icon ? { icon } : {}),
  }
}
