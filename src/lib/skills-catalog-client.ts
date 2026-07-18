import type {
  PublicSkillPackage,
  PublicSkillPackageCatalog,
  PublicSkillPackageMaintainer,
} from "../../electron/skills/common.ts"
import type { SharedRequest } from "@/lib/shared-request"

import { normalizePublicSkillPackageCatalog, normalizeRegistrySkillPackageInfo } from "../../electron/skills/actions.ts"
import { registryBaseUrl, searchBaseUrl } from "@/lib/domain"
import { oomolFetch } from "@/lib/oomol-http"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { createSharedRequest, waitForSharedRequest } from "@/lib/shared-request"
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
const publicSkillPackageListCacheMs = 5 * 60_000
const publicSkillSearchCacheMs = 2 * 60_000
const publicSkillPackageInfoCacheMs = 10 * 60_000
const myPublishedSkillPackageCacheMs = 2 * 60_000
const skillCatalogCacheMaxEntries = 256

interface SkillCatalogCacheEntry {
  expiresAt: number
  value: unknown
}

interface SkillCatalogPendingRequest extends SharedRequest<unknown> {
  epoch: number
  generation: number
}

const skillCatalogCache = new Map<string, SkillCatalogCacheEntry>()
const skillCatalogPendingRequests = new Map<string, SkillCatalogPendingRequest>()
const skillCatalogKeyGenerations = new Map<string, number>()
let skillCatalogEpoch = 0

export interface MyPublishedSkillAccount {
  id: string
  name: string
  avatarUrl?: string
}

export interface ListPublicSkillPackagesInput {
  forceRefresh?: boolean
  next?: string
  signal?: AbortSignal
  size?: number
}

export interface SearchPublicSkillPackagesInput {
  forceRefresh?: boolean
  next?: string
  query: string
  signal?: AbortSignal
  size?: number
}

export interface ListMyPublishedSkillPackagesInput {
  account: MyPublishedSkillAccount
  forceRefresh?: boolean
  next?: string
  signal?: AbortSignal
}

interface RawPublicSkillSearchResponse {
  data?: unknown
  next?: unknown
}

interface RawPublicSkillSearchItem {
  description?: unknown
  icon?: unknown
  name?: unknown
  owner?: unknown
  packageName?: unknown
  packageVersion?: unknown
  title?: unknown
  version?: unknown
  visibility?: unknown
}

interface PublicSkillSearchGroup {
  description?: string
  displayName: string
  icon?: string
  maintainer: PublicSkillPackageMaintainer
  packageName: string
  skills: PublicSkillPackage["skills"]
  version: string
  visibility: PublicSkillPackage["visibility"]
}

function skillCatalogPageKey(next: string | undefined, size: number | undefined): string {
  return JSON.stringify({ next: next?.trim() || null, size: size ?? null })
}

function skillCatalogPackageKey(scope: string, packageName: string, version: string): string {
  return `${scope}:package:${packageName.trim().toLowerCase()}:${version.trim().toLowerCase() || "latest"}`
}

function readCachedSkillCatalogValue<T>(key: string): T | undefined {
  const cached = skillCatalogCache.get(key)
  if (!cached) {
    return undefined
  }
  if (Date.now() >= cached.expiresAt) {
    skillCatalogCache.delete(key)
    if (!skillCatalogPendingRequests.has(key)) {
      skillCatalogKeyGenerations.delete(key)
    }
    return undefined
  }
  return cached.value as T
}

function readCachedSkillCatalog<T>(
  key: string,
  cacheMs: number,
  forceRefresh: boolean | undefined,
  load: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted()
  if (forceRefresh) {
    invalidateSkillCatalogKey(key)
  }

  if (!forceRefresh) {
    const cached = readCachedSkillCatalogValue<T>(key)
    if (cached !== undefined) {
      return Promise.resolve(cached)
    }
  }

  const epoch = skillCatalogEpoch
  const generation = skillCatalogKeyGenerations.get(key) ?? 0
  const pending = skillCatalogPendingRequests.get(key)
  if (pending?.epoch === epoch && pending.generation === generation) {
    return waitForSharedRequest(pending as SkillCatalogPendingRequest & SharedRequest<T>, signal)
  }

  const shared = createSharedRequest((requestSignal) =>
    load(requestSignal).then((value) => {
      if (
        !requestSignal.aborted &&
        skillCatalogEpoch === epoch &&
        (skillCatalogKeyGenerations.get(key) ?? 0) === generation
      ) {
        skillCatalogCache.set(key, { expiresAt: Date.now() + cacheMs, value })
        while (skillCatalogCache.size > skillCatalogCacheMaxEntries) {
          const oldestKey = skillCatalogCache.keys().next().value as string | undefined
          if (!oldestKey) {
            break
          }
          skillCatalogCache.delete(oldestKey)
          if (!skillCatalogPendingRequests.has(oldestKey)) {
            skillCatalogKeyGenerations.delete(oldestKey)
          }
        }
      }
      return value
    }),
  )
  const request: SkillCatalogPendingRequest = Object.assign(shared, { epoch, generation })
  skillCatalogPendingRequests.set(key, request)
  void request.promise.then(
    () => {
      if (skillCatalogPendingRequests.get(key) === request) skillCatalogPendingRequests.delete(key)
    },
    () => {
      if (skillCatalogPendingRequests.get(key) === request) skillCatalogPendingRequests.delete(key)
    },
  )
  return waitForSharedRequest(request as SkillCatalogPendingRequest & SharedRequest<T>, signal)
}

function invalidateSkillCatalogKey(key: string): void {
  skillCatalogCache.delete(key)
  skillCatalogPendingRequests.delete(key)
  skillCatalogKeyGenerations.set(key, (skillCatalogKeyGenerations.get(key) ?? 0) + 1)
}

function invalidateSkillCatalogKeys(predicate: (key: string) => boolean): void {
  const keys = new Set([
    ...skillCatalogCache.keys(),
    ...skillCatalogPendingRequests.keys(),
    ...skillCatalogKeyGenerations.keys(),
  ])
  for (const key of keys) {
    if (predicate(key)) {
      invalidateSkillCatalogKey(key)
    }
  }
}

export function clearSkillCatalogCache(): void {
  skillCatalogEpoch += 1
  skillCatalogCache.clear()
  for (const request of skillCatalogPendingRequests.values()) {
    request.controller.abort(new DOMException("Skill catalog cache was cleared.", "AbortError"))
  }
  skillCatalogPendingRequests.clear()
  skillCatalogKeyGenerations.clear()
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
  const cacheKey = `public:list:${skillCatalogPageKey(next, size)}`
  return readCachedSkillCatalog(
    cacheKey,
    publicSkillPackageListCacheMs,
    input.forceRefresh,
    async (signal) => {
      const url = new URL("/v1/packages/-/skills-list", searchBaseUrl)
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
      next: input.next,
      signal: input.signal,
      size: input.size,
    })
  }

  const next = input.next?.trim()
  const size = Math.min(Math.max(Math.trunc(input.size ?? publicSkillSearchResultSize), 1), publicSkillSearchResultSize)
  const cacheKey = `search:skills:${query.toLocaleLowerCase()}:${skillCatalogPageKey(next, size)}`
  return readCachedSkillCatalog(
    cacheKey,
    publicSkillSearchCacheMs,
    input.forceRefresh,
    async (signal) => {
      const url = new URL("/v1/packages/-/skills-search", searchBaseUrl)
      url.searchParams.set("keywords", query)
      if (next) {
        url.searchParams.set("next", next)
      }
      url.searchParams.set("size", String(size))

      const response = await oomolFetch(url, { signal, timeoutMs: skillCatalogRequestTimeoutMs })
      if (!response.ok) {
        throw new Error(`Public Skill search request failed with status ${response.status}.`)
      }

      const searchCatalog = normalizePublicSkillSearchCatalog(await response.text())
      return {
        items: searchCatalog.items.map(createPublicSkillSearchFallbackPackage),
        next: searchCatalog.next,
        updatedAt: searchCatalog.updatedAt,
      }
    },
    input.signal,
  )
}

async function readMyPublishedSkillPackageList(
  next?: string,
  signal?: AbortSignal,
): Promise<PublicSkillPackageCatalog> {
  const url = new URL("/v1/packages/-/my", searchBaseUrl)
  url.searchParams.set("size", String(myPublishedSkillPackagePageSize))
  url.searchParams.set("lang", "en")
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
  const workerCount = Math.min(Math.max(1, concurrency), items.length)
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex
        nextIndex += 1
        results[index] = await mapper(items[index] as T)
      }
    }),
  )
  return results
}

export async function listMyPublishedSkillPackages(
  input: ListMyPublishedSkillPackagesInput,
): Promise<PublicSkillPackageCatalog> {
  const cacheKey = `my:${input.account.id}:${skillCatalogPageKey(input.next, undefined)}`
  return readCachedSkillCatalog(
    cacheKey,
    myPublishedSkillPackageCacheMs,
    input.forceRefresh,
    async (signal) => {
      const publishedPackages = await readMyPublishedSkillPackageList(input.next, signal)
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
            let packageInfo: PublicSkillPackage | undefined
            try {
              packageInfo = await readRegistrySkillPackageInfo(publishedPackage.name, maintainer, {
                cacheScope: `account:${input.account.id}`,
                signal,
              })
            } catch (error) {
              if (signal.aborted) {
                throw error
              }
              console.warn("[wanta] failed to read my published skill package info:", error)
              reportRendererHandledError(
                "skillsCatalog.readMyPublishedPackageInfo",
                "Failed to read published Skill package info",
                error,
              )
              packageInfo = undefined
            }
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

function normalizePublicSkillSearchCatalog(
  stdout: string,
  updatedAt = new Date().toISOString(),
): {
  items: PublicSkillSearchGroup[]
  next: string | null
  updatedAt: string
} {
  const parsed = JSON.parse(stdout) as unknown

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Public Skill search returned an unsupported response.")
  }

  const raw = parsed as RawPublicSkillSearchResponse
  if (!Array.isArray(raw.data)) {
    throw new Error("Public Skill search returned an unsupported response.")
  }

  return {
    items: mergePublicSkillSearchGroups(
      raw.data.map(normalizePublicSkillSearchItem).filter((item): item is PublicSkillSearchGroup => Boolean(item)),
    ),
    next: typeof raw.next === "string" && raw.next.trim() ? raw.next.trim() : null,
    updatedAt,
  }
}

function normalizePublicSkillSearchItem(value: unknown): PublicSkillSearchGroup | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }

  const raw = value as RawPublicSkillSearchItem
  const packageName = asString(raw.packageName)
  const skillName = asString(raw.name)
  if (!packageName || !skillName) {
    return undefined
  }

  const title = asString(raw.title) ?? skillName
  const version = asString(raw.packageVersion) ?? asString(raw.version) ?? "latest"
  const owner = asString(raw.owner)
  return {
    ...(asString(raw.description) ? { description: asString(raw.description) } : {}),
    displayName: title,
    ...(asString(raw.icon) ? { icon: asString(raw.icon) } : {}),
    maintainer: {
      ...(owner ? { id: owner } : {}),
      name: packageName.startsWith("oo-") ? "OOMOL" : packageName.replace(/^@/, "").split("/")[0] || packageName,
    },
    packageName,
    skills: [
      {
        ...(asString(raw.description) ? { description: asString(raw.description) } : {}),
        name: skillName,
        title,
      },
    ],
    version,
    visibility: normalizeSearchVisibility(raw.visibility),
  }
}

function mergePublicSkillSearchGroups(groups: PublicSkillSearchGroup[]): PublicSkillSearchGroup[] {
  const byPackage = new Map<string, PublicSkillSearchGroup>()
  for (const group of groups) {
    const key = `${group.packageName}@${group.version}`
    const existing = byPackage.get(key)
    if (!existing) {
      byPackage.set(key, group)
      continue
    }

    const skillNames = new Set(existing.skills.map((skill) => skill.name))
    byPackage.set(key, {
      ...existing,
      skills: [
        ...existing.skills,
        ...group.skills.filter((skill) => {
          if (skillNames.has(skill.name)) {
            return false
          }
          skillNames.add(skill.name)
          return true
        }),
      ],
    })
  }
  return Array.from(byPackage.values())
}

function createPublicSkillSearchFallbackPackage(group: PublicSkillSearchGroup): PublicSkillPackage {
  const icon = resolvePackageAssetIconSource(group.icon, group.packageName, group.version)
  return {
    ...(group.description ? { description: group.description } : {}),
    displayName: group.displayName,
    ...(icon ? { icon } : {}),
    id: `${group.packageName}@${group.version}`,
    isTemplate: false,
    maintainers: [group.maintainer],
    name: group.packageName,
    skills: group.skills,
    version: group.version,
    visibility: group.visibility,
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function normalizeSearchVisibility(value: unknown): PublicSkillPackage["visibility"] {
  return value === "private" || value === "public" ? value : "unknown"
}
