// 渠道解析纯函数（无 electron 依赖，便于单测）。
//
// 渠道模型：用户可在设置里显式选择 stable / beta；未选择时按自身版本号推导——
// 直接下载 beta 安装包（版本形如 1.0.1-beta.2）的用户首跑即在 beta 渠道，
// 不会"自我切回" stable；正式包用户默认 stable。对应 electron-updater
// generic provider 的渠道文件：stable → latest*.yml，beta → beta*.yml。

export type UpdateChannel = "stable" | "beta"

/** 版本号是否带预发布段（如 1.0.1-beta.2）。 */
export function hasPrereleaseTag(version: string): boolean {
  return /^\d+\.\d+\.\d+-/.test(version)
}

/** 渠道合并规则：用户显式设置优先，否则按自身版本推导。非法持久化值按未设置处理。 */
export function resolveUpdateChannel(persisted: string | undefined, appVersion: string): UpdateChannel {
  if (persisted === "stable" || persisted === "beta") {
    return persisted
  }
  return hasPrereleaseTag(appVersion) ? "beta" : "stable"
}

/** electron-updater generic provider 的渠道名（决定拉取 latest*.yml 还是 beta*.yml）。 */
export function updaterChannelName(channel: UpdateChannel): "latest" | "beta" {
  return channel === "beta" ? "beta" : "latest"
}
