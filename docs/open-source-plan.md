# Wanta Open-Source and Login-Free Mode Implementation Plan

<<<<<<< HEAD
> 状态：In progress（阶段 1–8 工程切片已完成，阶段 9 推进中）
> 目标：将 Wanta 改造成默认免登录、支持 BYOK、本地 Agent 能力和自部署 OpenConnector 的开源桌面应用；OOMOL 登录作为云模型、托管 OpenConnector、团队、共享连接、私有 Skills 和账单等能力的可选增强入口。
=======
> Status: Draft — in execution. Several items have already landed on `main` and are marked **done**
> inline: the Apache-2.0 `LICENSE` and `README.md` (#197), the `@oomol/*` packages on public npm
> (#195), the organizations→teams rename (#188), and the `package.json` metadata fields.
> Goal: turn Wanta into an open-source desktop app that is login-free by default and supports BYOK
> and local Agent capabilities; OOMOL login becomes the optional upgrade path to cloud models,
> OpenConnector, teams, shared connections, cloud Skills, and billing.
>>>>>>> origin/main

## 1. Background and goals

<<<<<<< HEAD
Wanta 当前是 OOMOL 出品的 Electron 桌面 AI Agent 客户端。Agent 内核明确使用 MIT 许可的
[OpenCode](https://github.com/anomalyco/opencode)：主进程把精确钉死的 `opencode-ai@1.17.13` 作为
loopback-only `opencode serve` sidecar 启动，并通过同版本 `@opencode-ai/sdk` 驱动；Wanta 在其上提供
桌面 UI、runtime 隔离、模型配置、权限闭环、会话、Connector tools 和 Artifact。聊天 UI、OpenCode
sidecar、本地工具、权限确认、Artifact、文档预览、自定义模型和 OpenConnector 客户端能力已经具备较完整的
产品形态，但应用入口、Agent 生命周期、会话作用域和云端能力都与 OOMOL 登录状态深度绑定。
=======
Wanta today is OOMOL's Electron desktop AI Agent client. The chat UI, OpenCode sidecar, local
tools, permission prompts, Artifacts, document previews, custom models, and the OpenConnector
client side are already a fairly complete product — but the app entry point, Agent lifecycle,
session scoping, and cloud capabilities are all deeply bound to the OOMOL login state.
>>>>>>> origin/main

The core purpose of open-sourcing is not to open up all of OOMOL's cloud infrastructure, but to
let the community:

<<<<<<< HEAD
- 参考和复用成熟的聊天 UI 与流式交互设计；
- 理解 Electron + OpenCode + 本地工具 + 权限 UI 的完整 Agent 开发范式；
- 在不注册 OOMOL 账号的情况下，通过自有模型 API 或本地兼容服务使用核心功能；
- 未登录即可浏览公开 Skill 并管理本机 Skill；安装、更新、发布等依赖 oo 凭证的操作仍需登录；
- 在后续版本中通过 Base URL 和可选 Runtime Token 连接自部署 OpenConnector；
- 在主动登录 OOMOL 后，继续使用托管 OpenConnector 和其他官方托管能力。
=======
- study and reuse a mature chat UI and streaming interaction design;
- understand the complete Agent development pattern of Electron + OpenCode + local tools +
  permission UI;
- use the core features without registering an OOMOL account, via their own model API or a local
  compatible service;
- keep using OpenConnector and other officially hosted capabilities after deliberately signing in
  to OOMOL.
>>>>>>> origin/main

The target product must support two runtime modes:

<<<<<<< HEAD
| 模式         | 是否登录 | 模型来源                    | 本地工具 |        OpenConnector | 团队/账单 |
| ------------ | -------: | --------------------------- | -------: | -------------------: | --------: |
| 本地社区模式 |   不需要 | 自定义 API / 本地兼容服务   |     支持 | 自部署（配置待实现） |    不支持 |
| OOMOL 云模式 |     需要 | OOMOL 内置模型 + 自定义模型 |     支持 |                 支持 |      支持 |
=======
| Mode                 | Login required | Model source                          | Local tools | OpenConnector | Teams/billing |
| -------------------- | -------------: | ------------------------------------- | ----------: | ------------: | ------------: |
| Local community mode |             No | Custom API / local compatible service |   Supported | Not supported | Not supported |
| OOMOL cloud mode     |            Yes | OOMOL built-in models + custom models |   Supported |     Supported |     Supported |
>>>>>>> origin/main

The first open-source release must satisfy:

<<<<<<< HEAD
- fresh clone 不需要 OOMOL 账号；
- fresh clone 不需要私有 npm PAT；
- 未登录可以进入主界面并管理本地数据；
- 未登录时保留“连接”和“技能”入口，公开 Skill 可直接浏览和搜索；
- 配置自定义模型后可以聊天；
- 可以使用本地文件、Shell、项目、权限确认和 Artifact；
- 未登录时不向模型暴露 Connector 工具或 OOMOL workspace 语义；
- 登录后仍可使用现有 OOMOL 能力；
- 登出或会话过期不会使本地功能整体失效；
- 开源许可证、品牌边界、第三方依赖和凭证存储方式清晰。
=======
- a fresh clone requires no OOMOL account;
- a fresh clone requires no private npm PAT — **already true**: the `@oomol/*` packages have been
  on public npm since the org migration (#195);
- the main UI is reachable without login, and local data is manageable there;
- chat works once a custom model is configured;
- local files, Shell, projects, permission prompts, and Artifacts are usable;
- when not signed in, no Connector tools or OOMOL workspace semantics are exposed to the model;
- after signin, all existing OOMOL capabilities keep working;
- signout or session expiry never disables local functionality wholesale;
- the open-source license, brand boundaries, third-party dependencies, and credential storage are
  all clearly settled.
>>>>>>> origin/main

## 2. Scope

### 2.1 First-release open-source core

<<<<<<< HEAD
- Electron 主进程、preload 和 React 渲染进程；
- 聊天 UI、流式消息、工具调用展示和消息操作；
- OpenCode sidecar 生命周期管理；
- Build / Plan 模式；
- 本地文件、Shell、项目和代码能力；
- OpenCode permission ask 与 Wanta 权限 UI 闭环；
- 本地会话和项目管理；
- 附件、Artifact、PDF、Word、图片和 Univer 表格预览；
- 自定义 OpenAI-compatible 模型；
- 本地 Skills 和不依赖 OOMOL 账号的知识能力；
- 公开 Skill 目录的匿名浏览与搜索；
- 本地 workspace；
- OOMOL 登录和 OpenConnector 的客户端实现；
- 开发、构建、测试、安全和贡献文档。
=======
- Electron main process, preload, and the React renderer;
- chat UI, streaming messages, tool-call rendering, and message actions;
- OpenCode sidecar lifecycle management;
- Build / Plan modes;
- local file, Shell, project, and code capabilities;
- the closed loop between OpenCode permission ask and Wanta's permission UI;
- local session and project management;
- attachments, Artifacts, PDF, Word, image, and Univer spreadsheet previews;
- custom OpenAI-compatible models;
- local Skills and knowledge capabilities that do not depend on an OOMOL account;
- the local workspace;
- the client-side implementation of OOMOL login and OpenConnector;
- development, build, test, security, and contribution documentation.
>>>>>>> origin/main

### 2.2 OOMOL-hosted enhancements

The following capabilities remain hosted services provided by OOMOL; the repo contains only the
client-side integration:

<<<<<<< HEAD
- OOMOL 内置模型和 Auto 模型；
- OpenConnector 服务端与托管凭证；
- 团队与共享 workspace；
- 团队共享连接；
- 私有 Skill、发布、安装更新和团队 Skill 能力；
- 账单和使用量；
- OOMOL 自动更新分发基础设施。
=======
- OOMOL built-in models and the Auto model;
- the OpenConnector server side and hosted credentials;
- teams and shared workspaces;
- team-shared connections;
- the cloud Skills catalog;
- billing and usage;
- OOMOL's auto-update distribution infrastructure.
>>>>>>> origin/main

### 2.3 Out of scope for the first release

<<<<<<< HEAD
- 开源 OOMOL LLM 网关服务端；
- 在 Wanta 仓库内重复实现 OpenConnector 服务端或凭证托管系统；
- 提供公共免费模型 API Key；
- 社区自行部署完整 OOMOL 后端；
- 自动将本地会话迁移到团队 workspace；
- 多设备同步本地会话；
- Web 版 Wanta；
- 完整的第三方 Connector 插件市场。
=======
- open-sourcing the OOMOL LLM gateway server;
- open-sourcing the OpenConnector server or the credential-hosting system;
- providing a public free model API key;
- community self-hosting of the full OOMOL backend;
- automatically migrating local sessions into a team workspace;
- multi-device sync of local sessions;
- a web version of Wanta;
- a full third-party Connector plugin marketplace.
>>>>>>> origin/main

## 3. Product and architecture decisions

Implementation defaults to the following decisions:

<<<<<<< HEAD
| 决策                         | 方案                     | 原因                                   |
| ---------------------------- | ------------------------ | -------------------------------------- |
| 未登录是否能进入主界面       | 可以                     | 免登录模式的核心要求                   |
| 未配置模型时是否阻止进入应用 | 不阻止，只阻止发送       | 用户仍可浏览、管理设置和添加模型       |
| 未配置模型的 Agent 状态      | `model_required`         | 不应将模型缺失误报为退出登录           |
| 本地身份是否伪装成登录账号   | 不伪装                   | 避免 Auth、团队和账单语义混乱          |
| 本地 workspace               | 正式的一等 scope         | 避免长期以虚假 team 实现               |
| 登录后是否保留本地会话       | 保留                     | 本地和云端数据应并存                   |
| 是否自动上传或迁移本地会话   | 不自动                   | 避免未经确认改变数据归属               |
| 登出后是否停止整个 Agent     | 不停止                   | 只移除 OOMOL 云能力并回退本地模型      |
| Connector 工具是否始终安装   | 否                       | 工具、权限和系统提示必须与实际能力一致 |
| 自定义模型 Key 存储          | 系统安全存储             | BYOK 是社区版核心安全边界              |
| 登录页                       | 保留但移出启动门禁       | 登录是能力升级，不是使用前提           |
| 仓库策略                     | 单仓库、单主线、能力分层 | 避免社区版和商业版长期分叉             |
| 开源许可证                   | 优先 Apache-2.0          | 适合公司主导项目并提供明确专利授权     |
| 品牌策略                     | 代码许可与商标许可分离   | 开源代码不自动授权品牌再发行           |
=======
| Decision                                           | Choice                                            | Rationale                                                          |
| -------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| Can the main UI be entered without login           | Yes                                               | The core requirement of login-free mode                            |
| Block app entry when no model is configured        | No — only block sending                           | Users can still browse, manage settings, and add models            |
| Agent state when no model is configured            | `model_required`                                  | A missing model must never be misreported as being signed out      |
| Disguise the local identity as a signed-in account | No                                                | Avoids muddling Auth, team, and billing semantics                  |
| Local workspace                                    | A formal first-class scope                        | Avoids a long-lived fake-team implementation                       |
| Keep local sessions after signin                   | Yes                                               | Local and cloud data must coexist                                  |
| Auto-upload or migrate local sessions              | Never automatically                               | Never change data ownership without confirmation                   |
| Stop the whole Agent on signout                    | No                                                | Only remove OOMOL cloud capabilities and fall back to local models |
| Always install Connector tools                     | No                                                | Tools, permissions, and system prompt must match actual capability |
| Custom model key storage                           | OS-level secure storage                           | BYOK is the community edition's core security boundary             |
| Login page                                         | Kept, but removed from the startup gate           | Login is a capability upgrade, not a precondition for use          |
| Repository strategy                                | Single repo, single mainline, capability layering | Avoids a long-term community/commercial fork                       |
| Open-source license                                | Apache-2.0 — **decided; `LICENSE` landed** (#197) | Suits a company-led project and grants an explicit patent license  |
| Brand strategy                                     | Code license separated from trademark license     | Open-sourcing the code does not license brand redistribution       |
>>>>>>> origin/main

## 4. Target runtime model

### 4.1 Decouple identity, workspace, model, and capabilities

Today the login state simultaneously decides the app entry point, workspace, sessions, Agent,
models, and Connector. The target architecture splits this into four independent states.

Note on naming: after the organizations→teams rename (#188), the codebase's workspace concept is
called **team** throughout — `SessionScope.teamId`/`teamName`, `ChatRunWorkspace.teamId`/`teamName`,
`useTeamWorkspace`, `useTeamSkills`, `SetAgentTeamRequest.teamName`, among others. Only external
protocol headers such as `x-oo-organization-name` keep the "organization" wording. Search and
refactor by the team-based names — never by the legacy ones.

```ts
interface ApplicationRuntimeState {
  identity: IdentityState
  workspace: WorkspaceScope
  model: ModelRuntimeState
  capabilities: RuntimeCapabilities
}

type IdentityState = { kind: "local" } | { kind: "oomol"; account: AuthAccountSummary }

type WorkspaceScope =
  | {
      kind: "local"
      workspaceId: string
      workspaceName: string
    }
  | {
      kind: "team"
      teamId: string
      teamName: string
    }

type ModelRuntimeState =
  | { status: "model_required" }
  | { status: "ready"; selected: ModelChoice }
  | { status: "error"; message: string }

interface RuntimeCapabilities {
  localAgent: boolean
  localTools: boolean
  customModels: boolean
  oomolCloudModels: boolean
  connectors: boolean
  teams: boolean
  billing: boolean
  cloudSkills: boolean
  voice: boolean
}
```

Responsibilities of each state:

- `AuthState` describes only the OOMOL login state;
- `WorkspaceScope` describes the data ownership of sessions and projects;
- `ModelRuntimeState` decides whether the Agent can answer at all;
- `RuntimeCapabilities` decides which capabilities the UI, tools, permissions, and system prompt
  expose.

Never bypass the existing login gate by fabricating a fake `authenticated` local account.

### 4.2 Startup flow

```mermaid
flowchart TD
<<<<<<< HEAD
    A["应用启动"] --> B["加载本地设置"]
    B --> C["创建本地 workspace"]
    B --> D["检查自定义模型"]
    B --> E["检查 OOMOL 会话"]
    D -->|存在可用模型| F["启动本地 Agent"]
    D -->|没有模型| G["状态：model_required"]
    E -->|未登录| H["仅启用本地能力"]
    E -->|已登录| I["启用 OOMOL 云能力"]
    H --> J["本地工具与本地提示词"]
    I --> K["云模型、Connector、团队和云 Skills"]
    F --> L["聊天主界面"]
=======
    A["App startup"] --> B["Load local settings"]
    B --> C["Create local workspace"]
    B --> D["Check custom models"]
    B --> E["Check OOMOL session"]
    D -->|usable model exists| F["Start local Agent"]
    D -->|no model| G["State: model_required"]
    E -->|not signed in| H["Enable local capabilities only"]
    E -->|signed in| I["Enable OOMOL cloud capabilities"]
    H --> J["Local tools and local prompt"]
    I --> K["Cloud models, Connector, teams, cloud Skills"]
    F --> L["Main chat UI"]
>>>>>>> origin/main
    G --> L
    J --> L
    K --> L
```

## 5. Implementation stages

### Stage 0: open-source audit and license decision

#### Goal

Establish the publication and redistribution boundaries for code, brand assets, binaries, Skills,
and dependencies.

#### Work items

1. Decide the main code license — **done**: Apache-2.0 was chosen and `LICENSE` landed at the repo
   root (#197);
2. Add `NOTICE`, `TRADEMARKS.md`, and `THIRD_PARTY_NOTICES.md` (`LICENSE` is already in; these
   three still do not exist);
3. Audit `@oomol/connection`, `@oomol/connection-electron-adapter`, the oo CLI, built-in Skills,
   OpenCode, WikiGraph, ai-elements, Univer, and third-party app logos (the two
   `@oomol/connection*` packages are already on public npm — see Stage 8);
4. For every dependency, record: can the source be published, can it be redistributed, is it
   required for a community build, and what is the planned handling;
5. Scan the complete Git history for tokens, API keys, `.env` files, internal addresses, test
   accounts, customer information, signing material, and private assets;
6. When a real secret is found, rotate it first — then decide whether to rewrite history;
7. Draw an explicit responsibility boundary between OOMOL-hosted services and the open-source
   client.

#### Acceptance criteria

- License confirmed by the company — **done** (Apache-2.0); trademark policy confirmation still
  pending;
- every private dependency has an explicit handling plan;
- redistribution rights for the oo CLI and Skills are settled;
- the full Git history secret scan is complete;
- no release blocker is waved through on default assumptions alone.

### Stage 1: establish the runtime capability model

#### Goal

Break the state coupling of "not signed in means the app and Agent cannot run".

#### Work items

1. Add the runtime capability model;
2. Change the Agent state to `starting | ready | model_required | error`;
3. Keep `AuthState`, but use it only for OOMOL identity and cloud capabilities;
4. Stop the renderer from deriving overall feature availability from `authenticated`;
5. Add pure-function tests for local, OOMOL, token expiry, and missing-model states.

#### Primary affected files

- `electron/auth/common.ts`
- `electron/main.ts`
- `electron/chat/common.ts`
- `electron/chat/node.ts`
- `src/hooks/useAuth.ts`
- `src/components/AppDataProvider.tsx`
- `src/components/app-shell/AppShell.tsx`

#### Acceptance criteria

- Auth and the Agent runtime are independent concepts;
- local capabilities remain available when not signed in;
- token expiry only shuts off cloud capabilities — it never deletes local models or local sessions;
- no fake local signed-in account exists.

### Stage 2: introduce the local workspace

<<<<<<< HEAD
> 工程状态：数据模型、持久化迁移、SessionService 隔离和 Renderer 会话键已完成；本地 Agent
> 尚未装配，因此未登录用户进入 AppShell、真实离线会话创建与团队/本地 workspace UI 切换留待阶段 3–5。

#### 目标
=======
#### Goal
>>>>>>> origin/main

Give not-signed-in users formal data ownership and a session scope.

#### Work items

<<<<<<< HEAD
1. 将 `SessionScope` 扩展为 `local | team` 联合类型；
2. 定义稳定的默认本地 workspace ID 和名称；
3. 保留现有 `teamId` / `teamName` 数据，并继续兼容更早版本的 `organizationId` / `organizationName`；
4. 新数据显式写入 scope kind；
5. 未登录时自动选择本地 workspace，不发起团队 API 请求；
6. 登录后保留本地 workspace，并允许切换团队 workspace；
7. 不自动迁移、复制或上传本地会话；
8. 为会话、项目、归档和旧数据迁移增加测试。

当前实现已经将 `SessionScope` 扩展为显式 `local | team` 联合类型，默认本地 workspace 使用稳定的
`local` ID；新写入数据总是携带 `kind`，读取时继续兼容无 `kind` 的 `teamId` / `teamName` 与更早的
`organizationId` / `organizationName`。本地与团队 scope key 使用不同命名空间，即使业务 ID 相同也不会
混淆。会话、项目、草稿和侧边栏持久化均已接入该 key；当前 OOMOL Agent runtime 仍只接受团队 scope，
避免在阶段 3 完成前把尚不可运行的本地 Agent 暴露给用户。

#### 主要影响文件
=======
1. Extend `SessionScope` into a `local | team` union type (today it is `{ teamId, teamName }`);
2. Define a stable default local workspace ID and name;
3. Compatibility reads for legacy data that only carries `organizationId` and `organizationName`
   **already exist** — `normalizeSessionScopeValue` in `electron/session/common.ts` falls back to
   the legacy fields and maps them to `teamId`/`teamName`. Keep that fallback intact; the remaining
   work in this item is only adding the `local` variant to the union, not building a new
   `organization*` compat layer;
4. New data writes the scope kind explicitly;
5. When not signed in, auto-select the local workspace and issue no team API requests;
6. After signin, keep the local workspace and allow switching to team workspaces;
7. Never auto-migrate, copy, or upload local sessions;
8. Add tests for sessions, projects, archives, and legacy-data migration.

#### Primary affected files
>>>>>>> origin/main

- `electron/session/common.ts`
- `electron/session/node.ts`
- `electron/session/metadata-store.ts`
- `electron/session/project-store.ts`
- `src/components/app-shell/app-shell-model.ts`
- `src/hooks/useTeamWorkspace.ts`
- `src/components/app-shell/AppShell.tsx`

#### Acceptance criteria

<<<<<<< HEAD
- 完全无网络时可以创建、读取和恢复本地会话；
- 本地 scope 与团队 scope 不冲突；
- 登录、登出和账号切换不删除本地会话；
- 旧版本团队会话及 legacy organization 字段可以正常读取。
=======
- local sessions can be created, read, and restored fully offline;
- the local scope and team scopes never conflict;
- signin, signout, and account switching never delete local sessions;
- legacy team sessions — including pre-rename records carrying `organization*` fields — still read
  correctly.
>>>>>>> origin/main

### Stage 3: support the not-signed-in Agent and BYOK

<<<<<<< HEAD
> 工程状态：主进程 local/OOMOL 双 runtime、`model_required` 生命周期、custom-only OpenCode
> 配置和 local session 发送链已完成；登录墙、模型 onboarding 和 capability 化提示词/Connector 工具分别留在阶段 4–5。

#### 目标
=======
#### Goal
>>>>>>> origin/main

As long as one usable custom model exists, a not-signed-in user can start the OpenCode Agent.

#### Design

```ts
/** Lives only in the Electron main process — never in preload, renderer state, or IPC/RPC contracts. */
type MainProcessCloudRuntime =
  | { kind: "local" }
  | {
      kind: "oomol"
      sessionToken: string
      teamName?: string
    }

<<<<<<< HEAD
/** 可跨 preload/Renderer 边界共享的无凭证能力摘要。 */
=======
/** Credential-free capability summary that may cross the preload/renderer boundary. */
>>>>>>> origin/main
type RuntimeCapabilities = { kind: "local"; connector: false } | { kind: "oomol"; connector: true; teamName?: string }

interface AgentManagerOptions {
  cloudRuntime: MainProcessCloudRuntime
  defaultModel: ModelChoice
  customModels: PersistedCustomModel[]
  opencodeBinPath: string
  rootDir: string
}
```

Local mode:

- generate no OOMOL builtin provider;
- require no OOMOL token;
- register only user-configured custom providers;
- with no model, never start the sidecar — state is `model_required`;
- never pass an empty string as a token or API key;
- generate no oo CLI environment.

OOMOL mode:

- keep the existing builtin providers and Auto;
- keep the session token security boundary;
- keep supporting custom providers;
- signin, signout, and model changes rebuild the sidecar safely through the same serial assembly
  chain.

#### Lifecycle requirements

- custom model present at startup: start the local runtime;
- OOMOL session present at startup: enable the OOMOL runtime;
- no model at all: enter `model_required`;
- first model added: start the Agent automatically;
- last model deleted: enter `model_required`;
- signout with a custom model: fall back to the local runtime;
- signout without a custom model: keep the app usable and enter `model_required`.

<<<<<<< HEAD
当前主进程通过纯函数同时解析身份、选中模型和 custom model 清单：有 OOMOL session 时装配云 runtime，
无 session 但存在 custom model 时装配不带 OOMOL token、builtin provider 或 oo 环境的 local runtime；两者都
不存在时不启动 sidecar 并进入 `model_required`。新增、删除或切换模型统一经过现有串行 refresh/retirement
链，旧 sidecar 确认退出后才启动新实例。local runtime 已实测可以在不提供 oo 路径的情况下启动 OpenCode
sidecar，ChatService 也接受 local workspace；完整模型回答仍需阶段 4 先移除 Connector 提示与工具暴露，
再由阶段 5 开放未登录 AppShell 进行端到端验收。

#### 主要影响文件
=======
#### Primary affected files
>>>>>>> origin/main

- `electron/agent/manager.ts`
- `electron/agent/config.ts`
- `electron/main.ts`
- `electron/models/node.ts`
- `electron/models/store.ts`
- `electron/chat/node.ts`

#### Acceptance criteria

- a custom model completes a chat with no OOMOL cookie present;
- local Shell, file, and project tools work;
- the app does not crash when no model exists;
- adding, deleting, and switching models refreshes the runtime safely;
- no OOMOL session token exists in the local runtime environment;
- renderer state and IPC/RPC payloads never contain `sessionToken` — only the credential-free
  `RuntimeCapabilities` is exposed.

### Stage 4: assemble the system prompt and Connector tools by capability

<<<<<<< HEAD
> 工程状态：local/OOMOL 已按同一 runtime capability 装配 Build/Plan 提示、bash permission、
> workspace 自定义工具和 bundled Connector Skills；本地模式只保留 `query_knowledge`，OOMOL 模式保持
> 四个 Connector 工具和现有授权链。真实未登录聊天入口仍留待阶段 5。

#### 目标
=======
#### Goal
>>>>>>> origin/main

Make the tools, permissions, and system prompt the model sees match actual capability.

#### Work items

<<<<<<< HEAD
1. 将系统提示拆为 core、local work、knowledge、connector、output 和 plan 等 section；
2. 新增基于 capability 的提示组合函数；
3. 本地模式不写入 `list_apps`、`search_actions`、`inspect_action` 和 `call_action`；
4. 本地模式不注入 `OO_API_KEY`、Connector URL 和 team scope；
5. OOMOL 模式保留现有四个工具、授权语义、canary、限流和熔断；
6. 能力策略变更时同步检查 tools、agent permission、root permission 和 system prompt；
7. 为两种 runtime 建立配置和提示词快照/断言测试。
=======
1. Split the system prompt into sections such as core, local work, knowledge, connector, output,
   and plan;
2. Add a capability-based prompt composition function;
3. In local mode, never write `list_apps`, `search_actions`, `inspect_action`, or `call_action`;
4. In local mode, inject no `OO_API_KEY`, Connector URL, or team scope;
5. In OOMOL mode, keep the existing four tools, authorization semantics, canary, rate limiting,
   and circuit breaker;
6. Whenever the capability policy changes, check tools, agent permission, root permission, and
   system prompt together;
7. Build snapshot/assertion tests for the config and prompt of both runtimes.
>>>>>>> origin/main

#### Primary affected files

- `electron/agent/system-prompt.ts`
- `electron/agent/config.ts`
- `electron/agent/workspace.ts`
- `electron/agent/tool-sources.ts`
- `electron/agent/oo.ts`
- `electron/agent/manager.ts`

#### Acceptance criteria

- in local mode, Connector tools exist neither in the prompt nor in the OpenCode workspace;
- no `OO_API_KEY` exists in the local-mode environment;
- no functional regression on the OOMOL-mode Connector critical path;
- Build / Plan permission semantics and the permission-ask UI loop stay intact.

<<<<<<< HEAD
当前实现通过 `buildWantaSystemPrompt()` / `buildWantaPlanSystemPrompt()`、
`agentToolFilesForRuntime()` 和 runtime-aware permission factory 共享同一能力判断。本地 workspace 启动时会
清除旧的 Connector 工具与 bundled oo Skills，避免从 OOMOL runtime 切回本地后残留；registry/runtime
Skills 目录和 `query_knowledge` 保持可用。local `bash` 不再继承 oo CLI 快速放行规则，OOMOL Build、Plan
和根级 permission 继续保持原有 ask/快速路径语义。

### 阶段 5：移除登录墙并增加首次引导

> 工程状态：启动登录墙已移除；AuthGate 现在只等待身份与 runtime capability 初始化。未登录用户进入
> `Local` workspace，无模型时在聊天空状态直接配置 BYOK，也可选择登录 OOMOL；配置模型后 local
> sidecar 自动启动且不离开主界面。云导航、用量、语音、团队与 Connector 请求均按 capability 隔离。

#### 目标
=======
### Stage 5: remove the login wall and add first-run onboarding

#### Goal
>>>>>>> origin/main

Users land in the main UI on launch; login becomes an optional action.

#### Work items

<<<<<<< HEAD
1. 将 `AuthGate` 改为只等待 runtime 初始化的入口；
2. 无模型时显示模型配置 CTA，但不阻止进入应用；
3. 已有模型时直接启动本地聊天；
4. 将 OOMOL 登录入口移到侧边栏账号菜单、设置页、模型页面和 Connector CTA；
5. 原 LoginRoute 保留为登录页面或对话框，不再作为默认启动屏障；
6. 本地模式隐藏或明确禁用 Billing、Teams、云 Connections、云 Skills 和云使用量；
7. 不能让云页面通过大量 401 才说明需要登录；
8. 补齐中英文引导、错误和能力说明文案。
=======
1. Turn `AuthGate` into an entry gate that only waits for runtime initialization;
2. With no model, show a model-configuration CTA but never block app entry;
3. With a model present, start local chat directly;
4. Move the OOMOL login entry points to the sidebar account menu, the settings page, the models
   page, and the Connector CTA;
5. Keep the former LoginRoute as a login page or dialog — no longer the default startup barrier;
6. In local mode, hide or explicitly disable Billing, Teams, cloud Connections, cloud Skills, and
   cloud usage;
7. Cloud pages must never explain "you need to sign in" through a pile of 401s;
8. Complete the Chinese and English onboarding, error, and capability copy.
>>>>>>> origin/main

Recommended first-run onboarding copy:

> Configure a model to start chatting. You can use your own API, or sign in to OOMOL to use cloud
> models and connectors.

#### Primary affected files

- `src/App.tsx`
- `src/hooks/useAuth.ts`
- `src/components/AuthenticatedAppShell.tsx`
- `src/components/app-shell/AppShell.tsx`
- `src/routes/Login/`
- `src/routes/Settings/`
- model, sidebar, and navigation components
- Chinese and English i18n

#### Acceptance criteria

- restarting after clearing cookies never shows a forced login wall;
- the Local workspace is reachable without signin;
- with no model, a clear configuration entry point exists;
- a failed login never affects local chat;
- after signout, the user stays in the main UI.

<<<<<<< HEAD
当前实现保留 `LoginRoute` 作为独立登录展示组件，但它不再是默认入口。侧边栏账号菜单、设置账户区、
无模型引导和聊天空状态云能力 CTA 都能发起 OOMOL 浏览器登录。local 模式使用稳定
`local:local` session scope，显示本地会话/项目/知识库，隐藏 Connections、Teams、Billing、云 Skills 和
语音入口；直接命中云 route 也会在渲染前回到聊天页，因此不会依赖一串 401 来判断未登录。默认 registry
Skills 的云端安装只在 OOMOL runtime 启动，local runtime 不会发起该登录依赖请求。

### 阶段 6：稳定本地与 OOMOL 模式切换

> 工程状态：登录、登出、session expiry 和账号切换现已使用明确的 auth/runtime 交接顺序。进入新账号前，
> Renderer 先退出旧云作用域并清理账号缓存，再替换 Cookie、串行回收旧 sidecar、启动新 runtime，最后发布
> 新账号状态；登出与过期则先撤掉云 UI，再清 Cookie、回收旧 runtime 并回退 local。runtime 回退失败不会
> 阻止未登录状态生效，错误会留在 Agent 状态中供恢复。

#### 目标
=======
### Stage 6: stabilize switching between local and OOMOL modes

#### Goal
>>>>>>> origin/main

Make signin, signout, token expiry, and account switching safe and predictable.

#### After signin

<<<<<<< HEAD
- 保留本地 workspace 和本地会话；
- 加载团队、OOMOL builtin models 和 Connector capability；
- 安全重建 Agent runtime；
- 显示 Connections、Billing、Teams 和云 Skills；
- 不自动上传或改变当前本地会话归属。
=======
- keep the local workspace and local sessions;
- load teams, OOMOL builtin models, and the Connector capability;
- rebuild the Agent runtime safely;
- show Connections, Billing, Teams, and cloud Skills;
- never auto-upload or change the ownership of current local sessions.
>>>>>>> origin/main

#### After signout or token expiry

<<<<<<< HEAD
- 清理 Cookie 和运行态 token；
- 完整停止带 token 的旧 sidecar；
- 移除 Connector 和团队 capability；
- 清理上一账号云缓存；
- 切换本地 workspace；
- 有 custom model 时启动 local runtime；
- 无 custom model 时进入 `model_required`；
- 不删除本地数据。
=======
- clear cookies and runtime tokens;
- fully stop the old token-carrying sidecar;
- remove the Connector and team capabilities;
- clear the previous account's cloud caches;
- switch to the local workspace;
- with a custom model, start the local runtime;
- without a custom model, enter `model_required`;
- never delete local data.
>>>>>>> origin/main

#### Error boundaries

- only a 401 from an OOMOL service triggers OOMOL session expiry;
- a 401 from a custom provider only prompts checking that model's API key;
- a canceled or failed login never affects local capabilities;
- when switching runtimes mid-generation, stop the old generation and sidecar first, then start
  the new runtime;
- keep using the serial apply chain — two sidecars must never share the same workspace
  concurrently.

#### Acceptance matrix

| Scenario                        | Expected                                                      |
| ------------------------------- | ------------------------------------------------------------- |
| Signin succeeds from local mode | OOMOL capabilities added, local data preserved                |
| Login canceled or failed        | Local functionality unaffected                                |
| Signout from OOMOL mode         | Falls back to local mode                                      |
| OOMOL token expires             | Falls back to local mode with a notice                        |
| Custom model API 401            | Does not trigger OOMOL signout                                |
| Signed-in account switched      | Previous account's cloud caches cleared, local data preserved |
| Signout mid-generation          | Old generation stopped, runtime rebuilt safely                |
| Signout with no custom model    | `model_required`, app remains usable                          |

<<<<<<< HEAD
当前实现继续使用 main process `applyChain` 串行 runtime 变更；`AgentManager.dispose()` 会中止事件流、授权读取
和正在启动/运行的 sidecar，旧实例确认退出前不会启动新实例。账号切换会先广播临时未登录状态，避免出现
“旧 workspace + 新 Cookie”或“新 workspace + 旧 sidecar”的混合窗口。登出即使磁盘 profile 已不存在也会
强制应用 local runtime；Cookie 清理或 local runtime 启动失败均不会让旧身份重新暴露。OOMOL runtime 的
直连或聊天请求 401 才触发全局 session expiry，custom provider 的 401 仍只作为当前模型错误处理。Auth scope 变化会
清理 Connector、Skill catalog、Billing、团队详情和头像缓存，本地 session/project 数据不会删除或改归属。

### 阶段 7：保护自定义模型凭证

> 工程状态：`ModelCredentialStore` 已接入 Electron `safeStorage`。`models.json` 只保存
> `apiKeyConfigured`，密文独立保存到 0600 的 `model-credentials.json`；模型 runtime 仅在主进程按 ID 解密并
> 组装。旧明文 Key 使用“先写全部安全存储、再原子清理元数据”的迁移顺序，保存/删除失败均有凭证回滚。
> Linux 的 `basic_text`/unknown backend 被明确拒绝，不允许静默明文降级。

#### 目标
=======
### Stage 7: protect custom model credentials

#### Goal
>>>>>>> origin/main

Make BYOK a security capability the project can publicly commit to.

#### Work items

1. Introduce a `ModelCredentialStore`;
2. Store API keys via Electron `safeStorage` or OS-level secure storage;
3. The model metadata file stores only `apiKeyConfigured` — never a plaintext key;
4. The renderer only ever sees redacted model summaries;
5. Add an atomic migration for legacy plaintext keys: write to secure storage first, then clear
   the old field;
6. A failed migration must never delete the only valid credential;
7. Deleting a model deletes its secure credential;
8. Logs, diagnostics, error reports, and settings exports must never contain keys;
9. When Linux secure storage is unavailable, warn explicitly — never silently degrade to
   plaintext.

#### Acceptance criteria

- `models.json` contains no plaintext keys;
- the renderer, logs, and diagnostic files contain no keys;
- legacy-data migration and failure rollback are tested;
- the OOMOL token and model keys use separate storage and lifecycles.

<<<<<<< HEAD
Renderer 只会收到 `CustomModelSummary.apiKeyConfigured`，不会读回 Key；用户在模型表单中新输入的 Key 只通过
`saveCustomModel` IPC 单向进入主进程。新增/更新时先写安全凭证、再写元数据，元数据失败会恢复旧凭证或删除
新凭证；删除时先删安全凭证，元数据失败则恢复凭证。旧版迁移若安全写入失败，原明文文件保持不变；若密文
写入成功但元数据清理失败，则暂时保留两份并在下次启动重试，绝不删除唯一有效副本。

### 阶段 8：移除社区安装的私有依赖

> 工程状态：两个 `@oomol/connection*` 精确版本已迁移到公共 npm，仓库和 lockfile 不再依赖私有
> registry；项目 metadata 已包含许可证、仓库、主页、问题地址、Node 与 npm 版本。根据产品边界，默认
> `postinstall`、`predev` 和平台打包继续准备并携带 oo CLI 1.5.1，local runtime 只是不生成 oo 环境或
> Connector tools；第三方发行方可通过构建期 `WANTA_ENDPOINT` 对接 endpoint-compatible 的自部署
> OpenConnector 服务。未登录界面现已保留“连接”和“技能”入口：“连接”显示自部署配置的明确 TODO，
> “技能”可以匿名浏览、搜索公开目录并查看本机清单。隔离目录已在无 PAT、无用户 `.npmrc`、无预存 `.oo-bin` 条件下完成 `npm ci`、
> 全质量门、production build、dev server 启动和 `prepare:binaries` 验证；打包中转目录确认包含可执行的
> oo、opencode 与 rg。oo CLI 和内置 Skills 已按上游 MIT 许可证记录；两个 IPC 包仅剩 package license
> metadata 的上游补全项，不作为默认构建或发布的阻塞项。

#### 目标

公开仓库可以在没有 PAT、Cookie、内部 `.npmrc` 和预装 oo CLI 的环境中直接安装、构建和运行。
默认安装与默认打包继续下载并携带 oo CLI：官方 OOMOL Connector 和第三方基于 OpenConnector 的兼容
自部署服务都复用这条调用通道；是否实际启用 Connector 由运行模式和用户配置决定，而不是由构建是否携带
二进制决定。
=======
### Stage 8: remove private dependencies from community installs

#### Goal

The public repo installs and runs its core features in an environment with no PAT, no cookies,
and no oo CLI. The PAT half is **done** (#195); oo CLI optionalization is the remaining open work
in this stage.
>>>>>>> origin/main

#### `@oomol/connection*` handling order

1. Preferred: publish `@oomol/connection` and `@oomol/connection-electron-adapter` as public
   packages — **done** (#195): both resolve from the public npm registry, the repo has no
   `.npmrc`, and CI passes no `NODE_AUTH_TOKEN`;
2. (fallback — no longer needed) if standalone publishing did not suit, migrate the implementation
   into repo workspace packages;
3. (fallback — no longer needed) if publication was impossible, replace with a public or in-house
   type-safe Electron IPC layer;
4. Regardless of the option taken, the security boundary must survive: credentials never enter the
   renderer. This invariant remains binding.

<<<<<<< HEAD
#### oo CLI 默认内置、按能力使用

- `postinstall` 默认下载钉死版本的 oo CLI，fresh clone 不要求开发者预先安装；
- `predev` 校验仓库管理的 oo CLI 与版本 marker，避免 Connector 真正调用时才暴露损坏安装；
- `prepare:binaries` 和默认平台构建始终将 oo CLI 与内置 Skills 打入应用；
- local runtime 不生成 oo CLI 环境、不注册 Connector tools，也不要求用户登录或配置 Connector；
- OOMOL runtime 才把 oo 路径、会话凭证和 endpoint 注入 Agent sidecar；
- 第三方当前可在构建时通过 `WANTA_ENDPOINT` 指向与现有 endpoint 约定兼容的自部署服务，oo CLI 继续作为
  OpenConnector 调用通道；后续要增加运行时 Base URL、可选 Runtime Token、连通性检查和自部署控制台载入，
  当前“连接”页面保留此功能入口与 TODO，不用登录门禁代替它；
- 公开 Skill 列表和搜索使用匿名接口，未登录即可访问；本机 Skill 清单和文档预览同样不依赖登录；
- Skill 安装、更新、发布、“我的发布”、团队 Skill 等需要 oo 或账号凭证的操作继续受登录能力门控，不能因
  公开目录可读而误判为匿名可写；
- `WANTA_OO_BIN` 只作为开发者覆盖路径；CI 可用 `OO_SKIP_BINARY_DOWNLOAD=1` 跳过不需要打包的下载步骤，
  但正式打包会由 `prepare:binaries` 重新确保二进制存在；
- oo CLI 与内置 Skills 按 MIT 许可证继续默认随包分发并保留 Notice；两个公开 IPC 包的 package license
  metadata 补全作为上游维护项跟踪，不阻塞默认构建和发布。
=======
#### Making the oo CLI optional

- `postinstall` no longer treats the oo download as a community-core prerequisite;
- `predev` no longer blocks local mode when oo is missing;
- the local runtime neither resolves nor injects oo;
- oo is checked only when the OOMOL Connector capability is enabled;
- official release packages may keep bundling oo;
- community builds may produce an app without oo;
- when oo is missing, only mark the Connector as unavailable.
>>>>>>> origin/main

#### package metadata

- Add `license`, `repository`, `homepage`, and `bugs` — **done**: all four fields are present in
  `package.json`;
- remove the fresh-clone dependence on an internal `.npmrc` and PAT — **done** (#195);
- declare explicit Node/npm versions;
- update the install and build documentation.

#### Acceptance criteria

<<<<<<< HEAD
在没有 PAT、Cookie、预存 `.oo-bin`、内部 `.npmrc` 和内部环境变量的新环境中，`npm install` 会自行准备
oo CLI，以下命令全部成功：
=======
In a fresh environment with no PAT, cookies, `.oo-bin`, internal `.npmrc`, or internal environment
variables, all of the following succeed:
>>>>>>> origin/main

```bash
npm install
npm run ts-check
npm run lint
npm run format
npm test
npm run build
npm run dev
```

### Stage 9: open-source documentation and contribution system

<<<<<<< HEAD
> 工程状态：README 已显式说明 Wanta 使用 OpenCode 1.17.13 作为 Agent engine，并区分 OpenCode 与
> Wanta 自己负责的桌面/runtime 能力；已新增贡献指南、安全政策、Notice、商标政策、第三方声明和 Issue/PR
> 模板。oo CLI 1.5.1 与其四个内置 Skills 按上游 MIT 授权记录，不再列为发布阻塞；两个公开
> `@oomol/connection*` 包只保留上游 package license metadata 补全项。完整传递依赖许可证报告、品牌政策
> 授权确认和 Git 历史 secret scan 仍待完成。未签名 macOS directory package 已验证把 Wanta LICENSE、
> NOTICE、第三方声明、商标政策、OpenCode、oo CLI 和 ripgrep 一并放入应用 Resources。

#### 必须新增或重写
=======
#### Must add or rewrite
>>>>>>> origin/main

- `README.md` — **landed** (#197); verify it covers positioning, screenshots, Quick Start, BYOK,
  local/OOMOL modes, architecture, security, and roadmap;
- `CONTRIBUTING.md`: branching, PRs, quality gates, UI verification, coding and security hard
  rules (still missing);
- `SECURITY.md`: vulnerability reporting, credential storage, the renderer boundary, log
  redaction, and the threat model (still missing);
- `LICENSE` — **landed** (#197); `NOTICE`, `TRADEMARKS.md`, and `THIRD_PARTY_NOTICES.md` still
  missing;
- docs for the runtime, session scope, Agent sidecar, IPC, Connector adapter, and the permission
  loop;
- issue/PR templates and label planning such as `good first issue` and `help wanted`.

#### The README must make clear

<<<<<<< HEAD
- Wanta 不只是聊天气泡 UI，而是完整桌面 Agent 客户端；
- Wanta 使用 OpenCode 作为本地 Agent engine，并说明双方职责和精确钉死版本；
- 不登录可以通过 BYOK 使用；
- 未登录可以浏览公开 Skill，并说明安装、更新和发布的登录边界；
- 自部署 OpenConnector 的运行时配置仍是 TODO，当前入口不得隐藏；
- 登录 OOMOL 后可以使用托管模型和托管 OpenConnector；
- 仓库不包含 OOMOL 云服务端；
- 第三方再发行时的品牌使用限制；
- custom API Key 和 OOMOL token 的保存与数据流。
=======
- Wanta is not just a chat-bubble UI — it is a complete desktop Agent client;
- it is usable without login via BYOK;
- signing in to OOMOL unlocks hosted models and OpenConnector;
- the repo does not contain the OOMOL cloud server side;
- the brand-usage restrictions that apply to third-party redistribution;
- how custom API keys and the OOMOL token are stored, and their data flow.
>>>>>>> origin/main

#### Acceptance criteria

A new contributor with no prior involvement can — using only the repo docs — install, add a model,
chat, run the tests, and land a small PR.

### Stage 10: release validation

#### Automated quality gates

Every code PR must pass:

```bash
npm run ts-check
npm run lint
npm run format
npm test
npm run build
```

Add a community-build CI job:

- provides no `NODE_AUTH_TOKEN`;
- downloads no oo;
- provides no OOMOL cookie;
- runs install, lint, format, ts-check, test, and build.

Keep the OOMOL integration build to validate the Connector runtime and official packaging assets.

#### Runtime test matrix

Local community mode:

- fresh install, no network, no model;
- adding, switching, and deleting models;
- custom provider 401, timeout, and missing tool-call support;
- image input;
- local sessions, projects, files, Shell, and permission prompts;
- Artifacts, Univer, PDF, and Word;
- sidecar reclamation after app restart and abnormal exit.

OOMOL mode:

<<<<<<< HEAD
- 浏览器登录和 deep-link；
- 登录取消、token 过期和账号切换；
- 团队切换；
- Connector search/inspect/call；
- Connector 授权和凭证过期；
- 登出回退本地；
- Billing、Skills 和更新检查。
=======
- browser login and deep-link;
- login cancellation, token expiry, and account switching;
- team switching;
- Connector search/inspect/call;
- Connector authorization and credential expiry;
- signout fallback to local;
- Billing, Skills, and update checks.
>>>>>>> origin/main

Security checks:

- the OOMOL token and custom API keys never enter the renderer;
- renderer state and IPC/RPC payloads contain no `sessionToken`;
- `auth.json` stores only the profile — no credential in any form — keeps `0600` permissions, and
  uses atomic writes; model metadata contains no plaintext credentials;
- logs and deep-links are always fully redacted, especially queries containing `authID`;
- local attachments and sessions are never auto-uploaded after signin;
- the community build contains no private registry, internal credentials, or development
  endpoints.

## 6. Recommended PR breakdown

All branch names, commit messages, PR titles, and descriptions are in English.

| PR  | Suggested branch name                | Content                                                                     | Depends on               |
| --- | ------------------------------------ | --------------------------------------------------------------------------- | ------------------------ |
| 1   | `codex/runtime-capabilities`         | Runtime capabilities and Agent state                                        | None                     |
| 2   | `codex/local-workspace`              | Local workspace and SessionScope migration                                  | PR 1                     |
| 3   | `codex/local-agent-runtime`          | Start a custom-model Agent without an OOMOL token                           | PR 1, 2                  |
| 4   | `codex/capability-prompts`           | Capability-based system prompt and Connector tools                          | PR 3                     |
| 5   | `codex/passwordless-app-shell`       | Remove the login wall and add model onboarding                              | PR 2, 3                  |
| 6   | `codex/cloud-runtime-switching`      | Runtime switching after signin, signout, and expiry                         | PR 3, 4, 5               |
| 7   | `codex/secure-model-credentials`     | API key secure storage and migration                                        | Parallel to PR 4–6       |
| 8   | `codex/public-dependencies`          | Public IPC dependencies (**done**, #195) and oo optionalization (remaining) | Dependency decisions     |
| 9   | `codex/open-source-metadata`         | NOTICE and trademark files; LICENSE and package metadata **already landed** | After legal signoff      |
| 10  | `codex/community-documentation`      | CONTRIBUTING, SECURITY, and architecture docs (README **landed**, #197)     | After features stabilize |
| 11  | `codex/community-release-validation` | CI, fresh clone, and cross-platform validation                              | All of the above         |

Every PR must keep the existing quality gates green; UI or runtime changes additionally require
the corresponding live verification.

## 7. Milestones

### Milestone A: local MVP

- runtime capabilities;
- local workspace;
- custom-model startup;
- login wall removed;
- no Connector exposure in local mode;
- local sessions and local tools usable.

Result: Wanta's chat and local Agent core are usable without signing in.

### Milestone B: dual-mode stability

<<<<<<< HEAD
- 登录后启用 OOMOL；
- 登出和 token 过期后回退本地；
- 本地和团队 workspace 并存；
- Connector capability 动态装配；
- 系统提示动态组合。
=======
- OOMOL enabled after signin;
- fallback to local after signout and token expiry;
- local and team workspaces coexist;
- Connector capability assembled dynamically;
- system prompt composed dynamically.
>>>>>>> origin/main

Result: community mode and the OOMOL-enhanced mode switch stably within one app.

### Milestone C: publicly developable

<<<<<<< HEAD
- 私有 npm 依赖处理；
- oo CLI 默认随包分发、Connector 按运行模式启用；
- fresh clone；
- API Key 安全存储；
- community CI。
=======
- private npm dependencies handled — **done** (#195);
- oo made optional;
- fresh clone;
- API key secure storage;
- community CI.
>>>>>>> origin/main

Result: external developers build and contribute without an OOMOL PAT.

### Milestone D: official open-source release

- license (**done**, #197), trademark, and third-party notices;
- Git history audit;
- README (**landed**, #197), CONTRIBUTING, and SECURITY;
- cross-platform builds;
- the first open-source release.

Result: the repo meets the bar of a trustworthy, runnable, contributable, and long-term
maintainable open-source release.

## 8. Rough effort

Rough estimates for one engineer already familiar with the repo; legal approval and cross-team
waits excluded:

<<<<<<< HEAD
| 模块                          | 粗略工作量 |
| ----------------------------- | ---------: |
| Runtime capability 建模       |     2–4 天 |
| 本地 workspace 与数据迁移     |     3–5 天 |
| 未登录 Agent + BYOK           |     4–7 天 |
| Prompt / Connector 能力化     |     3–5 天 |
| 移除登录墙与 onboarding       |     3–5 天 |
| 登录、登出和过期切换          |     4–7 天 |
| 模型凭证安全存储              |     3–5 天 |
| IPC 公共 registry 与授权验证  |    2–10 天 |
| oo CLI 公共下载与默认分发验证 |     2–4 天 |
| 文档与开源 metadata           |     3–5 天 |
| CI、跨平台和 fresh clone 验证 |     4–7 天 |
=======
| Module                                         |                                                                                 Rough effort |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------: |
| Runtime capability modeling                    |                                                                                     2–4 days |
| Local workspace and data migration             |                                                                                     3–5 days |
| Not-signed-in Agent + BYOK                     |                                                                                     4–7 days |
| Prompt / Connector capability assembly         |                                                                                     3–5 days |
| Login wall removal and onboarding              |                                                                                     3–5 days |
| Signin, signout, and expiry switching          |                                                                                     4–7 days |
| Model credential secure storage                |                                                                                     3–5 days |
| Private IPC dependency publication/replacement |                                             **done** — published publicly, no remaining work |
| oo CLI optionalization                         |                                                                                     2–4 days |
| Docs and open-source metadata                  | 3–5 days (LICENSE/README/metadata landed; NOTICE, trademarks, CONTRIBUTING, SECURITY remain) |
| CI, cross-platform, and fresh clone validation |                                                                                     4–7 days |
>>>>>>> origin/main

Suggested pacing:

<<<<<<< HEAD
- 本地可用 MVP：约 2–3 周；
- 双模式稳定：约 3–4 周；
- 正式开源发布质量：约 4–6 周；
- 两个 IPC 包现已公开发布，无需为私有包替换预留额外重写周期。
=======
- locally usable MVP: about 2–3 weeks;
- dual-mode stability: about 3–4 weeks;
- official open-source release quality: about 4–6 weeks;
- the extra 1–2 weeks once reserved for a full rewrite of the private IPC packages is no longer
  needed — they are public.
>>>>>>> origin/main

## 9. Main risks

### 9.1 Implementing local mode as a "fake account"

<<<<<<< HEAD
风险：团队、账单、401 和数据归属逻辑会持续产生特殊分支。
=======
Risk: team, billing, 401, and data-ownership logic keeps spawning special-case branches.
>>>>>>> origin/main

Control: introduce a formal local identity and local workspace; forging an `authenticated` state
is forbidden.

### 9.2 Agent tools, permissions, and prompt drifting apart

Risk: the model calls a nonexistent Connector, or Plan / Build permission semantics regress.

Control: tools, permission, and system prompt consume the same capability input, plus runtime
composition tests.

### 9.3 Runtime switching producing multiple sidecars

Risk: orphan processes, cross-wired events, workspace conflicts, and token-lifecycle errors.

Control: keep the serial assembly chain — a new instance starts only after the old sidecar is
fully reclaimed — and cover it with concurrency tests.

### 9.4 BYOK credentials stored in plaintext

Risk: user trust and the security boundary cannot hold.

Control: migrate to OS secure storage before the official release; the renderer only ever gets
`apiKeyConfigured`.

### 9.5 Repo public but not installable

Risk: the day-one open-source experience fails and the project is seen as display-only source.

Control: community CI provides no PAT, and Quick Start is independently verified on a clean
machine. The PAT half of this risk is already retired — the `@oomol/*` packages are on public npm
(#195); the CI job exists to keep it that way.

### 9.6 Unclear brand and third-party asset licensing

Risk: forced emergency asset removal after publication, or redistribution disputes.

Control: audit the code license, trademark license, and binary/asset licenses separately and
produce a written inventory. The code license is settled (Apache-2.0, #197); the trademark and
third-party notices are still open.

## 10. Definition of done

Open-sourcing counts as complete only when all of the following hold:

<<<<<<< HEAD
- 用户第一次启动不需要登录；
- 用户可以使用自己的模型 API；
- 用户可以完成真实聊天和本地 Agent 工作；
- 本地会话和项目可以持久化；
- OOMOL 登录是可选能力；
- 未登录时模型不知道 Connector 工具存在；
- 登录后现有 Connector 能力没有明显退化；
- 登出和 token 过期后本地功能仍然可用；
- 社区安装不需要私有 PAT；
- 社区不需要单独安装或配置 oo CLI 即可运行本地核心；
- 自定义模型 Key 不明文保存；
- 仓库具备正式开源许可证；
- 商标和第三方资源许可清晰；
- fresh clone 文档经过独立验证；
- 自动化质量门和跨平台 smoke 验证通过。
=======
- first launch requires no login;
- users can use their own model API;
- users can complete real chats and local Agent work;
- local sessions and projects persist;
- OOMOL login is an optional capability;
- when not signed in, the model does not know Connector tools exist;
- after signin, existing Connector capabilities show no visible regression;
- local functionality survives signout and token expiry;
- community installs require no private PAT — **already true** (#195);
- the community does not need the oo CLI to run the core;
- custom model keys are never stored in plaintext;
- the repo carries a formal open-source license — **already true** (Apache-2.0, #197);
- trademark and third-party asset licensing are clear;
- the fresh-clone docs are independently verified;
- automated quality gates and cross-platform smoke verification pass.
>>>>>>> origin/main

The critical path is:

```text
Runtime capability
→ Local workspace
→ Local Agent with BYOK
→ Remove login wall
→ Capability-based Connector
→ Stable login/logout switching
→ Public installability
→ Security and release audit
```

The first four items alone yield a local MVP with real product value; the later stages decide
whether the project can go open source in a trustworthy, contributable, and long-term maintainable
way.
