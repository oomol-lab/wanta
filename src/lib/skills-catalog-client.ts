import type {
  PublicSkillPackage,
  PublicSkillPackageCatalog,
  PublicSkillPackageMaintainer,
} from "../../electron/skills/common.ts"

import { normalizePublicSkillPackageCatalog, normalizeRegistrySkillPackageInfo } from "../../electron/skills/actions.ts"
import { registryBaseUrl, searchBaseUrl } from "@/lib/domain"
import { oomolFetch } from "@/lib/oomol-http"

// 技能 Discover 标签的注册表浏览/搜索请求在渲染层直接发起：原先这些是渲染业务驱动、却由主进程
// SkillService 代发的只读 GET。安装/更新（写盘 + oo CLI spawn + 刷新 agent）本就不是 fetch，仍留主进程。
// 公共目录匿名读取；"我发布的"用 httpOnly 会话 cookie 自动鉴权（oomolFetch 内 credentials:"include"），
// token 不进渲染层（守 R4）；域名从 @/lib/domain 派生（守 R2）。normalize* 复用主进程同款纯函数。

const publicSkillPackagePageSize = 100
const myPublishedSkillPackageInfoConcurrency = 10
const skillCatalogRequestTimeoutMs = 10_000

export interface MyPublishedSkillAccount {
  id: string
  name: string
  avatarUrl?: string
}

export interface ListPublicSkillPackagesInput {
  next?: string
  size?: number
}

export interface ListMyPublishedSkillPackagesInput {
  account: MyPublishedSkillAccount
  next?: string
}

export async function listPublicSkillPackages(
  input: ListPublicSkillPackagesInput = {},
): Promise<PublicSkillPackageCatalog> {
  const url = new URL("/v1/packages/-/skills-list", searchBaseUrl)
  const next = input.next?.trim()
  if (next) {
    url.searchParams.set("next", next)
  }
  if (input.size && Number.isFinite(input.size)) {
    url.searchParams.set("size", String(Math.min(Math.max(Math.trunc(input.size), 1), publicSkillPackagePageSize)))
  }
  const response = await oomolFetch(url, { timeoutMs: skillCatalogRequestTimeoutMs })
  if (!response.ok) {
    throw new Error(`Public Skill list request failed with status ${response.status}.`)
  }
  return normalizePublicSkillPackageCatalog(await response.text())
}

async function readMyPublishedSkillPackageList(next?: string): Promise<PublicSkillPackageCatalog> {
  const url = new URL("/v1/packages/-/my", searchBaseUrl)
  url.searchParams.set("size", "80")
  url.searchParams.set("lang", "en")
  const trimmed = next?.trim()
  if (trimmed) {
    url.searchParams.set("next", trimmed)
  }
  const response = await oomolFetch(url, { timeoutMs: skillCatalogRequestTimeoutMs })
  if (!response.ok) {
    throw new Error(`Published Skill package list request failed with status ${response.status}.`)
  }
  return normalizePublicSkillPackageCatalog(await response.text())
}

async function fetchRegistrySkillPackageInfo(
  packageName: string,
  maintainer: PublicSkillPackageMaintainer,
  options: { returnNullOnNotFound?: boolean } = {},
): Promise<PublicSkillPackage | null | undefined> {
  const url = new URL(`/-/oomol/package-info/${encodeURIComponent(packageName)}/latest`, registryBaseUrl)
  const response = await oomolFetch(url, { timeoutMs: skillCatalogRequestTimeoutMs })
  if (response.status === 404 && options.returnNullOnNotFound) {
    return null
  }
  if (!response.ok) {
    throw new Error(`Registry Skill package info request failed with status ${response.status}.`)
  }
  return normalizeRegistrySkillPackageInfo(await response.text(), maintainer)
}

async function readRegistrySkillPackageInfo(
  packageName: string,
  maintainer: PublicSkillPackageMaintainer,
): Promise<PublicSkillPackage | undefined> {
  return (await fetchRegistrySkillPackageInfo(packageName, maintainer)) ?? undefined
}

export async function readPublicSkillPackageByName(packageName: string): Promise<PublicSkillPackage | null> {
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
      { returnNullOnNotFound: true },
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
  const publishedPackages = await readMyPublishedSkillPackageList(input.next)
  const maintainer: PublicSkillPackageMaintainer = {
    id: input.account.id,
    name: input.account.name,
    url: input.account.avatarUrl,
  }
  const items = (
    await mapWithConcurrency(
      publishedPackages.items,
      myPublishedSkillPackageInfoConcurrency,
      async (publishedPackage) => {
        let packageInfo: PublicSkillPackage | undefined
        try {
          packageInfo = await readRegistrySkillPackageInfo(publishedPackage.name, maintainer)
        } catch (error) {
          console.warn("[wanta] failed to read my published skill package info:", error)
          packageInfo = undefined
        }
        return mergeMyPublishedPackage(publishedPackage, packageInfo)
      },
    )
  ).filter((item): item is PublicSkillPackage => Boolean(item))

  return {
    items: items.sort(compareMyPublishedPackages),
    next: publishedPackages.next,
    updatedAt: new Date().toISOString(),
  }
}
