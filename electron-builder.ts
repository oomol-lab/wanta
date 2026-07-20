import { branding } from "./electron/branding.ts"

// @see - https://www.electron.build/configuration/configuration
// 阶段 0：未签名本地包。图标 / extraResources（oo + opencode 二进制）/ 签名公证
// 在后续阶段补齐；品牌标识从 electron/branding.ts 派生（R1）。
export default {
  $schema:
    "https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/scheme.json",
  appId: branding.appId,
  asar: true,
  asarUnpack: ["node_modules/sqlite3/**"],
  productName: branding.appName,
  directories: {
    buildResources: "resources",
    output: "release/${version}",
  },
  publish: {
    provider: "generic",
    url: "",
  },
  // 双渠道（stable/beta）：generic provider 由版本号 prerelease 段自动推导渠道
  // （1.2.3-beta.1 → beta*.yml；detectUpdateChannel 默认开启）。此开关让 stable 构建
  // 同时刷新 beta*.yml，beta 用户在正式版发布后立即收敛到 stable，无需等下一个 beta。
  // 多产出的 alpha*.yml 不在 CI 上传清单内，自然丢弃。
  generateUpdatesFilesForAllChannels: true,
  protocols: [
    {
      name: branding.protocolScheme,
      schemes: [branding.protocolScheme],
    },
  ],
  files: ["dist", "dist-electron", "!**/*.{map,d.ts}"],
  afterPack: "scripts/electron-builder-after-pack.cjs",
  // 内置 oo + opencode + rg 平台二进制（由 scripts/prepare-binaries.ts 在构建前复制到 resources/bin）。
  // 运行时 app.isPackaged 走 process.resourcesPath/bin。
  // resources/skills 是 oo 自带的 4 个内置 skill（同由 prepare-binaries.ts 导出）；运行时拷进 OpenCode
  // workspace 的 .opencode/skill/，使 Wanta agent 直接读到。
  extraResources: [
    {
      from: "resources/branding/icon.png",
      to: "icon.png",
    },
    {
      from: "resources/branding/icon.ico",
      to: "icon.ico",
    },
    {
      from: "resources/bin",
      to: "bin",
    },
    {
      from: "resources/skills",
      to: "skills",
    },
    {
      from: "resources/agent-tool-runtime",
      to: "agent-tool-runtime",
    },
  ],
  mac: {
    icon: "branding/icon.icns",
    electronLanguages: ["en", "zh_CN"],
    extendInfo: {
      NSMicrophoneUsageDescription: `${branding.appName} uses the microphone to record voice messages for chat input.`,
    },
    entitlements: "electron/entitlements.mac.plist",
    entitlementsInherit: "electron/entitlements.mac.plist",
    target: [
      {
        target: "dmg",
        arch: ["arm64"],
      },
      {
        target: "zip",
        arch: ["arm64"],
      },
    ],
    artifactName: "${productName}-${version}.${ext}",
  },
  win: {
    icon: "branding/icon.ico",
    electronLanguages: ["en-US", "zh-CN"],
    target: [
      {
        target: "nsis",
        arch: ["x64"],
      },
    ],
    // Windows 代码签名（CI 自托管 runner + USB 证书；指纹为 CI 配置，本地不签名）。
    signExts: [".exe", ".dll", ".node"],
    signtoolOptions: {
      certificateSha1: "9F84845385AA9282C764044D307EF4044B47E966",
      signingHashAlgorithms: ["sha256"],
    },
    artifactName: "${productName}-${version}-Setup.${ext}",
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
  },
  linux: {
    icon: "branding/icon.png",
    target: ["AppImage"],
    artifactName: "${productName}-${version}.${ext}",
  },
}
