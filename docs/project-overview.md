# 项目概览：Wanta 是什么、为什么、与生态的关系

> 相关：[architecture.md](architecture.md)（怎么实现的）· [key-decisions.md](key-decisions.md)（为什么这样实现）

## 1. 产品定位

Wanta 是一个 Electron 桌面 AI Agent 聊天客户端。用户用自然语言提需求，Agent 理解后调度 OOMOL connector 云服务（约 600 个 SaaS provider、6000+ action）并把结果流式返回到聊天区；现已放开本地能力（bash / 文件读写 / 写脚本执行），典型用法是"从多个 connector action 拉数据 → 写小脚本 join / 聚合 / 格式化"。

- **目标用户与解决的问题**：非开发者（运营/分析/行政等知识工作者）。他们的数据散落在各 SaaS（GA、邮箱、issue tracker、表格、存储……），手工跨服务取数、对账、汇总既繁琐又难自动化；Wanta 让这一切变成一句自然语言——授权一次，之后由 Agent 自己发现 action、查 schema、调用并把结果整理好。
- **核心数据流**：用户消息 → OpenCode Agent → OOMOL connector（经 `oo` CLI）/ 本地工具 → 流式回复。
- **UI 形态**：三栏布局——左：会话导航（多会话增删改切）；中：聊天区（流式 Markdown + 可折叠工具调用步骤）；右：可折叠 Connections 面板（已连接 provider、新增授权）；设置入口在左栏。三栏响应式固定比例，无拖拽分隔条（已锁定决策）。
- **金路径**（贯穿开发验收的主用例）：右侧连接 Google Analytics → 输入"查最近 7 天官网 PV" → Agent 知道 GA 已授权、直接调用 → 结果流式回到聊天区。
- **卖点**：SaaS 凭证 OAuth 一次后云端加密托管，本地只拿结果，不落明文凭证。

## 2. 与 OOMOL 生态的关系

| 组件           | 关系                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OOMOL 云端** | LLM 网关（`https://llm.<endpoint>/v1`，内置模型默认 Auto，即 `oomol/oopilot`；GPT 5.5 选项为 `openai/gpt-5.5`）；connector 网关（`https://connector.<endpoint>`）；console（授权管理页）；hub（浏览器登录页）；api（账号 API）；static（自动更新分发）。全部由 `electron/domain.ts` 从单一 endpoint 派生。                                                                                                                                                                               |
| **oo CLI**     | Agent 调用 connector 的唯一通道。作为黑盒**二进制**内置（dev 在 `.oo-bin/`，打包进 `Resources/bin`），只经 `OO_*` 环境变量控制（`electron/agent/oo.ts`），不改其源码。版本由 `scripts/oo-cli.ts` 的 `OO_CLI_VERSION` 单一锁定。**不再是 npm 依赖**——会话记录显示曾依赖 `@oomol-lab/oo-cli`，因 EACCES 问题改为项目自管理下载（见 [key-decisions.md §6](key-decisions.md)）。oo-cli 跑在 Bun 上无法 import 进 Node/Electron，库化被否（论证见 [key-decisions.md §3](key-decisions.md)）。 |
| **oo-desktop** | 姊妹应用 + 工程化基线（独立仓库，不在本仓库内；本机路径因开发机而异）。Wanta 是新建独立仓库（不 fork），但构建/打包/CI/IPC 服务划分/UI 风格全部对齐 oo-desktop，保证两 App UI 不割裂、降低维护成本。注意已知差异：connector 鉴权头（Wanta 用 `Authorization: Bearer <会话 token>`，**不带** `x-oomol-user-uuid`；oo-desktop 用 auth.toml 账号 key 裸头——勿照抄）。                                                                                                                       |
| **OpenCode**   | Agent 内核。spawn 已发布二进制 `opencode-ai@1.17.13`（sidecar），主进程经 `@opencode-ai/sdk@1.17.13` HTTP+SSE 驱动。纯配置级定制，零源码改动。调研时（2026-05）未发现 OpenCode 用于非 IDE/通用 agent 负载的社区先例，Wanta 是第一个已知案例（立项时定位非编码 agent，后放开了本地编码能力）。                                                                                                                                                                                            |

## 3. 原始计划 vs 实际交付

原始计划文档 `WANTA_PROJECT_PLAN.md`（历史文档，仅存于原开发机、仓库内无副本；其规则与阶段编号已沉淀到 [conventions.md §1](conventions.md)）定义了 7 个阶段（阶段 0–6）与 8 条全局规则 R1–R8。会话记录显示最初 7 个 commit 即按阶段 0–6 逐一交付，其后是计划外的修正与演进（弧线见 §4）。计划与现状的主要偏离：

| 计划                                                                                | 实际（现状）                                                                                                                          |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 凭证经 `OO_API_KEY` 环境变量注入，免登录直跑                                        | 改为浏览器登录流（console launcher → deep-link 回跳 → 换 `oomol-token` 会话 token；全程只用它，`auth.json` 只存 profile、不落盘凭证） |
| endpoint 运行时可切换 `oomol.com` / `oomol.dev`（阶段 5 还做了 `setEndpoint` 联动） | **已整体移除**：endpoint 是构建期常量 `__OO_ENDPOINT__`，App 层不可见不可切换                                                         |
| 严格非编码 agent：deny 所有内置编码工具，只留连接器工具                             | **已放开但受控**：OpenCode 内置工具启用；读/搜索/网页直接可用，shell/写入/外部目录访问经聊天内确认卡片批准                            |
| 自定义工具只有 `search_actions` / `call_action`                                     | 新增 `inspect_action` 强制 inspect-before-call；新增 `list_apps` 直接列 active workspace 已连接 apps                                  |
| 前端 shadcn/ui 手写聊天界面                                                         | 聊天界面迁移到 vendored ai-elements 组件，Markdown 渲染从 react-markdown 换为 streamdown                                              |
| 测试用 Node 原生 `node --test`                                                      | 迁移到 vitest（随 endpoint 常量化，vitest 原生套用 vite define）                                                                      |

未变的锁定决策：Agent 内核 = OpenCode sidecar、连接器全经 oo CLI、LLM 网关由 endpoint 派生、已授权状态来源 `/v1/apps`、三栏不可拖拽、deep-link `wanta://signin`（dev `wanta-local`）、IPC 用 `@oomol/connection`。

## 4. Git 历史弧线

> 本节只描述演进脉络，**不维护逐 commit 清单**（具体 hash 与完整列表用 `git log --oneline` 查看），不要随新 commit 追加。

最初 7 个 commit 按阶段 0–6 逐一交付，commit message 即阶段名：脚手架（镜像 oo-desktop）→ Agent 内核 headless 金路径 → 聊天 UI 与流式渲染 → Connections 面板与 OAuth → 动态提示 + 聊天内授权闭环（R4）→ 设置与 endpoint 切换 → 打包/签名/公证/自动更新/CI。

其后是计划外的修正与演进：修复登录（浏览器登录流）→ 移除动态 endpoint 支持 → 修复 oo-cli（`.oo-bin` 自管理）→ 修复 Markdown 渲染 + 系统提示词 + 工具调用 UI → 优化右侧连接 UI → UI 框架迁移至 ai-elements → 放开 tools 权限并收敛为默认权限 / 完全访问两档。每个节点的"为什么"见 [key-decisions.md](key-decisions.md)。

## 5. 术语速查

- **connector / provider / action**：OOMOL 云端的 SaaS 集成单元——provider 是服务（如 `hackernews`），action 是其下可调用的操作（如 `get_item`）；agent 用 `list_apps` 列当前 workspace 已连接 app，用 search/inspect/call 渐进发现并调用 action。
- **sidecar**：随 App 启动的本地 `opencode serve` 子进程，HTTP+SSE 服务，承载 agent loop。
- **endpoint**：OOMOL 主域（`oomol.com` / 内部开发 `oomol.dev`），构建期固定，派生全部子域。
- **金路径（golden path）**：上文 GA→PV 用例，开发期所有阶段验收都围绕它。
- **R1–R8 / 阶段 0–6**：原始计划的规则与阶段编号，散见于代码注释，详见 [conventions.md §1](conventions.md)。
