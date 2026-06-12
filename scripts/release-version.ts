// CI 发版版本号计算（compute-version job 调用，替代易碎的 bash 算术）。
//
// 渠道规则（见 docs/development.md §发布）：
// - stable：显式 X.Y.Z，或对最新 stable tag 自动 bump（beta tag 一律不参与，
//   否则 v1.0.1-beta.2 这类 tag 会让 patch 段算术爆炸）。
// - beta：显式 X.Y.Z-beta.N，或自动计算 base = max(最新 stable 的 patch+1, 既存 beta 的最高 base)，
//   N = 该 base 下最高 beta 序号 + 1。patch+1 是唯一安全基线：它是下一个正式版的最小可能值，
//   保证 base-beta.N < 任何未来 stable，beta 用户必然收敛。
//
// 用法：git tag -l 'v*' | node --experimental-strip-types scripts/release-version.ts \
//         --channel beta --expected "" --bump patch
// 输出：单行 JSON {"version":"X.Y.Z[-beta.N]","refreshBeta":bool} 到 stdout（jq 解析）；
// 错误到 stderr 并以非零退出。refreshBeta=false 表示本次 stable 低于既存 beta 基线，
// CI 须跳过 beta*.yml 上传/刷新，否则 beta 渠道指针会倒退。

import { parseArgs } from "node:util"

export type ReleaseChannel = "stable" | "beta"
export type VersionBump = "patch" | "minor" | "major"

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  /** stable 为 null；beta 为序号 N。 */
  beta: number | null
}

/** 解析 "1.2.3" / "1.2.3-beta.4"（可带 v 前缀）；其余形态（含 alpha/rc、前导零）返回 null。 */
export function parseVersion(value: string): ParsedVersion | null {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.(0|[1-9]\d*))?$/.exec(value)
  if (!match) {
    return null
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    beta: match[4] === undefined ? null : Number(match[4]),
  }
}

/** semver 排序：基线逐段比较；同基线时 beta < stable，beta 间按 N。 */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  const base = a.major - b.major || a.minor - b.minor || a.patch - b.patch
  if (base !== 0) {
    return base
  }
  if ((a.beta === null) !== (b.beta === null)) {
    return a.beta === null ? 1 : -1
  }
  return (a.beta ?? 0) - (b.beta ?? 0)
}

export function formatVersion(version: ParsedVersion): string {
  const base = `${version.major}.${version.minor}.${version.patch}`
  return version.beta === null ? base : `${base}-beta.${version.beta}`
}

function maxVersion(versions: ParsedVersion[]): ParsedVersion | null {
  return versions.reduce<ParsedVersion | null>(
    (best, v) => (best === null || compareVersions(v, best) > 0 ? v : best),
    null,
  )
}

export interface ComputeInput {
  channel: ReleaseChannel
  /** 显式版本（可空字符串 = 自动计算；可带 v 前缀）。 */
  expected: string
  bump: VersionBump
  /** 仓库现有 tag 列表（git tag -l 'v*' 输出；非本格式的 tag 自动忽略）。 */
  tags: string[]
}

export interface ComputedRelease {
  version: string
  /** stable 低于既存 beta 基线时为 false：CI 跳过 beta*.yml 上传/刷新，防指针倒退。 */
  refreshBeta: boolean
}

export function computeReleaseVersion(input: ComputeInput): ComputedRelease {
  const version = computeVersionString(input)
  return { version, refreshBeta: shouldRefreshBetaPointer(input.channel, version, input.tags) }
}

/** stable 发布是否连带刷新 beta 渠道指针：版本须不低于既存 beta 的最高基线（beta 发布恒刷新）。 */
export function shouldRefreshBetaPointer(channel: ReleaseChannel, version: string, tags: string[]): boolean {
  if (channel === "beta") {
    return true
  }
  const released = parseVersion(version)
  if (!released) {
    return false
  }
  const betaBases = tags
    .map(parseVersion)
    .filter((v): v is ParsedVersion => v !== null && v.beta !== null)
    .map((v) => ({ ...v, beta: null }))
  const maxBetaBase = maxVersion(betaBases)
  // stable == beta 基线时 semver 上 stable 更大（1.0.1 > 1.0.1-beta.N），收敛成立、应当刷新。
  return maxBetaBase === null || compareVersions(released, maxBetaBase) >= 0
}

function computeVersionString(input: ComputeInput): string {
  const parsed = input.tags.map(parseVersion).filter((v): v is ParsedVersion => v !== null)
  const stableTags = parsed.filter((v) => v.beta === null)
  const betaTags = parsed.filter((v) => v.beta !== null)
  const latestStable = maxVersion(stableTags) ?? { major: 0, minor: 0, patch: 0, beta: null }

  if (input.channel === "stable") {
    if (input.expected) {
      const explicit = parseVersion(input.expected)
      if (!explicit || explicit.beta !== null) {
        throw new Error(`Invalid stable version: ${input.expected} (expected: X.Y.Z)`)
      }
      // 防回退：手滑输入旧版本会把 latest*.yml 指针倒拨、向全量用户分发旧版。
      if (stableTags.length > 0 && compareVersions(explicit, latestStable) <= 0) {
        throw new Error(
          `Stable version ${formatVersion(explicit)} must be greater than latest stable tag ${formatVersion(latestStable)}`,
        )
      }
      return formatVersion(explicit)
    }
    switch (input.bump) {
      case "major":
        return formatVersion({ major: latestStable.major + 1, minor: 0, patch: 0, beta: null })
      case "minor":
        return formatVersion({ major: latestStable.major, minor: latestStable.minor + 1, patch: 0, beta: null })
      case "patch":
        return formatVersion({ ...latestStable, patch: latestStable.patch + 1 })
    }
  }

  if (input.expected) {
    const explicit = parseVersion(input.expected)
    if (!explicit || explicit.beta === null) {
      throw new Error(`Invalid beta version: ${input.expected} (expected: X.Y.Z-beta.N)`)
    }
    // 防倒灌：显式 beta 必须大于现有全部 tag，否则 beta.yml 指针会倒退/对 beta 用户不可见。
    const latestAny = maxVersion(parsed)
    if (latestAny && compareVersions(explicit, latestAny) <= 0) {
      throw new Error(
        `Beta version ${formatVersion(explicit)} must be greater than latest tag ${formatVersion(latestAny)}`,
      )
    }
    return formatVersion(explicit)
  }

  // 自动 beta：基线取 max(最新 stable 的 patch+1, 既存 beta 的最高基线)。
  // 后者覆盖两种情形：团队手动抬高过基线（沿用）；stable hotfix 超车（patch+1 自然反超）。
  const candidate: ParsedVersion = { ...latestStable, patch: latestStable.patch + 1, beta: null }
  const maxBetaBase = maxVersion(betaTags.map((v) => ({ ...v, beta: null })))
  const base = maxBetaBase && compareVersions(maxBetaBase, candidate) > 0 ? maxBetaBase : candidate
  const peers = betaTags.filter((v) => v.major === base.major && v.minor === base.minor && v.patch === base.patch)
  const nextN = peers.reduce((max, v) => Math.max(max, v.beta ?? 0), 0) + 1
  return formatVersion({ ...base, beta: nextN })
}

async function readLines(stream: NodeJS.ReadableStream): Promise<string[]> {
  let data = ""
  for await (const chunk of stream) {
    data += chunk
  }
  return data
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      channel: { type: "string" },
      expected: { type: "string", default: "" },
      bump: { type: "string", default: "patch" },
    },
  })
  const channel = values.channel
  const bump = values.bump
  if (channel !== "stable" && channel !== "beta") {
    throw new Error(`--channel must be stable|beta, got: ${String(channel)}`)
  }
  if (bump !== "patch" && bump !== "minor" && bump !== "major") {
    throw new Error(`--bump must be patch|minor|major, got: ${String(bump)}`)
  }
  const tags = await readLines(process.stdin)
  const result = computeReleaseVersion({ channel, expected: values.expected ?? "", bump, tags })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (process.argv[1]?.endsWith("release-version.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
