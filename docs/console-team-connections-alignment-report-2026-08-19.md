# console.oomol.com 团队管理与应用连接对齐报告

**检查日期：** 2026-08-19  
**console 基线：** `oomol/console.oomol.com` `main@0df3b64`  
**对比对象：** 本仓库 Wanta 当前工作树（团队管理、连接管理及 Agent 团队作用域）

## 结论

console 最近把“团队”和“应用连接”从“按 Provider 给用户授权”的旧模型，升级成了“按具体 Connection App ID 管理成员可见性和 Action 可调用范围”的模型。两项改动并不独立：团队作用域决定请求和 Agent 的工作空间，Connection App 的策略决定普通成员实际能看到、能使用哪些连接及 Action。

Wanta 的团队成员增删、角色、禁用和 `app-access` 的 ETag 并发控制，已经大体具备对齐所需的基础；但连接的团队请求头、管理/成员端点分流，以及 `app-access` 策略模型均仍停留在旧契约。尤其 Wanta 当前“按 Provider 给某用户授权”的写入格式已不再是 console/connector 的权威语义。继续写入会出现“界面显示已授权，服务端实际不按此限制”的风险。

建议将以下三项列为联调前的阻断项：

1. 将连接作用域头从 `x-oo-organization-name` 迁移为 `x-oo-team-name`。
2. 按 `creator/admin` 与 `member` 分流 `/v1/connections`（管理）和 `/v1/apps`（策略可见）。
3. 删除旧的按 Provider 用户规则编辑器，改为按 Connection App ID 的成员范围 + Action 范围编辑器。

## 上游变更脉络

| 时间 | PR / 提交 | 变更 | 对齐意义 |
| --- | --- | --- | --- |
| 06-08 | [#225](https://github.com/oomol/console.oomol.com/pull/225) | 一套 Provider 支持多个连接账号，连接页拆分为各认证方式和执行记录面板。 | 连接的业务对象已从 Provider 转为具体 App/account。 |
| 06-12 | [#229](https://github.com/oomol/console.oomol.com/pull/229) | 增加连接详情页，页面路由可定位到特定连接。 | 客户端应使用 `appId`，不能只以 `service/provider` 为权限主体。 |
| 06-16/17 | [#230](https://github.com/oomol/console.oomol.com/pull/230)、[#231](https://github.com/oomol/console.oomol.com/pull/231) | 引入组织工作空间、成员和 Provider 访问管理。 | 是团队作用域和 app-access 的第一版基础。 |
| 07-14 | [#258](https://github.com/oomol/console.oomol.com/pull/258)、[#259](https://github.com/oomol/console.oomol.com/pull/259) | Organization 全面迁移为 Team；请求头随之修正。 | 当前正式请求头为 `x-oo-team-name`。 |
| 07-24 | [#270](https://github.com/oomol/console.oomol.com/pull/270) | GitHub/Gist OAuth 授权前可选择 scopes。 | OAuth 连接请求须可携带 `authorizationScopes`。 |
| 08-03 | [#276](https://github.com/oomol/console.oomol.com/pull/276) | 增加飞书权限清单并显示授权引导。 | Provider 元数据和授权体验仍持续扩展，不能把 Provider 配置写死。 |
| 08-12 | `c44de6d` | 首次按 App ID 的 Action policy（23 文件，+2680/-405）。 | 权限主体转为 `connector-app:<appId>`。 |
| 08-17/18 | `36e3a79` 及后续整理 | 成员范围与 Action 范围解耦，加入“全团队/指定成员”“无限制/Action 白名单”“坏策略失败关闭”等完整语义（28 文件，+2670/-940）。 | 这是当前应实现的权限模型。 |
| 08-19 | [#290](https://github.com/oomol/console.oomol.com/pull/290) | 管理者读 `/v1/connections`；普通成员读 `/v1/apps`；缓存按角色/工作空间隔离。 | Wanta 需要按团队角色分流端点，避免可见性和管理能力混淆。 |

值得注意的是，08-12 之后的一大组权限改动是直接进入 `main` 的提交，而不是一个完整 PR。因此对齐应以当前 `main` 和 [connection-app-access-plan.md](../../console.oomol.com/docs/connection-app-access-plan.md) 的语义为准，而不是仅按 PR 标题判断。

## 当前权威契约

### 1. 团队与作用域

- 团队对象有 `id`、`name`、`creator_user_id`、`role`、`writable` 和 `system_created`；`role` 可为 `creator`、`admin`、`member`。
- Console 的团队工作空间路由是 `/team/<teamName>/...`，本地持久化和请求作用域均使用 **team name**；管理 API 的成员操作使用 team ID。
- 对 Connector 发起团队级请求时，必须带：

```http
x-oo-team-name: <teamName>
```

- `creator` 和 `admin` 是管理者；`member` 是普通成员。客户端可以用 `writable` 优先判断可管理性，缺失时再按角色兜底。
- `app-access` 由 relation-control 的 `GET/PUT /v1/teams/:teamId/app-access` 管理。读取 ETag，写入通过 `If-Match` 防止覆盖并发修改。

### 2. Connection App 的读写端点

端点并非可互换；其选择由当前用户在当前团队内是否有管理权限决定。

| 用户角色 | 列表/详情读端点 | 能力 |
| --- | --- | --- |
| `creator` / `admin` | `/v1/connections`、`/v1/connections/by-id/:appId` | 看见真实团队连接，并可连接、重连、改别名、断开、看凭证配置和执行历史。 |
| `member` | `/v1/apps`、`/v1/apps/by-id/:appId` | 只能看策略允许的 App；连接详情只读；不能看凭证配置或执行历史。 |

连接、重连、断开、改别名和执行记录等管理类请求仍属于 `/v1/connections` 路径。普通成员不应以“前端禁用按钮”替代端点分流，必须读取 policy-visible App 视图。

查询缓存必须至少纳入 `teamName + surface(management/runtime)`；只用 team 名称会在角色变化后复用错误的列表或详情。

### 3. app-access 策略语义

权限以 Connection App ID 为主体，而不是 Provider service：

```text
role::connector-app:<appId>
user::<userId>.roles = ["connector-app:<appId>"]
```

一个 App 的策略有两个正交维度：

| 维度 | 默认 / 未配置角色 | 配置后的表达 | 结果 |
| --- | --- | --- | --- |
| 成员范围 | 全团队 | `requireRole: false` 或缺失 = 全团队；`true` = 仅 `user::<id>.roles` 精确引用该 App 角色的成员 | 选中成员为空是有效的“无人可访问”。管理员/创建者在指定成员模式下没有隐式豁免。 |
| Action 范围 | 全部 Action | 没有 `actions` = 不限；`actions: [..]` = 白名单；`actions: []` = 禁止所有 Action | 白名单模式同时禁止 Proxy 和 MCP `tool_call`。 |

未配置 role 时，全部团队成员可访问且 Action 不限。仅存在用户的 role 引用而没有对应的 `role::connector-app:<appId>` 时，**不能**被解释为“仅这些成员可访问”，实际仍是全团队默认访问。这是旧实现最容易造成放权的边界。

推荐的受限示例：

```json
{
  "user::alice": { "roles": ["connector-app:app-123"] },
  "role::connector-app:app-123": {
    "connector": [{
      "app": ["app-123"],
      "method": "POST",
      "provider": "github",
      "requireRole": true,
      "actions": ["issues.create", "issues.list"]
    }]
  }
}
```

解析原则是“坏策略不扩大权限”：role 中没有可用 Connector rule、`requireRole` 不是 boolean、`roles/actions` 不是有效字符串数组，或引用了消失的 App 时，该 App 均进入 invalid/repair 状态并拒绝普通成员访问。一个 App 的异常不应阻塞其他 App。

### 4. Console 的交互边界

- 管理者：详情页展示成员权限和 Action 调用范围的摘要；两项分别通过弹窗编辑、分别保存。凭证设置和执行历史延迟加载。
- 普通成员：只看到自己的有效访问状态和只读 Action 树；不读取成员列表，不读取凭证/执行记录，也不写 policy。
- 团队页：连接卡片以具体 App 为单位跳到详情页的权限区，而不是在成员表中给 Provider 打勾。
- OAuth：GitHub/Gist 连接在跳转授权前需要选择/传递 `authorizationScopes`；Provider 授权清单和名称来自服务端目录及本地 metadata，而不是固定枚举。

## Wanta 现状与差异

| 范畴 | Wanta 当前实现 | console 当前契约 | 判断 / 风险 |
| --- | --- | --- | --- |
| Connector 团队头 | `src/lib/connections-client.ts` 发送 `x-oo-organization-name`。 | `x-oo-team-name`。 | **P0：请求可能落入错误/默认作用域，或被服务端拒绝。** |
| 连接读取 | Wanta 始终读 `/v1/apps` 和 `/v1/apps/by-id/:id`。 | 管理者需读 `/v1/connections`；成员读 `/v1/apps`。 | **P0：管理者会缺少真实团队连接和管理信息；端点权限进一步收紧后会直接失效。** |
| 连接写入 | Wanta 的 connect/reconnect/disconnect/alias 均请求 `/v1/apps/...`。 | 管理类操作属于 `/v1/connections/...`。 | **P0：管理操作路径与当前上游不一致。** |
| 请求缓存 | Wanta 以 `teamName` 分隔连接缓存。 | 必须再分 management/runtime surface。 | **P1：角色变化、成员身份切换时可能复用管理结果或成员可见结果。** |
| 团队 CRUD | Wanta 的成员 API、ETag 获取/写入已对齐；但创建、编辑、头像仍调 `/v1/orgs`。 | console 使用 `/v1/teams`。 | **P1：需确认后端兼容层；应完成 Teams endpoint 迁移。** |
| App-access 读取/写入 | Wanta 已读取并使用 `If-Match` 写回整个文档。 | 同样需要 ETag。 | 基础正确，可保留，但写前必须强制刷新快照并按新模型转换。 |
| 授权模型 | `src/routes/Skills/team-provider-access.ts` 按 `user::<id>.connector` 的 `provider` 规则读写；粒度是 Provider。 | role subject + user roles；粒度是 App ID，成员和 Action 解耦。 | **P0：旧规则不是当前权威规则；UI 的“已授权”会与实际访问结果不一致。** |
| 默认权限假设 | `teamRoleHasDefaultConnectionAccess` 将 manager 视作有默认连接权限。 | 未配置 App role 时是全团队；指定成员模式下 manager 无隐式访问。 | **P0：角色推断与有效 App 权限混在一起，可能错误隐藏或开放连接。** |
| Action policy | 无 Action 白名单、`[]` 拒绝全部、Proxy/MCP 后果或 repair state。 | 四种明确状态（成员 team/selected × Action unrestricted/restricted）和 fail-closed。 | **P0：无法表达当前安全模型。** |
| OAuth scope | `ConnectionConnectInput` 无 `authorizationScopes`。 | GitHub/Gist 等连接需要支持选择后传入。 | P2：功能缺口；不一定阻断基础连接，但无法达到 console 体验。 |
| Agent 团队同步 | `useConnections` 在工作空间切换时调用 `setAgentTeam`。 | 上游要求所有 Connector 请求和 Agent 实际执行同一 teamName。 | 基础方向正确；迁移请求头和 workspace key 时必须做端到端验证。 |

## 最重要的安全问题

Wanta 现有的写入会创建类似下面的旧文档：

```json
{
  "user::alice": {
    "connector": [{ "method": "POST", "provider": ["github"] }]
  }
}
```

当前 console 的解析器只把 `user::<id>.roles` 视为 App 成员授权的来源，并明确忽略历史 `user::<id>.connector` 属性。若同时没有 `role::connector-app:<appId>`，那个 App 回退为“全团队可访问 + 全部 Action 可用”。因此这不是普通的展示不兼容，而是可能从“管理员以为只授权给 Alice”变为“团队每个人都可访问”的安全问题。

在策略迁移完成前，应在 Wanta 中禁用旧的“连接访问权限”写入口，而不是继续保留一个会写入过时语义的管理面板。

## 建议的对齐计划

### P0：先恢复正确性和安全边界

1. 在 `src/lib/connections-client.ts` 建立一个唯一的团队 scope helper，改为 `x-oo-team-name`；删除/禁止 `x-oo-organization-name` 的新写入。
2. 将 `ConnectionWorkspace` 扩展为 `{ teamName, manageable }` 或等价的 surface 字段。
3. 在连接 client 中按 `manageable` 选择：
   - 管理读写：`/v1/connections`；
   - 普通成员只读：`/v1/apps`；
   - 对 member 禁止所有连接 mutation、凭证详情、执行记录请求。
4. 将连接缓存、in-flight 请求和 OAuth pending key 从 `teamName` 扩展为 `teamName:surface`。
5. 下线 `src/routes/Skills/team-provider-access.ts` 的旧 user/provider editor 和所有调用处；在新编辑器完成前只读展示或明确提示“请在 console 管理”。

验收：creator/admin/member 三个账号在同一 team 下，列表、App 详情、连接/断开、凭证、执行历史和 Agent 调用均符合端点表；切换账号或角色后不出现前一个 surface 的缓存内容。

### P1：实现 App 级权限编辑

1. 将 console 的领域模型移植为 Wanta 的纯函数模块：`ConnectorAppAccess`、`ConnectorMemberAccess`、`ConnectorActionAccess`、parse/write/restore helpers。
2. 对每个可用 App 解析 `role::connector-app:<appId>`；不使用嵌套 `app` 数组定位 App；保留不相关 service policy；写入时移除旧 `user.connector` 历史规则。
3. 为每个 App 分别编辑：成员范围（全团队/指定成员）与 Action 范围（无限制/白名单）。`actions: []` 必须能被保存且不能被归一化成“无限制”。
4. 按 Console 行为在普通成员 UI 中呈现只读有效权限；无权限和 invalid policy 均失败关闭。
5. 保留现有的 ETag 乐观并发，但每次保存前重新 GET 快照；遇到 `412` 重新加载并提示用户处理冲突。

验收：覆盖默认、指定成员为空、指定成员包含 creator/admin、Action 无限、有限、空数组、坏 role、坏 user roles、已删除 App、历史 user.connector 清理等测试矩阵。

### P2：体验及长期一致性

1. 给 OAuth input 和启动请求增加 `authorizationScopes?: string[]`，先覆盖 GitHub/Gist。
2. 将 Wanta team CRUD 的 `/v1/orgs` 切到 `/v1/teams`，并确认头像、创建、改名行为；后端兼容路径只作为迁移期兜底。
3. 统一 Provider 目录、本地化和权限清单的读取来源，避免客户端维护对 provider 名称、认证方式或 scope 的静态假设。
4. 增加跨端契约测试：以相同的 app-access fixture 分别运行 console/Wanta parser，确保有效访问、写回 JSON 和 invalid 状态一致。

## 建议联调用例

| 用例 | 期望 |
| --- | --- |
| 未配置任何 App role | creator/admin/member 都能在 `/v1/apps` 看见 App；管理者在 `/v1/connections` 看见并可管理。 |
| `requireRole: true` 且成员列表为空 | 所有人都不可见/不可调用该 App，包括 creator/admin。 |
| `requireRole: true`，只给普通成员 Alice role | 只有 Alice 在成员端点可见；管理员仍可通过管理端点配置，但不因为角色自动取得运行权限。 |
| `requireRole: false`，`actions` 缺失 | 全团队可见；所有 Action、Proxy、MCP tool_call 可用。 |
| `requireRole: false`，`actions: []` | 全团队可见，但不能调用任何 Action，且 Proxy/MCP tool_call 禁用。 |
| policy role 损坏 | 普通成员不可访问；管理者看到 repair/invalid 状态；其他 App 正常。 |
| 旧 `user.connector` 写入 | 迁移时删除或标记，不得把它解释为限制性授权。 |
| 同一成员先是 admin 后降为 member | 缓存切换到 runtime surface，不能继续展示管理列表、凭证或执行记录。 |

## 证据位置

- console 的当前策略规格：`/Users/wushuang/code/console.oomol.com/docs/connection-app-access-plan.md`
- console 团队 API 与 ETag：`/Users/wushuang/code/console.oomol.com/src/api/teams.ts`
- console scope header：`/Users/wushuang/code/console.oomol.com/src/api/request-scope.ts`
- console 管理/成员端点分流：`/Users/wushuang/code/console.oomol.com/src/api/connections.ts`、`src/pages/connections-scope.ts`
- console App access parser/writer：`/Users/wushuang/code/console.oomol.com/src/pages/team-connector-access-policy.ts`
- Wanta 当前连接 client：`/Users/wushuang/code/wanta/src/lib/connections-client.ts`
- Wanta 当前团队 client：`/Users/wushuang/code/wanta/src/lib/teams-client.ts`
- Wanta 当前旧 Provider grant parser/writer：`/Users/wushuang/code/wanta/src/routes/Skills/team-provider-access.ts`
- Wanta 角色默认权限判断：`/Users/wushuang/code/wanta/src/lib/team-permissions.ts`

