# Wanta 开源准备度审计

> 状态：In progress
>
> 范围：基于当前仓库工作树进行第一轮技术审计。许可证和商标结论必须由 OOMOL 法务或授权负责人确认；本文只记录可验证事实、阻塞项、责任决策和验收条件。

## 1. 审计结论

当前仓库的开源核心、公共安装链和默认二进制准备已经可重复验证。两个 IPC 包已从公共 npm 匿名安装；
oo CLI 1.5.1 及其内置 Skills 由 MIT 授权覆盖，不再是发布阻塞。正式公开发布的剩余工作集中在完整传递依赖
报告、OOMOL 自有 IPC 包的 license metadata、商标/品牌政策确认、Git 历史 secret scan 和跨平台 release
验证。

| 等级        | 含义                                       |
| ----------- | ------------------------------------------ |
| Blocker     | 不解决就不能把仓库作为可运行的开源项目发布 |
| Decision    | 需要产品、法务或依赖所有者作出明确选择     |
| Engineering | 已知工程改造，可以在仓库内实施和验证       |
| Verified    | 当前工作树已经获得可重复的技术证据         |
| Follow-up   | 不阻塞当前工程推进，但应在正式发布前补齐   |

## 2. 发布项状态

### 2.1 主代码许可证与配套声明已落盘

- 等级：Verified / Decision
- 当前事实：仓库根目录已有 Apache-2.0 `LICENSE`，`package.json` 的 `license` 字段与之相同；`NOTICE`、
  `TRADEMARKS.md` 和 `THIRD_PARTY_NOTICES.md` 已落盘并进入默认打包资源。
- 剩余决策：由授权负责人确认 Apache-2.0 主代码许可和当前商标政策文本；完整传递依赖报告生成后继续补充
  Notice。工程上不再缺少这些发布文件。
- 验收：许可证和商标政策经授权负责人确认，完整依赖清单人工复核，package metadata 与发布物保持一致。

### 2.2 IPC 包已迁移到公共 npm

- 等级：Verified install path / Release blocker
- 当前事实：`@oomol/connection@0.2.28` 和 `@oomol/connection-electron-adapter@0.2.12` 已发布到
  `registry.npmjs.org`；仓库不再包含 `.npmrc`，`package-lock.json` 记录公共 npm 下载地址。
- 2026-07-20 以未携带 PAT 的 `npm view --registry=https://registry.npmjs.org` 验证两个精确版本及其
  tarball 均可公开读取。
- 发布阻塞项：两个 OOMOL 维护的包当前发布内容仍未声明 license，也未包含许可证文件。公共 npm 可下载性
  解决了匿名安装和源码构建问题，但本身不授予再分发权。正式发布可再分发的 Wanta 二进制前，必须补发带
  明确许可证的版本，或由 OOMOL 授权负责人记录当前精确版本的书面再分发许可。
- 验收结果：2026-07-20 在隔离目录使用 Node 22.22.2/npm 10.9.4，在无用户级 `.npmrc`、无 PAT、无预存
  `.oo-bin` 条件下完成 `npm ci`；新增自动化测试锁定 metadata、公共 registry 和默认 oo 分发链路。

### 2.3 oo CLI 和内置 Skills 已确认按 MIT 分发

- 等级：Verified
- 当前事实：
  - postinstall 默认下载 oo CLI 到被 gitignore 的 `.oo-bin/`；
  - postinstall 再通过 oo 导出 Skills 到被 gitignore 的 `resources/skills/`；
  - dev 的 `predev` 当前要求 oo 存在；
  - 默认官方和社区打包都会把 oo 与四个内置 Skills 放入应用资源；
  - `@oomol-lab/oo-cli@1.5.1` 及对应平台包在公共 npm 声明 MIT，并指向公开
    `oomol-lab/oo-cli` 仓库；内置 Skills 属于同一 MIT 分发内容。
- 处理：`THIRD_PARTY_NOTICES.md` 记录 oo CLI、四个内置 Skills、版本、来源和 MIT 许可；它们不再列为
  发布阻塞项。
- 工程方向：默认 `postinstall` 下载 oo，默认平台构建将其连同 Skills 打包；local runtime 不生成 oo 环境、
  不注册 Connector tools。OOMOL 或兼容自部署 OpenConnector runtime 才实际使用这条通道。
- 验收结果：fresh clone 无需预装 oo 即可由 `npm install` 准备完整开发环境；`prepare:binaries` 已确认
  默认打包包含可执行 oo 1.5.1；local runtime 不实际调用 oo；第三方声明已落盘。

### 2.4 OOMOL 登录门控已解除

- 等级：Verified
- 当前事实：该阻塞已完成工程修复。`src/App.tsx` 的 AuthGate 只等待身份与 runtime capability 初始化；未登录进入 local AppShell 和稳定的 `local:local` session scope，有 custom model 时启动 local Agent，无模型时显示 BYOK/OOMOL 两条 CTA。
- 风险：即使源码公开，用户仍无法免登录验证聊天、本地工具和自定义模型。
- 处理：按 `docs/open-source-plan.md` 的 runtime capability、本地 workspace、BYOK Agent 和无登录 AppShell 阶段实施。
- 验收：清空 OOMOL Cookie 后仍能进入主界面，并在配置 custom model 后完成本地 Agent 任务。

## 3. 已确认的第三方许可证信息

以下信息来自当前已安装包的 `package.json`，正式 Notice 仍需生成完整的直接和传递依赖清单：

| 组件                                 | 当前版本 | 包声明许可证 | 备注                                 |
| ------------------------------------ | -------- | ------------ | ------------------------------------ |
| `opencode-ai`                        | 1.17.13  | MIT          | Wanta Agent engine；随包分发 sidecar |
| `@opencode-ai/sdk`                   | 1.17.13  | MIT          | 与 OpenCode 三包版本锁定策略保持一致 |
| `wiki-graph`                         | 0.3.0    | Apache-2.0   | 仓库指向 OOMOL 的公开 GitHub 项目    |
| `@univerjs/core`                     | 0.25.1   | Apache-2.0   | Univer 完整工作簿能力必须保留        |
| `@univerjs/preset-sheets-core`       | 0.25.1   | Apache-2.0   | 需要纳入第三方 Notice                |
| `streamdown`                         | 2.5.0    | Apache-2.0   | 聊天 Markdown 渲染依赖               |
| `react`                              | 19.2.7   | MIT          | 需要纳入完整依赖审计                 |
| `@oomol/connection`                  | 0.2.28   | 未声明       | 可匿名安装；再分发许可待确认         |
| `@oomol/connection-electron-adapter` | 0.2.12   | 未声明       | 可匿名安装；再分发许可待确认         |

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
- 仓库当前不包含 `.npmrc`；依赖默认从公共 npm registry 解析；
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

- PR 和 release workflow 均从公共 npm 安装依赖，不再需要 GitHub Packages 或 npm PAT；
- Windows release 使用 self-hosted runner 和签名设备；
- macOS release 依赖公司签名、公证和发布基础设施；
- 自动更新指向 OOMOL 官方静态分发路径；
- 这些配置可以保留为官方发行路径，但不能成为 community build 的前置条件。

### 6.2 目标双路径

Community build：

- 无 PAT；
- 无 OOMOL Cookie；
- 默认携带 oo 和内置 Skills，但 local runtime 不实际启用 Connector；
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
- capability 只在 local custom-model sidecar 实际装配时声明 `localAgentAvailable: true`，无模型时保持 false；
- ChatService 已提供 capability 查询和变更事件，主进程在 local/OOMOL runtime 装配与退出时更新该事实源；
- Renderer 已在 AuthGate 外层订阅 capability，并在身份与 capability 快照都就绪后决定当前入口；
- capability 订阅采用“先订阅、再加载快照”的竞态保护，迟到的初始快照或错误不能覆盖更新事件；
- 增加 local、未就绪和 OOMOL 三种组合的纯函数测试。

Renderer capability 接入、local Agent runtime 和 local workspace 应用入口均已落地。

阶段 2 的 local workspace 数据基础现已完成：

- `SessionScope` 是显式的 `local | team` 联合类型；
- 默认本地 workspace 使用稳定 ID，新数据显式持久化 `kind`；
- 旧 `teamId` / `teamName` 与 legacy organization 字段继续兼容读取；
- SessionService、项目存储、会话/草稿 key 和侧边栏持久化隔离 local/team 命名空间；
- local/team 使用相同业务 ID 时仍不会混淆，会话和项目的跨 scope 绑定继续被拒绝。

阶段 3 的 local Agent runtime 基础现已完成：

- 主进程私有 `local | oomol` runtime 显式隔离 OOMOL session token；
- local OpenCode 配置只注册 custom provider，不生成 builtin provider 或 oo CLI 环境；
- 无 custom model 时不启动 sidecar，Agent 状态为 `model_required`；
- 首个模型新增、最后模型删除、模型切换、登录和登出共用串行重装配链；
- ChatService active run 支持 local workspace，local turn 不写团队 attention 记录；
- local sidecar 已在不提供 OOMOL token 和 oo 路径的条件下完成启动 smoke。

阶段 4 的 capability 装配现已完成：

- local/OOMOL runtime 从同一能力判断选择 Build/Plan 系统提示和 permission；
- local workspace 只释放 `query_knowledge`，不会释放四个 Connector 工具或 bundled oo Skills；
- 从 OOMOL 切回 local 时会幂等清除旧 Connector 文件，runtime Skills 目录不受影响；
- local bash 不包含 oo CLI 快速放行规则，动态授权 provider 提示也被 runtime 边界直接阻断；
- OOMOL runtime 继续保留 Connector 工具、提示契约、授权感知和 oo permission 快速路径。

阶段 5 的免登录入口和首次引导现已完成：

- 未登录不再进入强制 LoginRoute，而是在初始化完成后直接进入 AppShell；
- 无模型时显示 BYOK 配置与 OOMOL 登录 CTA，保存首个 custom model 后 local sidecar 自动进入 ready；
- local workspace 可加载会话、项目和知识库，模型清单只展示 custom model；
- Connections、Teams、Billing、云 Skills、Connector 空状态和语音能力按 runtime capability 隔离；
- 侧边栏、设置页和聊天引导均保留可选登录入口，登录失败不会卸载本地主界面；
- local runtime 不触发默认 registry Skills 云端安装。

隔离 userData 的 Electron smoke 已验证：空 Cookie/空模型直接显示 Local workspace 和模型配置 CTA；通过
UI 保存 custom model 后 sidecar ready、CTA 消失、输入框启用，且云导航没有渲染。真实模型回答仍需使用
有效的第三方 API Key 执行发布前 BYOK 端到端验收。

阶段 6 的 runtime 切换安全边界现已完成：

- 登录和换号先让 Renderer 离开旧云 scope，再替换 Cookie、串行重建 Agent，最后发布新账号；
- 登出与 token expiry 先广播未登录状态，随后清 Cookie、回收携带 token 的旧 sidecar 并回退 local；
- 即使 local runtime 回退失败，未登录状态仍会广播，旧会话 token 不会重新变为可读；
- 无 profile 的异常状态执行登出时仍强制应用 local runtime；
- 重复 expiry 幂等，不会重复启动 runtime 交接；
- auth scope 变化继续清空 Connector、Skill、Billing、团队详情和头像缓存；
- OOMOL 直连和 OOMOL runtime 聊天的 401 会触发全局 expiry 并提示重新登录，custom provider 401 不走该事件通道。

自动化回归覆盖换号交接顺序、Cookie 写入失败回滚、无 profile 登出、重复 expiry、runtime 回退失败和
OOMOL/local 两种 401 分流；隔离 userData 的 Electron smoke 继续确认未登录回退后保留 Local workspace、
模型 onboarding 和本地数据入口。

阶段 7 的 BYOK 凭证保护现已完成：

- `models.json` 只保存 `apiKeyConfigured`，不再保存明文 API Key；
- `ModelCredentialStore` 使用 Electron `safeStorage`，密文文件为 0600，runtime 在主进程按模型 ID 解密；
- Renderer/模型 catalog 只接收脱敏摘要，新 Key 仅从模型表单单向提交；
- 旧明文 Key 先批量写入安全存储，再原子清理元数据；任一步失败都保留至少一份有效凭证；
- 保存元数据失败会回滚新增/更新凭证，删除元数据失败会恢复已删除凭证；
- Linux `basic_text` 和 unknown backend 明确报错，UI 提示启用 GNOME Keyring 或 KWallet，不做明文降级；
- OOMOL session token 仍只使用 Electron Cookie，与 custom model credential 文件及生命周期完全分离。

隔离 userData 的真实 Electron `safeStorage` smoke 已验证：旧版 `models.json` 中的占位明文 Key 在启动时迁移，
清理后的元数据只含 `apiKeyConfigured`，独立密文文件不含原文且两者权限均为 0600；随后 local sidecar 使用
解密后的模型配置进入 ready，模型选择可见且输入框启用。

下一工程切片推荐顺序：

1. 完成有效第三方模型的未登录回答与本地工具端到端验证；
2. 生成完整传递依赖许可证报告并人工复核 Notice；
3. 完成 Git 历史 secret scan、品牌政策确认与跨平台 release 验证。

## 8. 发布前检查清单

- [ ] 主代码许可证已批准并落盘；
- [ ] 商标政策已批准并落盘；
- [x] IPC 包已发布到公共 npm，lockfile 不再引用私有 registry；
- [x] oo CLI 和内置 Skills 已按 MIT 记录并纳入第三方声明；
- [ ] 完整依赖许可证报告和 Notice 已生成；
- [ ] Git 历史 secret scan 完成；
- [x] custom model API Key 已迁移安全存储；
- [x] community install 不需要 PAT；
- [x] community local runtime 不要求用户单独安装、配置或实际使用 oo；
- [ ] 未登录 BYOK 聊天通过实机验证；
- [ ] 本地和团队 workspace 数据边界通过测试；
- [ ] OOMOL 登录、Connector、Billing 和 Skills 无回归；
- [ ] macOS、Windows 和 Linux 社区构建策略明确；
- [x] README、CONTRIBUTING、SECURITY 和关键 runtime 第三方声明已落盘；
- [ ] fresh clone 由未参与开发的人独立验证。
