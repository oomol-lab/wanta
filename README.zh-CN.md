<div align="center">

[English](README.md) · **简体中文** · [日本語](README.ja.md) · [Español](README.es.md) · [한국어](README.ko.md)

<img src="resources/branding/logo.png" width="112" alt="Wanta 标志" />

# Wanta

**基于 OpenCode 构建桌面 AI Agent 的开源基础。**

从一个真正可用的产品开始，而不只是聊天界面演示。Wanta 将 Agent 运行时、本地工具、
权限控制、连接服务、产物管理和完善的跨平台桌面界面整合在一起。

[网站](https://wanta.ai/) · [OpenConnector](https://github.com/oomol-lab/open-connector) ·
[文档](docs/project-overview.md) · [开发指南](docs/development.md)

[![许可证：Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
![Node.js 22.22.2+](https://img.shields.io/badge/Node.js-22.22.2%2B-339933)

</div>

<p align="center">
  <img src="docs/assets/wanta-gmail-analysis.png" alt="Wanta 使用连接工具分析 Gmail，并在产物面板中预览生成的电子表格" />
</p>

<p align="center"><em>在同一个工作区中，从连接服务任务直接生成可复用、可交互的产物。</em></p>

Wanta 由 [OOMOL](https://oomol.com/) 打造，面向希望创建实用桌面 Agent、又不想重建
Agent 循环外围产品基础设施的开发者。你可以 Fork 它，替换模型、提示词、工具、连接器、
界面和品牌，然后发布适合自己产品或工作流的 Agent。

你也可以直接使用 Wanta：通过自己的 OpenAI 兼容模型在本地运行，或者登录使用 OOMOL
托管的模型、连接器、OAuth 授权和团队工作区。

## 为什么我们开源 Wanta

一个有说服力的 Agent 演示可以从模型和聊天输入框开始，但一个真正可靠的桌面 Agent
还需要更多：运行时生命周期管理、流式事件、本地访问控制、安全的模型凭据、会话与项目、
工具活动、文件产物、故障恢复、应用打包，以及让自主工作过程清晰可见的界面。

开发者不应该在打造 Agent 独特能力之前，先把这些全部重做一遍。Wanta 开放了完整的桌面
基础，使你能够：

- 将 OpenCode 用作软件开发之外各种 Agent 的运行时；
- 构建特定领域的工具、Skills、提示词和工作流；
- 将本地计算机操作与已授权的 SaaS 操作结合起来；
- 分发带有自己品牌的桌面产品，而不只是开发者原型；
- 自主选择需要运营多少基础设施。

## 你可以构建什么

Wanta 目前是一个通用工作 Agent，但其架构从一开始就面向定制。它可以成为运营 Agent、
研究 Agent、客服 Agent、电商 Agent、企业知识 Agent、内部工具，或其他垂直领域桌面产品。

| 从这里开始                                          | 打造你的产品                              |
| --------------------------------------------------- | ----------------------------------------- |
| 以隔离本地 Sidecar 方式管理的 OpenCode Agent 运行时 | 替换 Agent 角色、指令、模式和权限         |
| 本地文件、Shell、脚本、搜索和网络访问               | 为你的产品、行业或内部系统添加工具        |
| OpenAI 兼容的自定义模型和 OOMOL 托管模型            | 引入自己的模型目录和默认提供商            |
| 流式聊天、工具活动、审批、提问和附件                | 保留运行时集成，同时重新设计工作流        |
| 生成内容的产物处理                                  | 添加产品特定的输出、预览和操作            |
| 跨平台 Electron 打包和更新                          | 应用自己的名称、标识、分发和发布流程      |
| 兼容 OpenConnector 的 SaaS 操作发现与执行           | 连接自己的 Provider，或使用托管连接器生态 |

## 查看 Wanta 的实际表现

Wanta 可以直接推理、检查项目与文件、运行命令和脚本、访问网络，并在任务需要私有账户
数据时调用已授权的 SaaS Action。工具执行过程会流式展示在对话中，让用户看到 Agent
正在做什么。

高风险本地操作必须经过明确的权限流程。Agent 也可以在缺少任务信息时通过结构化问题暂停。
Build 和 Plan 模式提供不同的执行约定，用户可以为任务选择模型、推理级别、项目和访问模式。

生成的文件会始终附加在任务中，而不会消失在对话里。Wanta 可以在产物面板中打开并查看
代码、文本、图片、PDF、Word 文档和完整的交互式电子表格工作簿。

可选的托管体验还提供受管理的账户连接和团队工作区，同时不会将已存储的 Provider 凭据交给 Agent。
团队可以共享连接和 Skills、控制 Provider 访问权限并管理用量，而无需自行运营身份认证、OAuth 凭据和治理基础设施。

## 选择适合你的方案

Wanta 将开源桌面基础与可选托管服务分开。你可以根据自己希望运营的内容选择方案。

| 你的目标                                 | 推荐方案                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| 使用自己的模型运行私有桌面 Agent         | 使用 **Local BYOK** 工作区，无需 Wanta 账户。                             |
| 为自己的产品构建桌面 Agent               | Fork Wanta 并定制 Agent、工具、模型、UI 和品牌。                          |
| 连接自己的 OpenConnector 部署            | 目前可针对兼容端点构建发行版；应用内自托管 OpenConnector 设置仍在规划中。 |
| 使用托管模型和已认证的 SaaS 连接         | 登录 Wanta，使用 OOMOL 托管服务。                                         |
| 与团队共享连接器、Skills、访问权限和用量 | 使用托管的 Wanta 团队工作区。                                             |

### 运行模式

| 模式                 | 是否需要账户       | 模型                     | 本地工具 | 连接器                   | 团队功能   |
| -------------------- | ------------------ | ------------------------ | -------- | ------------------------ | ---------- |
| Local BYOK           | 否                 | 自定义 OpenAI 兼容提供商 | 支持     | 不可用                   | 否         |
| Wanta 托管           | 是                 | OOMOL 模型及自定义提供商 | 支持     | OOMOL/OpenConnector 生态 | 支持       |
| 自托管 OpenConnector | 应用内支持尚在规划 | 由部署决定               | 支持     | 规划中                   | 由部署决定 |

退出登录或 OOMOL 会话过期后，本地会话、项目和模型设置仍然可用。Wanta 不会在未告知的
情况下将本地会话上传到 OOMOL 团队工作区。

当前的 `WANTA_ENDPOINT` 选项是**构建时发行版设置**，而不是终端用户可在运行时切换的
选项。它决定的是完整的兼容服务环境，而不仅是连接器 Base URL。应用级 Base URL 和可选
Runtime Token 的自托管 OpenConnector 流程目前只是即将推出的产品界面，尚未完成。

## 构建你自己的 Agent

Wanta 将 OpenCode 作为固定版本的本地运行时，无需维护 OpenCode 源码 Fork 即可对其定制。
桌面主进程通过 HTTP 和 SSE 控制 Sidecar；Wanta 则提供 Agent 约定、模型、权限、工具、
会话、产品 UI 和桌面集成。

### Agent 引擎：OpenCode

应用会将固定版本的 `opencode-ai@1.17.13` 二进制文件作为仅监听回环地址的
`opencode serve` Sidecar 启动，并通过 `@opencode-ai/sdk@1.17.13` 驱动它。OpenCode
软件包采用 MIT 许可证，详情见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
Wanta 将运行时、SDK 和插件固定为完全相同的版本，因为其 API 不被视为稳定接口。

最重要的扩展点包括：

| 领域                         | 从这里开始                                                           |
| ---------------------------- | -------------------------------------------------------------------- |
| Agent 身份和运行约定         | [`electron/agent/system-prompt.ts`](electron/agent/system-prompt.ts) |
| Agent 模式、模型、工具和权限 | [`electron/agent/config.ts`](electron/agent/config.ts)               |
| 连接器和特定领域工具         | [`electron/agent/tool-sources.ts`](electron/agent/tool-sources.ts)   |
| 内置和自定义模型支持         | [`electron/models/`](electron/models/)                               |
| 聊天和产物体验               | [`src/routes/Chat/`](src/routes/Chat/)                               |
| 连接体验                     | [`src/routes/Connections/`](src/routes/Connections/)                 |
| 应用标识                     | [`electron/branding.ts`](electron/branding.ts)                       |

Agent 能力是一套在三个位置表达的产品约定：已启用工具、权限规则和系统提示词。请同步修改
三者，确保运行时行为、安全性和 UI 预期保持一致。在更改这些边界之前，请阅读
[架构指南](docs/architecture.md)和[代码规范](docs/conventions.md)。

## 工作原理

```mermaid
flowchart TB
  User["用户请求"] --> UI["Wanta 桌面体验"]
  UI --> Agent["OpenCode Agent 运行时"]
  Agent --> Local["本地文件、Shell、脚本和网络"]
  Agent --> Link["连接器元工具"]
  Link --> Hosted["OOMOL 托管连接器"]
  Link -.-> SelfHosted["自托管 OpenConnector<br/>应用内设置尚在规划"]
  Local --> Result["任务结果和产物"]
  Hosted --> Result
  SelfHosted -.-> Result
  Result --> UI
```

Wanta 不会在模型上下文中注册数百个 Provider 专用工具，而是采用渐进式发现：

```text
列出已连接应用 → 搜索 Action → 检查其 Schema → 使用验证后的参数调用
```

这样既能保持较小的工具面，又能让 Action 约定清晰明确，并使授权失败以结构化产品状态
返回，而不是变成自由文本模型回复。

### OpenCode、OpenConnector、Wanta 与 OOMOL

- **OpenCode** 是本地 Agent 运行时。Wanta 管理其生命周期，并提供 Agent 配置、权限、
  提示词和自定义工具。
- **OpenConnector** 是用于构建和运行共享连接器生态中 Provider 的开源姊妹项目。
- **Wanta** 是桌面 Agent 产品，也是此仓库中可复用的应用基础。
- **OOMOL** 提供可选托管层，包括登录、模型、连接器凭据、OAuth、团队、Skills、用量、
  计费和分发。

Local BYOK 核心功能不需要 OOMOL 账户。登录会启用托管连接器和团队层；查看、Fork 或开发
桌面应用本身不需要登录。

完整的进程、信任边界、IPC、流式传输、认证和存储设计请参阅
[架构指南](docs/architecture.md)。

## 从源码运行

要求：Node.js 22.22.2 或更高版本，以及 npm。

```bash
git clone https://github.com/oomol-lab/wanta.git
cd wanta
npm install
npm run dev
```

这是试用仓库的最短路径。环境配置、测试命令、运行时验证、打包、签名和发布工作流详见
[开发指南](docs/development.md)。

## 安全与数据边界

- OpenCode 仅监听回环地址，并使用随机的单进程服务器密码。
- OOMOL 会话 Token 和自定义模型 API Key 分别存储，并拥有独立的生命周期。
- 自定义模型密钥使用 Electron `safeStorage` 加密，且绝不会返回到渲染进程。
- 连接器凭据保留在所选的托管或自运营连接器环境中；Agent 只接收操作结果，不会接收
  已存储的 Provider 凭据。
- 高风险本地操作会触发 Wanta 的明确审批界面。
- 本地会话不会在未告知的情况下上传到 OOMOL 团队工作区。

私密漏洞报告方式请参阅 [SECURITY.md](SECURITY.md)，完整信任边界请参阅
[架构指南](docs/architecture.md)。

## 项目结构

| 路径                                       | 用途                                    |
| ------------------------------------------ | --------------------------------------- |
| [`electron/`](electron/)                   | 主进程、Preload、Agent 运行时和桌面服务 |
| [`src/`](src/)                             | React 渲染进程、路由、Hooks 和 UI 组件  |
| [`scripts/`](scripts/)                     | 开发、二进制准备、打包和发布支持        |
| [`resources/`](resources/)                 | 品牌和应用内打包资源                    |
| [`docs/`](docs/)                           | 产品、架构、开发、规范和决策记录        |
| [`.github/workflows/`](.github/workflows/) | Pull Request 和发布自动化               |

技术栈包括 Electron 42、Vite 8、React 19、Tailwind CSS 4、OpenCode、TypeScript、
Vitest、oxlint 和 oxfmt。Wanta 可打包为 macOS、Windows 和 Linux 应用。

## 文档

- [项目概览](docs/project-overview.md) — 产品范围和生态关系
- [架构](docs/architecture.md) — 进程、Agent 运行时、IPC、流式传输、认证和数据流
- [开发指南](docs/development.md) — 安装、运行、测试、打包、签名和发布
- [代码规范](docs/conventions.md) — 实现规则和安全边界
- [关键技术决策](docs/key-decisions.md) — 架构为何如此设计
- [贡献指南](CONTRIBUTING.md) — 分支、Pull Request、验证和贡献规则
- [安全策略](SECURITY.md) — 私密漏洞报告
- [商标政策](TRADEMARKS.md)和[第三方声明](THIRD_PARTY_NOTICES.md)

## 参与贡献

欢迎提交 Issue 和 Pull Request。在进行较大的行为或 UI 更改之前，请先创建 Issue，以便
共同确定产品方向和范围。提交 Pull Request 前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)；
其中包含仓库工作流、必要验证，以及贡献必须遵守的安全边界。

提交贡献即表示你同意，除非以书面形式明确另行说明，否则该贡献将采用 Apache License 2.0。

## 许可证范围

除非另有说明，本仓库创作的源代码、脚本、测试和文档均采用
[Apache License 2.0](LICENSE)。

此许可证不授予任何第三方产品、服务、API、商标、商号、标志、图标、截图或其他材料的
权利，这些内容仍归各自权利人所有。第三方名称和资源仅用于识别和互操作；收录它们并不表示
任何认可、赞助或合作关系。
