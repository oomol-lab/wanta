# 开发指南：环境、工作流、测试、打包与 CI

> 相关：[architecture.md](architecture.md)（模块地图）· [conventions.md](conventions.md)（编码约定）

## 1. 环境准备

- **Node >= 22**（package.json engines；PR CI 钉 Node 24，release CI 用 `lts/*`——当前解析为 24）。npm + package-lock.json。
- **私有包鉴权**：`@oomol/connection*` 来自 GitHub Packages（`.npmrc`：`@oomol:registry=https://npm.pkg.github.com`），本地需要带 `read:packages` 的 PAT（一般配在全局 `~/.npmrc`），否则 `npm install` 401。注意两种失败的严重性不同：私有包 401 发生在依赖解析阶段、**致命**；下面两个 postinstall 下载脚本才是 best-effort（仅 warn）——PAT 缺失时哪怕只看到一堆 warn 也不能继续，`@oomol/connection` 没装上 dev 起不来。
- `npm install` 的 postinstall 串联两个 best-effort 脚本（失败仅 warn 不阻断）：
  - `scripts/download-electron.ts` → 下载 dev 专用 Electron 副本到 `.electron-dist/` 并改写 macOS Info.plist 为 `com.oomol.wanta-local` / `wanta-local` scheme（dev deep-link 用）。`ELECTRON_SKIP_BINARY_DOWNLOAD=1` 跳过。
  - `scripts/download-oo.ts` → 下载 oo 二进制到 `.oo-bin/`（版本锁定见 `scripts/oo-cli.ts` 的 `OO_CLI_VERSION`；含 sha512 integrity 校验与 `chmod 0o755`）。`OO_SKIP_BINARY_DOWNLOAD=1` 跳过。

## 2. .env 配置

```bash
cp .env.example .env.local   # .env.local 已 gitignore
```

- `WANTA_ENDPOINT`：endpoint 主域，缺省 `oomol.com`，对接开发环境改 `oomol.dev`。**读取规则**（`vite.config.ts` 的 `resolveOoEndpoint`）：dev 与 vitest 经 `loadEnv` 读 `.env(.local)`；**build 刻意不读文件**（防开发域名进发布包）；两种模式都尊重显式环境变量，内部联调包用 `WANTA_ENDPOINT=oomol.dev npm run build`。已知坑：`oomol.dev` 的 LLM 网关曾对 Auto/`oopilot` 返回 403 "Model disabled"（后端限制，非代码问题），dev endpoint 主要用于 connector 联调，聊天 403 时先怀疑网关侧。
- `WANTA_OO_BIN`（可选，进程环境变量而非 .env 文件读取）：覆盖 oo 二进制路径，`WANTA_OO_BIN=/abs/path/to/oo npm run dev`。设置后 predev 守卫跳过检查。

## 3. 日常开发

```bash
npm run dev    # predev 先跑 scripts/check-oo.ts（.oo-bin/oo 缺失则报错退出）
               # vite dev server 端口 5273；vite-plugin-electron 同时拉起主进程
npm run dev:no-electron
               # 只启动 vite + electron bundle watch，不自动拉起 Electron；适合不需要 UI 窗口的代码侧调试
```

- vite dev server 固定端口 `5273` 且 `strictPort=true`：如果已有 `npm run dev` 占用端口，新的 dev 进程会直接失败，避免悄悄切到 `5274+` 后再拉起第二个 Electron。需要临时禁用 Electron 自动启动时，也可用 `WANTA_ELECTRON_AUTO_START=0 npm run dev`。
- `.electron-dist` 存在时 vite 自动设 `ELECTRON_OVERRIDE_DIST_PATH`，dev 用带 `wanta-local` scheme 的 Electron（菜单栏显示 dev 身份），浏览器登录回跳才能命中 dev 实例。
- dev 的 userData 在 `~/Library/Application Support/wanta`（macOS）；agent 数据在其下 `agent/`（workspace / isolation / oo-store）。
- 提代码必须走临时分支 + PR：先把本地 `main` 对齐 `origin/main`，再从 `main` 拉一次性分支（如 `codex/<task>`、`ci/<task>`、`fix/<task>`）。改动完成并通过质量门后推送临时分支，开 PR 到 `oomol/lumo:main`，由 PR 合并回 `main`。不要直接在 `main` 上提交或推送。PR 合并后同步最新 `main`，删除本地临时分支，并删除 fork/远端上的同名临时分支。所有 Git 操作中的人类可读文本必须用英文，包括 commit message、branch name、PR title、PR description、PR review/comment、tag/release note。
- 改动后质量门四件套：`npm run ts-check && npm run lint && npm run format && npm test`。

## 4. 测试

- `npm test` = `vitest run`；`vitest.config.ts` include `electron/**/*.test.ts`、`src/**/*.test.ts`、`scripts/**/*.test.ts`，environment node，并以与 vite 相同的 loadEnv 机制注入 `__OO_ENDPOINT__`（测试断言从 `ooEndpoint` 派生，勿写死具体域名，保证本地/CI 都确定性通过）。
- 现有测试均为纯函数单测：`electron/agent/agent.test.ts`、`event-translator.test.ts`、`auth/browser-login.test.ts`、`auth/store.test.ts`、`connections/summary.test.ts`、`domain.test.ts`、`settings/store.test.ts`、`src/i18n/i18n.test.ts`、`scripts/oo-cli.test.ts`。
- **真实运行验证**用 `.wanta-dev/` 下的手工 smoke 脚本（gitignore，不进打包、不被 lint/format/tsc 管）：`agent-smoke.ts`（headless 金路径）、`chat-stream-smoke.ts`、`connections-smoke.ts`、`r4-smoke.ts`、`system-probe.ts`（验证 body.system 是追加非覆盖）、`spike.mjs`。跑法：`OO_API_KEY=... node --experimental-strip-types .wanta-dev/xxx.ts`（smoke 脚本直接构造 `AgentManager`，不走浏览器登录；`AgentManager` 选项现为 `authToken`，传会话 token，环境变量名沿用 `OO_API_KEY` 仅作为 oo-cli 的外部契约——网关层统一鉴权）。**fresh clone 没有这些脚本**（仅存原开发机）：缺失时按 [architecture.md §2](architecture.md) 直接构造 `AgentManager` 自行编写（`electron/agent/` 是 electron-free 的）。
- **UI 实机验证旁路**（dev 专用 env，生产无害）：`VITE_WANTA_SMOKE`（AppShell 就绪后自动发一条消息，`AppShell.tsx`）、`VITE_WANTA_ROUTE=settings`（直开设置页）、`VITE_WANTA_LOCALE`（强制 locale，`src/i18n/i18n.ts`）；配合 macOS `screencapture` 截图取证。
- **已知验证缺口**（据会话记录从未实机跑通，排查时勿默认其已验证）：放开 tools 权限后的 bash 工具实调、ai-elements 迁移后的实机视觉效果（当时无显示器环境）、真实账号的浏览器登录回跳（需真人登录）。

## 5. Lint / Format / 类型检查

- `npm run lint` = `oxlint .`（`.oxlintrc.json`：correctness=error；`react/only-export-components` error，但 `src/components/ui/**` 与 `src/components/ai-elements/**` 两个 vendored 目录 override 关闭；ignorePatterns 含 `.wanta-dev`）。
- `npm run format` = `oxfmt --check .`（`.oxfmtrc.json`：printWidth 120、**无分号**、双引号、trailingComma all、sortImports type 在前、sortTailwindcss 识别 cn/clsx/cva）。
- `npm run ts-check` = `tsgo -p tsconfig.json`（TypeScript native preview，`@typescript/native-preview`）。tsconfig：strict、verbatimModuleSyntax、module Preserve、allowImportingTsExtensions、noEmit；include src/electron/scripts/vite.config.ts。

## 6. 打包 / 签名 / 公证 / 自动更新

```bash
npm run build:mac     # = build:app + prepare:binaries + electron-builder --mac（另有 build:win / build:linux / build:electron）
```

- `scripts/prepare-binaries.ts`：把 opencode（`node_modules/opencode-ai/bin/opencode.exe`，所有平台固定此文件名）与 oo（`.oo-bin/`，缺失则现场下载）复制到 `resources/bin/` 并 chmod 755。
- `electron-builder.json5`：appId `com.oomol.wanta`、asar、output `release/${version}`、protocols `wanta`、files 仅 dist + dist-electron（排除 map/d.ts，**不含 electron/ 源码与测试**）、extraResources `resources/bin → bin`（二进制不能进 asar）、afterPack `scripts/electron-builder-after-pack.cjs`（删约 20MB 的 LICENSES.chromium.html；用 .cjs 因 electron-builder require 不支持 .ts）。mac dmg+zip arm64；win nsis x64（signtool 证书指纹）；linux AppImage。
- **签名/公证只能在 CI 完成**，本地只产未签名包（mac 证书、Apple ID、win USB 证书都在 CI secrets）。macOS 公证要求 app 内**每个可执行文件**都签名 + Hardened Runtime——`Resources/bin` 下的 oo 与 opencode 也在范围内；新增任何捆绑二进制（或改 extraResources 布局）须纳入签名/公证范围，否则公证会失败。
- 自动更新（`electron/update/`，common.ts 契约 + node.ts 实现 + channel.ts 纯函数）：electron-updater generic provider，feed = `https://static.<ep>/release/apps/wanta/<platform>/<arch>`；仅打包态；`autoDownload=false`（下载/安装由设置页 UI 显式触发）、`autoInstallOnAppQuit=true`。**双渠道**：stable 拉 `latest*.yml`，beta 拉 `beta*.yml`；渠道经 `setFeedURL` 的 `channel` 字段传入（**勿用 `autoUpdater.channel` setter**——它会静默把 `allowDowngrade` 置 true），并显式 `allowDowngrade=false`（beta 切回 stable 默认等下一个正式版收敛，绝不自动降级）。渠道合并规则 `用户设置 ?? (自身版本含 -beta ? beta : stable)`（`channel.ts`），持久化在 settings.json 的 `updateChannel` 键。
- `electron-builder.json5` 的 `generateUpdatesFilesForAllChannels: true`：stable 构建同时产出 `beta*.yml`（指向该 stable），beta 用户在正式版发布后立即收敛；generic provider 由版本号 `-beta.N` 自动推导渠道（detectUpdateChannel 默认开）。`electron-builder` 与 `electron-updater` **精确钉死**（渠道行为对版本敏感，升级前先核对 GenericProvider/PublishManager 的渠道逻辑未变）。

## 7. CI（.github/workflows/）

- **pr.yml**（PR → main，ubuntu，Node 24）：npm ci（`NODE_AUTH_TOKEN=GITHUB_TOKEN` 读私有 @oomol 包；设 `ELECTRON_SKIP_BINARY_DOWNLOAD=1` + `OO_SKIP_BINARY_DOWNLOAD=1` 跳过二进制下载）→ lint → format → ts-check → test → build。
- **release.yml**（workflow_dispatch，输入 channel stable/beta + expected_version + version_bump）：`compute-version`（版本计算在 `scripts/release-version.ts`，有 vitest 覆盖——stable 自动 bump **过滤全部 beta tag**，beta 基线 = max(最新 stable 的 patch+1, 既存 beta 最高基线)、N 递增）→ `release-mac`（macos-latest：导入证书、签名+公证、`npm version` 改写版本、build:mac、渠道 yml 校验、rclone 上传阿里云 OSS `oomol-static-cn-prod/release/apps/wanta`，OIDC）+ `release-win`（self-hosted Windows x64 runner + USB 证书；**勿依赖系统工具如 tar 存在**）→ `create-release`（打 tag + GitHub release，stable `--latest` / beta `--prerelease`）→ `refresh-cdn-cache`（按渠道刷新指针：stable 刷 latest\*+beta\* 4 个，beta 只刷 beta\* 2 个）。无 linux 发布 job。secret 名照搬 oo-desktop（`MACOS_CERTIFICATE` / `MACOS_CERTIFICATE_PWD` / `APPLEID` / `APPLEID_PASS` / `APPLE_TEAM_ID` 等），勿自拟。
- **双渠道发布纪律**：rclone 上传是 include 白名单——beta 发布绝不触碰 `latest*.yml`（这就是 stable 指针的保护栏）；stable 发布连带上传+刷新 `beta*.yml`（收敛 beta 用户），**除非** compute-version 算出 `refresh_beta=false`（本次 stable 低于既存 beta 最高基线，跳过 beta 指针防倒退）；mac/win 各有渠道 yml 硬校验步骤（缺文件/指错版本在上传前大声失败）。generic provider 对缺失渠道 yml 是硬错（`ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`，无回退），所以 beta 渠道一旦开张，两个平台目录的 `beta*.yml` 必须常在。首个 beta 前必须先发过一个带渠道感知 updater 的 stable。整个 workflow 在 `release` 并发组内串行（并发 dispatch 会算出同一版本竞写 OSS）。

## 8. 特殊目录速查（均 gitignore，除 resources/ 本身）

| 目录                     | 角色                                         | 产生者                                     |
| ------------------------ | -------------------------------------------- | ------------------------------------------ |
| `.oo-bin/`               | dev/打包共用的 oo 二进制落地点               | postinstall `scripts/download-oo.ts`       |
| `.electron-dist/`        | dev 专用 Electron 副本（wanta-local scheme） | postinstall `scripts/download-electron.ts` |
| `resources/bin/`         | 打包前二进制中转（→ extraResources）         | `scripts/prepare-binaries.ts`              |
| `.wanta-dev/`            | 手工 smoke / 实验脚本，不进任何工具链        | 手写                                       |
| `dist/` `dist-electron/` | vite 构建产物（renderer / main+preload）     | `npm run build`                            |
| `release/`               | electron-builder 产物                        | `npm run build:*`                          |

## 9. 升级注意

- 升级 oo：只改 `scripts/oo-cli.ts` 的 `OO_CLI_VERSION`（`.version` 标记触发重新下载）。oo 上游 tarball 内二进制无 +x，任何直接使用 node_modules 内该二进制的路径都必须自己 chmod——不要回退到 npm 依赖方案。
- 升级 OpenCode：`opencode-ai` / `@opencode-ai/sdk` / `@opencode-ai/plugin` 三包**同版本**一起升，先在 `.wanta-dev/` 跑 smoke 验证（上游无 API 稳定承诺）。
- `opencode-ai` 必须留在 **devDependencies**（仅构建期供 prepare-binaries 取二进制，运行时用 extraResources 副本）；放 dependencies 会把 ~100MB 平台二进制重复打进 app.asar——整理依赖时勿"修正"。
- 升级 vendored ai-elements：对照 `.claude/skills/ai-elements/references/` 与 `skills-lock.json`，注意本仓库是裁剪版（见 [key-decisions.md §8](key-decisions.md)）。
