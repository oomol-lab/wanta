// R1：产品品牌相关标识的**单一来源**。改名只动这一处。
//
// 注意（R1 例外）：`@oomol/connection` 的 ServiceName 字符串前缀虽放在这里集中，
// 但 oo-cli 的 `OO_` 环境变量前缀、connector 的 `x-oomol-*` 头等属于外部协议契约，
// **不随产品名改**，不在本文件管辖。
//
// 本文件为纯常量、无运行时依赖，可被 main / preload / renderer / scripts 共同 import。

export const branding = {
  /** 产品显示名（窗口标题、应用菜单、侧边栏 logo 文案）。 */
  appName: "Wanta",
  /** OOMOL 组织/服务品牌名（如内置模型 provider、官方技能维护者）。 */
  organizationName: "OOMOL",
  /** 生产包 appId（须与 electron-builder.json5 的 appId 一致）。 */
  appId: "com.oomol.wanta",
  /** 本地开发版 Electron 的 bundle id（download-electron 改写 .electron-dist 的 plist）。 */
  devBundleId: "com.oomol.wanta-local",
  /** 生产 deep-link scheme（须与 electron-builder.json5 的 protocols 一致）。 */
  protocolScheme: "wanta",
  /** 本地开发 deep-link scheme。 */
  devProtocolScheme: "wanta-local",
  /** @oomol/connection ServiceName 的命名空间前缀（产品内部约定）。 */
  servicePrefix: "wanta",
  /** preload 暴露到 renderer 的全局 bridge 名（window.<windowBridge>）。 */
  windowBridge: "wanta",
  /** 用户私有数据目录名（传给 oo-cli 的 OO_*_DIR 等使用）。 */
  storeDirName: "wanta",
  /** localStorage / 前端持久化 key 前缀。 */
  storageKeyPrefix: "wanta",
  /** 自动更新 OSS/CDN 路径段（完整基址在 domain.ts 由 endpoint 派生，见 R2/阶段 6）。 */
  updateFeedPath: "release/apps/wanta",
} as const

/** 拼接一个 ServiceName 字符串，如 `serviceName("ping-service") === "wanta/ping-service"`。 */
export function serviceName(name: string): string {
  return `${branding.servicePrefix}/${name}`
}

/** 拼接一个带前缀的前端持久化 key，如 `storageKey("theme") === "wanta.theme"`。 */
export function storageKey(name: string): string {
  return `${branding.storageKeyPrefix}.${name}`
}
