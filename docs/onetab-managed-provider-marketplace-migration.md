# OneTab 官方托管 Provider / OOMOL Marketplace 迁移分析

更新时间：2026-08-28（Asia/Shanghai）

> 本文把“OneTab”视为当前 Wanta 桌面端代码库的目标产品名称；实施基线为分支
> `codex/enable-managed-oo-file-flow`。初稿用于调研与方案设计，后续实现已经按本文推荐的数据边界落地。

## 实施状态

当前分支已经完成：

- 删除旧的单一 `ConnectionAuthType`，拆分 credential auth 与 app auth。
- 原生解析 `authType: marketplace` 和 `marketplace.id/pricing`。
- Marketplace app 进入 Provider 状态、多账号列表、Team access 和 Agent connection selector。
- 展示“OOMOL 内置账号”“OOMOL 托管”和 Credits 提示。
- Marketplace app 禁止 alias、reconnect、disconnect 和 credential mutation。
- 管理员仍可查看 execution logs 和配置 Team/Action access。
- 增加 `PUT /v1/connections/services/:service/default`，支持 Marketplace 与用户连接互相切换默认值。
- OpenCode host Link 和外部 BYOA guarded OOCLI 都保留 `marketplace_oomol` selector。
- 增加 mixed Marketplace + user credential、默认连接、权限错误、UI 和 Agent 回归测试。
- 覆盖 Marketplace → 用户连接、用户连接 → Marketplace 的双向默认切换。
- 覆盖成员 `/v1/apps` 可见性、Marketplace 目录消失、free/metered 展示和 virtual app 时间边界。
- 覆盖 unsupported Action、Credits、429、托管 credential failure 和 Team policy denied 不进入错误的凭据连接流程。

仍需真实账号手测 TinyPNG/TikHub 的服务端返回、Credits 错误和 execution log access surface；不需要再新增客户端架构层。

## 1. 结论摘要

`console.oomol.com` 最近增加的“Provider 无需用户配置 API Key 即可使用”能力，准确名称是
**OOMOL Marketplace managed connection**。它不是前端绕过 Key，也不是把官方 Key下发到客户端，而是：

1. Connector 服务端为受支持的 Provider 注入托管凭据。
2. 服务端为每个 Provider 派生一条只存在于运行时的 Marketplace virtual connection。
3. 客户端只看到 `authType: "marketplace"`、Marketplace ID 和计费模式，不接触托管 Key。
4. Action 执行仍经过服务端 allowlist、schema 校验、权限策略、计量和日志。
5. Marketplace connection 可以和用户自配 OAuth/API Key connection 并存，并可成为当前用户在某个 Team 下的默认连接。

当前首批官方托管 Provider 是：

- TinyPNG：`tinypng.shrink_image`、`tinypng.output_image`
- TikHub：`tikhub.discover_endpoints`、`tikhub.invoke_endpoint`

这里的“支持 Provider”实际是**支持部分 Action**，不是保证该 Provider 的全部 Action 都能走官方账号。OneTab
不能只按 service 硬编码“免 Key”，必须以 `/v1/apps` 或 `/v1/connections` 返回的 Marketplace app 和服务端
Action policy 为事实来源。

OneTab/Wanta 目前已经使用相同的 Connector API，并已经具备 Provider 目录、Team scope、`/v1/apps`
成员视图、`/v1/connections` 管理视图、多账号列表和 `connectionName` 选择能力。因此不需要复制 Marketplace
后端，主要迁移工作位于：

- 数据契约和归一化
- Marketplace connection 的 UI/操作边界
- 默认连接选择
- Agent/Chat 连接选择和错误语义回归测试

推荐按两个实现 PR 推进：

1. **PR A：正确读取和展示 Marketplace virtual connections，并禁止不适用的凭据操作。**
2. **PR B：补齐 Marketplace/用户自配连接之间的默认连接切换和 Agent 端到端验证。**

## 2. 调研范围与来源

### Console 前端 PR

| PR                                                                 | 作用                                                             | 对 OneTab 的意义                                             |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| [console#306](https://github.com/oomol/console.oomol.com/pull/306) | 支持 Marketplace app 类型、托管账号标识、计费提示和只读管理边界  | 本次迁移的直接前端参考                                       |
| [console#300](https://github.com/oomol/console.oomol.com/pull/300) | 新用户默认进入发现页，已有连接用户进入管理页                     | OneTab 当前已经有 Discover/Manage 结构，可参考但不必重复迁移 |
| [console#299](https://github.com/oomol/console.oomol.com/pull/299) | 拆分连接管理与发现、增加任务型分类和筛选                         | OneTab 已有相近实现                                          |
| [console#290](https://github.com/oomol/console.oomol.com/pull/290) | 管理员读 `/v1/connections`，普通成员读 policy-visible `/v1/apps` | OneTab 当前已经采用同样的 endpoint 选择                      |
| [console#270](https://github.com/oomol/console.oomol.com/pull/270) | OAuth scope 选择                                                 | 与 Marketplace 不同；用户自配 OAuth 路径仍需保留             |
| [console#251](https://github.com/oomol/console.oomol.com/pull/251) | OAuth 回调后打开应用                                             | 与 Marketplace 本身无直接依赖                                |
| [console#248](https://github.com/oomol/console.oomol.com/pull/248) | Provider OAuth client config                                     | 属于用户自配 OAuth client，不是官方托管凭据                  |

### Connector 后端 PR

| PR                                                                   | 作用                 | 核心结果                                                   |
| -------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------- |
| [connector#2378](https://github.com/oomol/oomol-connector/pull/2378) | OOMOL Marketplace v1 | 虚拟连接、托管凭据、Action allowlist、计量、公开协议       |
| [connector#2381](https://github.com/oomol/oomol-connector/pull/2381) | Marketplace 默认连接 | 允许把 virtual connection 持久化为用户/Team/service 默认值 |
| [connector#2390](https://github.com/oomol/oomol-connector/pull/2390) | TikHub Marketplace   | 在 TinyPNG 之外新增 TikHub 托管调用                        |

## 3. 真实架构：免 Key 发生在哪里

### 3.1 调用链

```text
OneTab UI / Agent
  │
  │ appId = marketplace:oomol:<service>
  │ connectionName = marketplace_oomol
  ▼
OOMOL Connector
  ├─ 校验 Team、成员和 Action policy
  ├─ 校验该 Marketplace connection 是否支持目标 Action
  ├─ 校验 Action input schema
  ├─ 从服务端 env / secret manager 解析托管 credential
  ├─ 调用 Provider
  ├─ 记录 execution log
  └─ 记录 Marketplace source、billing subject 和 usage
```

托管 Key 始终在 Connector 服务端。OneTab 不应新增读取、保存、缓存或展示官方 Provider Key 的代码。

### 3.2 Virtual connection 数据形状

服务端派生的典型对象：

```json
{
  "id": "marketplace:oomol:tikhub",
  "service": "tikhub",
  "connectionName": "marketplace_oomol",
  "authType": "marketplace",
  "status": "active",
  "isDefault": true,
  "providerAccountId": "oomol:tikhub",
  "accountLabel": "OOMOL Marketplace",
  "displayName": "OOMOL Marketplace",
  "marketplace": {
    "id": "oomol",
    "pricing": "metered"
  }
}
```

关键属性：

- ID 是稳定、可选择的虚拟 app ID：`marketplace:oomol:<service>`。
- alias/connectionName 是 `marketplace_oomol`。
- `authType: marketplace` 只存在于 app view；Provider 的可配置 `authTypes` 仍然是 OAuth、API Key、custom credential、federated 或 no-auth。
- virtual connection 不对应数据库里的普通 credential app，也不存在可展示的 credential detail。
- `pricing` 目前只有 `free | metered`，不能推导单次调用的精确价格。

### 3.3 连接选择顺序

无显式 selector 时，Connector 按以下顺序选择：

1. 当前用户在该 Team/service 下保存的 default connection。
2. 支持当前 Action 的本地 `no_auth` connection。
3. 支持当前 Action 的 Marketplace virtual connection。

如果同时存在用户自配连接和 Marketplace connection：

- 两者都应在账号列表中可见。
- 用户可以显式选择 `marketplace:oomol:<service>` 或 `marketplace_oomol`。
- 默认连接决定没有 selector 时的执行目标。
- Marketplace 只允许执行其 allowlist 中的 Action；用户自配连接仍可拥有更多 Action。

### 3.4 当前计量

当前 Marketplace definition 的顶层 `pricing` 是 `metered`。具体 Action 策略为：

| Action                      | 当前计量策略                                      |
| --------------------------- | ------------------------------------------------- |
| `tinypng.shrink_image`      | 使用 `fusion-api/tinify-png-shrink/compress` 计量 |
| `tinypng.output_image`      | 无额外 Marketplace usage override                 |
| `tikhub.discover_endpoints` | 无额外 Marketplace usage override                 |
| `tikhub.invoke_endpoint`    | 使用 `fusion-api/proxy/tikhub/request` 计量       |

因此 UI 应使用“调用可能消耗 OOMOL Credits”之类的保守描述，不应显示统一的单次价格。

## 4. Console 当前实现的关键做法

### 4.1 类型分层

Console 没有把 `marketplace` 加进 Provider 可配置凭据类型，而是拆成：

```ts
type ConnectorCredentialAuthType = "oauth2" | "api_key" | "custom_credential" | "federated" | "no_auth"

type ConnectorAppAuthType = ConnectorCredentialAuthType | "marketplace"
```

这是正确边界：Marketplace 是一个已存在 app 的执行模式，不是用户可以在“新增连接”表单中选择的 credential
类型。

### 4.2 UI 以 connection 为单位标记

Console 通过 `app.marketplace != null` 判断托管连接，而不是根据 Provider service 硬编码。

展示包括：

- “OOMOL Built-in Account / OOMOL Managed”标签
- 校验徽标
- `metered` 时的 Credits 提示
- 仍允许同 Provider 新增用户自配连接

### 4.3 禁止无意义的凭据管理

Marketplace app 不应执行：

- OAuth reconnect
- API Key/custom credential 编辑
- credential detail 展示
- disconnect
- alias/comment 修改

默认连接切换是例外：connector#2381 明确支持把 virtual app ID 保存为 default。

### 4.4 成员与管理员共用服务端 policy

Marketplace virtual app 会进入 Team discovery policy：

- 管理员通过 `/v1/connections` 查看管理面。
- 普通成员通过 `/v1/apps` 只看到 policy-visible apps。
- Action allowlist 同时受 Marketplace action 集和 Team app/action policy 约束。

客户端不应因为它是“官方账号”而绕过 Team 权限。

## 5. OneTab 当前状态

### 5.1 已经具备的基础

OneTab 当前已经完成：

- `/v1/connections` 与 `/v1/apps` 按 Team 管理权限选择。
- Provider 公共目录与 workspace app 状态分开加载。
- `ConnectionAppSummary`、Provider 聚合和多账号列表。
- `connectionName`、app ID 和默认 app 信息读取。
- Discover/Manage 视图、任务型分类、搜索和连接状态筛选。
- Team connection access policy UI。
- Agent `list_apps`、schema、run 与显式 connection selector。
- 统一的 OOMOL Link runtime 和 guarded OOCLI。

所以不需要引入新的 Marketplace API client；现有 Connector client 即可读取后端新增对象。

### 5.2 当前阻塞问题

#### A. `marketplace` 被归一化为 `null`

`electron/connections/summary.ts` 的 auth type allowlist 目前不包含 `marketplace`。后端返回的 Marketplace app 会被转换为：

```ts
authType: null
```

同时 `RawApp` 没有 `marketplace` 字段，`pricing` 和 Marketplace ID 会完全丢失。

#### B. Marketplace app 被当成普通可管理连接

当前 `isManageableApp()` 只排除 `no_auth:*` 和 disconnected app。Marketplace app 会进入：

- `appCount`
- `apps`
- `canDisconnect`
- 账号详情和别名编辑

这意味着 OneTab 可能错误显示“重连”“断开”“修改别名”“查看凭据”等操作。

#### C. Provider action kind 会误导新增连接流程

Provider 的 `authTypes` 仍然会包含 `api_key` 等用户凭据类型，这是正确的，因为用户仍应能添加自己的 Key。
但当当前选中的 app 是 Marketplace 时，OneTab 不能把它的 `authType` 反推成用户配置表单类型，也不能把
Marketplace connection 的状态卡显示为 API Key account。

#### D. 没有默认连接切换 API/UI

OneTab 当前会读取 `isDefault`，但没有调用 Connector 的：

```http
PUT /v1/connections/services/:service/default
{ "appId": "marketplace:oomol:<service>" }
```

当用户同时拥有官方托管连接和自配 Key 时，缺少默认选择会让“无 selector 调用哪个连接”不透明。

#### E. “免配置”和“官方托管”是不同概念

OneTab 已有 `no_auth` 的“No setup / 免配置”分类。Marketplace 与它不同：

- `no_auth`：Provider 本身不需要账号或凭据，通常没有持久 app。
- `marketplace`：真实使用服务端托管凭据，可能计费，并且是可选择、可设默认的 virtual app。

不应把 Marketplace 直接塞进现有 `isDirectlyAvailableProvider()`。

## 6. 推荐的数据模型

### 6.1 拆分 Credential auth 与 App auth

建议把当前 `ConnectionAuthType` 拆成：

```ts
export type ConnectionCredentialAuthType = "oauth2" | "api_key" | "custom_credential" | "federated" | "no_auth"

export type ConnectionAppAuthType = ConnectionCredentialAuthType | "marketplace"
```

使用规则：

- Provider `authTypes`、`ConnectionConnectInput`、ConnectDialog 只接受 `ConnectionCredentialAuthType`。
- App summary/detail 的 `authType` 使用 `ConnectionAppAuthType | null`。
- `marketplace` 永远不能进入 connect form switch。

### 6.2 保留 Marketplace metadata

```ts
export interface ConnectionMarketplaceSummary {
  id: string
  pricing: "free" | "metered"
}

export interface ConnectionAppSummary {
  // existing fields...
  authType: ConnectionAppAuthType | null
  marketplace?: ConnectionMarketplaceSummary
}
```

`RawApp`、`normalizeApp()`、缓存和测试 fixture 都要同步。

### 6.3 明确三个 predicate

不要继续用一个 `isManageableApp()` 同时表达展示、执行和修改：

```ts
isVisibleConnectedApp(app) // 普通 app + Marketplace；不含 disconnected
isVirtualConnection(app) // no_auth:* 或 marketplace metadata/id
isUserManagedCredentialApp(app) // 允许 reconnect/disconnect/edit credential/alias
```

建议规则：

| 能力                           | 普通凭据 app | no_auth virtual app | Marketplace virtual app |
| ------------------------------ | -----------: | ------------------: | ----------------------: |
| 在可用连接中展示               |           是 |                  是 |                      是 |
| Agent 可显式选择               |           是 |                  是 |                      是 |
| 可设为默认                     |           是 |            通常无需 |                      是 |
| 可重连                         |           是 |                  否 |                      否 |
| 可断开                         |           是 |                  否 |                      否 |
| 可编辑 alias/comment           |           是 |                  否 |                      否 |
| 可查看 credential detail       |           是 |                  否 |                      否 |
| 受 Team app/action policy 控制 |           是 |                  是 |                      是 |

## 7. 推荐 UI

### 7.1 Provider 卡片

如果 Provider 至少有一个 Marketplace app：

- 状态应计入“可用工具”或“已连接”，但不要标成普通 API Key 连接。
- 显示“OOMOL 官方托管”或“OOMOL 内置账号”标识。
- `metered` 时显示“调用可能消耗 OOMOL Credits”。
- 不硬编码 TinyPNG/TikHub；完全根据 app metadata 渲染。

### 7.2 Provider 详情

Marketplace app 详情建议展示：

- 账号名：OOMOL 内置账号
- 认证方式：OOMOL 托管
- 计费：免费或可能消耗 Credits
- connectionName（高级信息，可复制）：`marketplace_oomol`
- app ID（高级信息，可复制）
- 默认状态

隐藏：

- 凭据字段
- OAuth scope/client config
- reconnect/disconnect
- alias/comment 编辑
- “更新时间”（virtual app 的时间通常是 0）

### 7.3 多账号选择

同一个 Provider 同时存在 Marketplace 和用户自配连接时：

- Marketplace app 是一张独立账号卡。
- 用户自配 Key/OAuth app 继续正常显示。
- 允许将任意一条设为默认。
- 当前默认用现有 Default badge 表示。
- “添加连接”仍进入 Provider 原有 OAuth/API Key/custom credential 流程。

### 7.4 Filter

不建议把 Marketplace 合并进 `no_auth` 的“免配置”筛选。建议新增：

- “OOMOL 托管”筛选，或
- 统一成“开箱可用”，内部包含 no-auth 和 Marketplace，但详情 badge 必须区分两者。

第一版可以不新增筛选，只保证 Marketplace provider 正确出现在“可用工具”和“我的连接”。

## 8. Agent 与运行时迁移

### 8.1 不新增 Agent 专用 Marketplace 工具

Marketplace 已经通过 Connector app/action 模型暴露。Claude Code、Codex、Grok 和 OpenCode 都应继续使用现有：

- `list_apps`
- schema/search
- `connector run`
- `connectionName` 或 app ID selector

不应新增 `marketplace_run`、Marketplace MCP 或绕过 Connector 的 HTTP 调用。

### 8.2 保留选择信息

需要验证：

- `list_apps` 返回 `marketplace_oomol`。
- 显式 selector 能选择 Marketplace connection。
- 用户设为默认后，无 selector 能走 Marketplace。
- Marketplace 与用户 Key 并存时不会产生 `connection_ambiguous`。
- Marketplace 不支持的 Action 不会错误回退到官方托管凭据。
- Team policy 禁止的 Action 即使在 Marketplace allowlist 中也不能执行。

### 8.3 Authorization overlay

OneTab 当前会把 Connector authorization failure 转成连接引导。需要区分：

- Provider 没有任何可用连接：继续提示连接。
- Marketplace app 因 Team policy 不可见：提示访问受限，不要让用户填写 API Key来“修复”。
- Marketplace action 不在 allowlist：提示该 Action 需要用户自配连接或当前不可用。
- Credits/余额/限流：显示计费或限流错误，不要跳转到凭据配置。
- 托管 credential 服务端不可用：显示官方托管服务暂时不可用，不要暴露内部 env/secret 信息。

## 9. 实施拆分

### PR A：读取、归一化和安全展示（已完成）

建议修改：

- `electron/connections/common.ts`
- `electron/connections/summary.ts`
- `electron/connections/summary.test.ts`
- `src/routes/Connections/connection-route-model.ts`
- `src/routes/Connections/ConnectionCatalog.tsx`
- `src/routes/Connections/ConnectionProviderDetailPane.tsx`
- `src/routes/Connections/ConnectionAccountsList.tsx`
- 中英文 i18n

内容：

1. 拆分 credential/app auth type。
2. 解析并保留 `marketplace` metadata。
3. 增加 Marketplace predicate。
4. 正确计算 Provider 状态和 appCount。
5. 显示官方托管和 Credits 信息。
6. 禁止 reconnect/disconnect/alias/credential detail。
7. 保留 Team access 入口。
8. 为 mixed Marketplace + user app 增加回归测试。

### PR B：默认连接与 Agent parity（已完成；真实服务 smoke 待执行）

建议修改：

- `src/lib/connections-client.ts`
- `src/hooks/useConnections.ts`
- `src/routes/Connections/ConnectionAccountsList.tsx`
- Agent host capability / Link 集成测试
- Authorization overlay 测试

内容：

1. 增加 set-default API。
2. 在账号列表允许将 Marketplace 或用户 app 设为默认。
3. mutation 后失效 workspace app cache 和持久缓存。
4. 验证 OpenCode、Claude Code、Codex、Grok 的默认/显式选择一致。
5. 验证 Marketplace action policy 和 Team policy 双重限制。
6. 验证计费、限流和托管 credential unavailable 不进入错误的 connect flow。

### 可选 PR C：日志和计费体验

在后端 execution-log access surface 稳定后再做：

- Marketplace execution log 展示
- Marketplace source 标识
- execution ID 复制
- Credits 使用入口
- billing subject/usage 的用户可理解摘要

不要依据 console#306 的早期 PR 描述直接永久隐藏日志；当前 Console 主分支已经重新展示
`ProviderLogsPanel` 并传递 management/runtime access surface。OneTab 应以当前 Connector endpoint 的实际权限为准。

## 10. 测试矩阵

### 归一化

- `authType: marketplace` 不再变成 `null`。
- `marketplace.id`、`pricing` 被保留。
- 未知 auth type 仍 fail closed 为 `null`。
- 普通 app 和 no-auth 行为不回归。

### Provider 聚合

- 只有 Marketplace app：Provider 可用、appCount 正确、不可断开。
- Marketplace + 一个用户 app：两条都展示，默认标识正确。
- Marketplace + 多个用户 app：不丢连接，不误判 ambiguous。
- Marketplace app 不计入“用户已配置凭据数”时，相关文案和统计口径明确。

### UI

- 显示官方托管 badge。
- `metered` 显示 Credits 提示，`free` 不显示误导性计费文案。
- 不显示 reconnect、disconnect、credential detail、alias 编辑。
- 仍显示添加自有连接。
- Marketplace 的 `updatedAt: 0` 不显示 1970 日期。
- 普通成员只能看到 policy-visible Marketplace app。

### 默认与执行

- 设置 Marketplace 为默认。
- 从 Marketplace 切回用户 app。
- 显式 app ID/alias 选择。
- 无 selector 使用保存的 default。
- Action 不在 Marketplace allowlist 时拒绝或选择用户 app，不越权回退。
- Team policy 拒绝优先于 Marketplace availability。

### 错误处理

- 余额不足
- Marketplace 429
- 托管 credential unavailable
- Provider error
- app/action policy denied
- Marketplace app 暂时从目录消失

## 11. 风险与非目标

### 风险

1. **把 Provider-level availability 当成 Action-level availability。** Marketplace 只托管部分 Action。
2. **把 Marketplace 当 no-auth。** 会丢失计费、默认选择和虚拟 app 身份。
3. **暴露普通凭据操作。** disconnect/alias/reconnect 对 virtual app 不成立。
4. **覆盖用户自配连接。** 官方托管必须是附加选项，不是替代 OAuth/API Key。
5. **错误处理进入连接流程。** Credits、限流和 policy denied 不是“缺 Key”。
6. **硬编码首批 Provider。** Catalog 会继续扩展，应以服务端 app metadata 为准。

### 非目标

- 不在 OneTab 内保存 OOMOL Marketplace API key。
- 不把官方 Provider credential 下发到 Electron 或 renderer。
- 不复制 Connector Marketplace execution service。
- 不新增平行 MCP/HTTP Provider 执行路径。
- 不在第一版实现 Marketplace trigger、proxy 或文件中转。
- 不因官方托管连接绕过 Team app/action policy。

## 12. 推荐决策

建议迁移，且优先级较高。原因是 Connector 后端已经上线并通过现有 `/v1/apps`、`/v1/connections` 和
Action 执行协议返回 Marketplace virtual connections；OneTab 当前的主要问题不是缺后端，而是会丢弃新字段并把
virtual app 错当成普通用户凭据连接。

推荐采用以下产品定义：

> OOMOL 官方托管连接是一条可选择、可设默认、受 Team policy 控制、可能消耗 Credits 的虚拟连接。它让用户无需
> 提供 Provider Key 即可调用服务端明确托管的 Action，同时保留添加和选择用户自有连接的能力。

第一阶段不要宣传“该 Provider 全部免 Key”，应使用“部分官方托管能力可直接使用”或“OOMOL 内置账号”这类准确文案。
