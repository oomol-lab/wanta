# Wanta 开源准备度审计

> 状态：In progress
>
> 范围：基于当前仓库工作树进行第一轮技术审计。许可证和商标结论必须由 OOMOL 法务或授权负责人确认；本文只记录可验证事实、阻塞项、责任决策和验收条件。

## 1. 审计结论

当前仓库尚不满足正式公开发布条件，但可以开始开源架构改造。核心代码具备较好的工程和文档基础，首轮发现的发布阻塞项集中在许可证、私有 IPC 包、oo 二进制与内置 Skills 的再分发边界、fresh clone 安装链和社区/官方发行路径分离。

| 等级        | 含义                                       |
| ----------- | ------------------------------------------ |
| Blocker     | 不解决就不能把仓库作为可运行的开源项目发布 |
| Decision    | 需要产品、法务或依赖所有者作出明确选择     |
| Engineering | 已知工程改造，可以在仓库内实施和验证       |
| Verified    | 当前工作树已经获得可重复的技术证据         |

## 2. 发布阻塞项

### 2.1 根仓库缺少开源许可证

- 等级：Blocker
- 当前事实：仓库根目录没有 `LICENSE`、`NOTICE`、`TRADEMARKS.md` 或 `THIRD_PARTY_NOTICES.md`；`package.json` 也没有 `license` 字段。
- 风险：公开可读不等于获得复制、修改和再分发授权，社区无法在明确许可下使用代码。
- 决策：确认主代码许可证，计划优先评估 Apache-2.0；同时单独确认 Wanta/OOMOL 名称、Logo、图标和协议标识的商标政策。
- 验收：许可证和商标政策经授权负责人确认，文件进入根目录，package metadata 与之保持一致。

### 2.2 私有 IPC 包阻止 fresh clone 安装

- 等级：Blocker
- 当前事实：`@oomol/connection@0.2.28` 和 `@oomol/connection-electron-adapter@0.2.12` 从 GitHub Packages 安装；`.npmrc` 将 `@oomol` scope 指向 `npm.pkg.github.com`；`package-lock.json` 记录私有下载地址；开发文档要求具有 `read:packages` 的 PAT。
- 补充事实：两个已安装包的 `package.json` 均未声明 `license`，包目录中也未发现许可证或 Notice 文件。
- 风险：外部贡献者在依赖解析阶段收到 401，无法执行 `npm install`；包的公开与再分发权也未形成可验证信息。
- 决策顺序：
  1. 优先将两个包以明确许可证发布为公开包；
  2. 如果不适合独立发布，将实现迁入仓库 workspace packages；
  3. 如果代码无法公开，替换 IPC 层并保留凭证不进入 Renderer 的安全边界。
- 验收：无 PAT 的 community CI 可以执行 `npm ci`，lockfile 不再引用需要认证的包地址。

### 2.3 oo CLI 和导出 Skills 的再分发边界不明确

- 等级：Blocker / Decision
- 当前事实：
  - postinstall 默认下载 oo CLI 到被 gitignore 的 `.oo-bin/`；
  - postinstall 再通过 oo 导出 Skills 到被 gitignore 的 `resources/skills/`；
  - dev 的 `predev` 当前要求 oo 存在；
  - 官方打包会把 oo 和导出的 Skills 放入应用资源；
  - 当前仓库不包含可供社区审阅的 oo 或导出 Skills 许可证文件。
- 风险：社区核心仍依赖不可审阅的二进制下载；官方包和社区自构建包的再分发权无法从仓库判断；缺少 oo 会阻止当前 dev 金路径。
- 决策：确认 oo CLI 和每个内置 Skill 的源码公开、下载、修改、打包和再分发权。
- 工程方向：local runtime 不依赖 oo；community install 可以跳过下载和导出；只有启用 OOMOL Connector capability 时才要求 oo；官方发行包可保留受控的资源准备流程。
- 验收：无 `.oo-bin` 的环境可以启动 local runtime；社区构建不会隐式宣称拥有未确认的二进制或 Skill 再分发权。

### 2.4 开源核心仍被 OOMOL 登录门控

- 等级：Engineering
- 当前事实：`src/App.tsx` 的 AuthGate 在未登录时只显示 LoginRoute；主进程只有获得 OOMOL session token 后才创建 AgentManager；会话列表依赖已登录团队 workspace。
- 风险：即使源码公开，用户仍无法免登录验证聊天、本地工具和自定义模型。
- 处理：按 `docs/open-source-plan.md` 的 runtime capability、本地 workspace、BYOK Agent 和无登录 AppShell 阶段实施。
- 验收：清空 OOMOL Cookie 后仍能进入主界面，并在配置 custom model 后完成本地 Agent 任务。

## 3. 已确认的第三方许可证信息

以下信息来自当前已安装包的 `package.json`，正式 Notice 仍需生成完整的直接和传递依赖清单：

| 组件                                 | 当前版本 | 包声明许可证 | 备注                                     |
| ------------------------------------ | -------- | ------------ | ---------------------------------------- |
| `opencode-ai`                        | 1.17.13  | MIT          | 仍需确认随应用分发二进制时的 Notice 要求 |
| `@opencode-ai/sdk`                   | 1.17.13  | MIT          | 与 OpenCode 三包版本锁定策略保持一致     |
| `wiki-graph`                         | 0.3.0    | Apache-2.0   | 仓库指向 OOMOL 的公开 GitHub 项目        |
| `@univerjs/core`                     | 0.25.1   | Apache-2.0   | Univer 完整工作簿能力必须保留            |
| `@univerjs/preset-sheets-core`       | 0.25.1   | Apache-2.0   | 需要纳入第三方 Notice                    |
| `streamdown`                         | 2.5.0    | Apache-2.0   | 聊天 Markdown 渲染依赖                   |
| `react`                              | 19.2.7   | MIT          | 需要纳入完整依赖审计                     |
| `@oomol/connection`                  | 0.2.28   | 未声明       | 发布阻塞项                               |
| `@oomol/connection-electron-adapter` | 0.2.12   | 未声明       | 发布阻塞项                               |

该表不是完整的法律清单。正式发布前需要从 lockfile 生成全部直接和传递依赖的许可证报告，并人工处理多许可证、缺失许可证、二进制附带许可证、字体、图标、Logo 和 vendored 源码。

## 4. 品牌与素材

### 4.1 Wanta/OOMOL 品牌

- `electron/branding.ts` 已经是品牌标识的单一代码来源，有利于第三方换牌；
- `resources/branding/` 包含应用图标和 Logo，需要明确其商标和再发行许可；
- deep-link scheme、appId、productName 和更新路径属于官方发行身份，社区 fork 不应默认沿用；
- README 应明确代码许可证不自动授予 Wanta/OOMOL 商标使用权。

### 4.2 第三方服务 Logo

- 登录页和连接器 UI 使用第三方服务图标；
- `@iconify-icons/simple-icons` 提供图标数据，但每个品牌仍可能有独立商标使用约束；
- 正式发布前应确认展示场景、归属说明和第三方 fork 的默认素材策略。

## 5. 凭证与秘密审计

### 5.1 当前工作树

- 已对排除 `.git`、`node_modules`、构建产物和 Electron 下载目录后的当前工作树执行高信号模式扫描；
- 未发现 GitHub PAT、常见 `sk-` API Key、AWS access key 或 PEM/OpenSSH private key 的高信号匹配；
- `.npmrc` 只包含 registry 映射，不包含 token；
- 当前结论不覆盖低熵口令、业务自定义凭证格式或 Git 历史。

### 5.2 Git 历史

- 状态：Pending；
- 必须使用专用 secret scanner 扫描全部 refs 和历史对象，且输出不得把真实秘密复制到公开日志；
- 发现真实秘密时先轮换，再评估历史重写；
- 删除当前文件或添加 `.gitignore` 不能撤销历史泄露。

### 5.3 现有安全边界

- OOMOL session token 只存在于 Electron cookie 与主进程运行态；
- `auth.json` 只保存 profile，并保持 0600 和原子写；
- `AuthManager` 不注册为 RPC service，Renderer 只能访问薄门面；
- deep-link 日志要求脱敏；
- OpenCode sidecar 通过内存环境接收 token，配置不落盘。

开源改造不得弱化这些边界。后续 BYOK 成为默认能力后，还必须将 custom model API Key 从普通模型元数据迁移到系统安全存储。

## 6. 构建与发布路径

### 6.1 当前官方路径

- PR 和 release workflow 都依赖 GitHub Packages；
- Windows release 使用 self-hosted runner 和签名设备；
- macOS release 依赖公司签名、公证和发布基础设施；
- 自动更新指向 OOMOL 官方静态分发路径；
- 这些配置可以保留为官方发行路径，但不能成为 community build 的前置条件。

### 6.2 目标双路径

Community build：

- 无 PAT；
- 无 OOMOL Cookie；
- 可跳过 oo 和官方 Skills；
- 可以执行 install、lint、format、ts-check、test 和 build；
- 默认不上传、不签名、不发布，也不冒用官方更新渠道。

Official OOMOL build：

- 保留 oo、官方 Skills、Connector、签名、公证和更新；
- 保留当前 endpoint 和版本钉死纪律；
- 与社区核心共享同一代码库，通过明确 capability 和资源准备步骤组合。

## 7. 第一轮工程实践

本轮已经开始 runtime foundation：

- 新增无凭证的 `RuntimeCapabilities` 类型；
- 将本地能力与 OOMOL 托管能力分开表达；
- capability 摘要明确禁止携带 `sessionToken`、`authToken` 或 `apiKey`；
- 在 local Agent 真正落地前，能力计算可以显式保持 `localAgentAvailable: false`，避免提前宣称尚未实现的能力；
- ChatService 已提供 capability 查询和变更事件，主进程在 OOMOL runtime 装配与退出时更新该事实源；
- 增加 local、未就绪和 OOMOL 三种组合的纯函数测试。

下一工程切片应让 Renderer 消费该能力摘要，但不能在本地 Agent 尚未实现时直接移除 AuthGate。推荐顺序：

1. 让 Renderer 读取无凭证 capability；
2. 将 `signed_out` 语义拆为 OOMOL unauthenticated 与 Agent `model_required`；
3. 引入 local workspace；
4. 允许 custom model 在无 OOMOL token 时启动；
5. 最后移除启动登录墙并完成 UI 实机验证。

## 8. 发布前检查清单

- [ ] 主代码许可证已批准并落盘；
- [ ] 商标政策已批准并落盘；
- [ ] 私有 IPC 包已公开、迁入或替换；
- [ ] oo CLI 和内置 Skills 的再分发边界明确；
- [ ] 完整依赖许可证报告和 Notice 已生成；
- [ ] Git 历史 secret scan 完成；
- [ ] custom model API Key 已迁移安全存储；
- [ ] community install 不需要 PAT；
- [ ] community local runtime 不需要 oo；
- [ ] 未登录 BYOK 聊天通过实机验证；
- [ ] 本地和团队 workspace 数据边界通过测试；
- [ ] OOMOL 登录、Connector、Billing 和 Skills 无回归；
- [ ] macOS、Windows 和 Linux 社区构建策略明确；
- [ ] README、CONTRIBUTING、SECURITY 和第三方声明完整；
- [ ] fresh clone 由未参与开发的人独立验证。
