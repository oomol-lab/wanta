# Wanta Connection 成员与 Action 权限调研及实施方案

**调研日期：** 2026-08-19
**Console 基线：** `/Users/wushuang/code/console.oomol.com` `main@af03c6c`
**Wanta 基线：** 本仓库 `main@fc0411d7`
**调研范围：** OOMOL Team 下的 Connector Connection 成员访问、Action 调用范围、管理界面、Agent 执行链路与并发写入；不包含个人空间和 Wanta 的本地 Direct Provider。

## 1. 执行摘要

用户的判断基本准确，但 Wanta 并非完全从零开始。

Console 已经形成一套完整的 Connection App 级权限模型：权限主体是具体的 Connection App ID，而不是 Provider；每个 App 分别管理“哪些成员可访问”和“哪些 Action 可调用”；策略由 `app-access` 保存，由 Connector 在 `/v1/apps` 和实际 Action 调用时执行。Console 还实现了普通成员只读视图、坏策略失败关闭、Action 分类树、ETag 并发保护和跨页面缓存同步。

Wanta 当前已经完成团队请求头、管理/成员端点分流、管理操作保护、缓存隔离和 Agent 团队作用域对齐。它也在 `src/lib/team-connection-access.ts` 中加入了 App 级策略解析/写入的纯函数雏形。

真正尚未完成的是产品和运行时体验的最后一段：

1. Wanta 团队管理页仍在使用旧的“成员 × Provider”授权 UI，并写入 `user::<id>.connector` 规则。
2. 新的 App 级策略模块只有单元测试，没有任何产品调用方。
3. Wanta 没有 Action catalog client、Action 权限摘要、Action 白名单编辑器或普通成员只读 Action 树。
4. Agent 的 `call_action` 会由 Connector 做最终鉴权，因此不存在客户端绕过；但 `search_actions` / `inspect_action` 仍是全局目录，未按当前 Connection 的 Action allowlist 收窄，可能让 Agent 发现并尝试一个最终会被 `POLICY_DENIED` 拒绝的 Action。

因此当前状态可概括为：**传输层和服务端执行边界已基本对齐，权限管理 UI 仍是旧模型，新领域模型已落地但尚未接线。**

最优方案不是在 Wanta 内再造一套独立 RBAC，而是复用 Console/Connector 的同一份 `app-access` 契约：Wanta 负责配置、解释和展示，Connector 继续负责最终授权判定。

## 2. Console 的权威权限模型

### 2.1 权限主体是 Connection App，不是 Provider

一个 Provider 可以存在多个连接账号。权限必须绑定具体 App ID：

```text
role::connector-app:<appId>
user::<userId>.roles = ["connector-app:<appId>"]
```

例如，同一团队连接了两个 GitHub 账号，成员可以只获得其中一个账号的访问权。仅按 `github` Provider 授权无法表达这个场景。

### 2.2 成员范围和 Action 范围是两个正交维度

| 维度        | 默认状态                                              | 受限状态                                      | 重要边界                                                                          |
| ----------- | ----------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------- |
| 成员范围    | role 不存在，或 `requireRole` 缺失/为 `false`：全团队 | `requireRole: true`：只有引用 App role 的用户 | 指定成员可以为空，表示无人可访问；creator/admin 没有运行权限豁免                  |
| Action 范围 | `actions` 属性不存在：全部 Action                     | `actions: [...]`：显式白名单                  | `actions: []` 表示全部禁止；只要存在 `actions`，Proxy 和 MCP `tool_call` 也被禁用 |

一个有效受限策略示例：

```json
{
  "user::alice": {
    "roles": ["connector-app:app-123"]
  },
  "role::connector-app:app-123": {
    "connector": [
      {
        "app": ["app-123"],
        "method": "POST",
        "provider": "github",
        "requireRole": true,
        "actions": ["issues.create", "issues.list"]
      }
    ]
  }
}
```

### 2.3 role key 是 App 身份的权威来源

`role::connector-app:<appId>` 中的 `<appId>` 决定策略属于哪个 App。嵌套 rule 的 `app` 字段是冗余兼容数据，Console 当前解析器明确不依赖它定位或校验 App。

这点与 Wanta 新增的解析器仍有细微差异：Wanta 在出现带 `app` 的 rule 时要求其严格等于目标 App。直接上线会把 Console 能正常读取的历史兼容策略判为 invalid，因此接线前必须先实现契约一致性。

### 2.4 默认状态不是“未授权”

当 App role 不存在时，默认语义是：

- 全团队可访问；
- 全部 Action 可调用；
- Proxy 和 MCP `tool_call` 可用。

只有 `user::<id>.roles` 而没有对应 App role，并不会形成成员限制。这个边界使旧 Wanta writer 存在安全误导：管理员以为只授权给某人，实际 Connector 可能仍按默认规则向全团队开放。

### 2.5 坏策略必须失败关闭

以下状态不能回退成默认开放：

- App role 存在但没有唯一可用的 Connector rule；
- `requireRole` 不是 boolean；
- 用户 `roles` 不是非空字符串数组；
- `actions` 不是非空字符串数组组成的数组；
- 策略引用的 App 已被删除或断开且目录中不可识别。

Console 将异常限制在目标 App，显示 repair 状态；其他 App 仍可正常使用。普通成员对异常 App 视为无权限。

### 2.6 服务端端点本身承担可见性边界

| 当前用户      | 读取端点                                          | 能力                                       |
| ------------- | ------------------------------------------------- | ------------------------------------------ |
| creator/admin | `/v1/connections`、`/v1/connections/by-id/:appId` | 管理视图、凭证配置、连接生命周期、执行历史 |
| member        | `/v1/apps`、`/v1/apps/by-id/:appId`               | 只看到 policy-visible App，不具备管理能力  |

团队请求均使用：

```http
x-oo-team-name: <teamName>
```

客户端不应通过“请求管理端点后隐藏按钮”模拟普通成员视图。

## 3. Console 已完成的产品能力

### 3.1 Connection 详情权限概览

每个 Connection App 展示两个独立摘要：

- 成员权限：全团队 / 指定成员及人数；
- Action 调用范围：无限制 / 已允许数量与总数。

这与截图中的“配置成员”和“配置 Action”完全对应。权限是 Connection account 级，不是 Provider card 级。

### 3.2 成员编辑器

- 全团队可访问；
- 指定成员访问；
- 支持成员搜索；
- creator/admin 也按普通成员参与选择，不隐式加入；
- 切回全团队时移除该 App 的陈旧用户 role 引用；
- 指定成员为空可以正常保存。

### 3.3 Action 编辑器

- “无限制”和“自定义限制”是显式模式；
- 自定义模式按 read/write/destructive 三类展示 Action 树；
- 父节点支持全选、全不选和 indeterminate；
- 首次启用限制时默认选中当前已知 read Action；
- 手动清空后不会再次自动补齐；
- 已保存但当前 catalog 中消失的 Action 单独显示并保留，避免无意改写策略；
- 选择 catalog 中全部 Action 仍不等于无限制，因为 Proxy/MCP 的结果不同。

### 3.4 普通成员视图

- 只读展示自己的有效成员权限和 Action 范围；
- 无权限时提示联系管理员；
- invalid policy 失败关闭；
- 不加载成员列表、凭证设置和执行历史；
- Action 树只读，不能通过交互修改策略。

### 3.5 写入一致性

- `GET /v1/teams/:teamId/app-access` 获取完整文档和 ETag；
- 每次 mutation 前重新读取最新快照；
- 只转换目标 App 的成员或 Action 维度；
- `PUT` 完整文档并带 `If-Match`；
- 冲突由服务端拒绝，保留用户草稿并允许手工重试；
- Connection 详情和 Team 管理页共享 query key / invalidation。

## 4. Wanta 当前实现盘点

### 4.1 已经完成并可复用的基础

| 能力               | 当前状态                                                      | 证据                                                                      |
| ------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 团队作用域请求头   | 已对齐为 `x-oo-team-name`                                     | `src/lib/connections-client.ts`                                           |
| 管理/成员读取分流  | `manageable=true` 读 `/v1/connections`，否则读 `/v1/apps`     | `src/lib/connection-workspace.ts`、`src/lib/connections-client.ts`        |
| 管理 mutation 防护 | 非 management workspace 在 client/hook 两层拒绝               | `src/lib/connections-client.ts`、`src/hooks/useConnections.ts`            |
| 缓存隔离           | key 含 `teamName + management/runtime`                        | `src/lib/connection-workspace.ts`                                         |
| Team API           | 已使用 `/v1/teams`                                            | `src/lib/teams-client.ts`                                                 |
| App-access ETag    | 已支持 snapshot、`If-Match` 和 409/412 类冲突处理基础         | `src/lib/teams-client.ts`、`src/routes/Skills/use-team-member-actions.ts` |
| OAuth scopes 传递  | `ConnectionConnectInput` 和请求体已支持 `authorizationScopes` | `electron/connections/common.ts`、`src/lib/connections-client.ts`         |
| Agent team 绑定    | Link CLI 使用 `--team`，直接 HTTP 使用 `x-oo-team-name`       | `electron/agent/link-capability.ts`、`electron/agent/manager.ts`          |
| App 级策略纯函数   | 已有 parse/member write/action write/restore 和基础测试       | `src/lib/team-connection-access.ts`                                       |

这些基础意味着无需修改 Connector 后端即可完成 Wanta 首版权限管理。

### 4.2 仍在生产路径中的旧权限模型

Wanta 当前团队管理页仍由以下模块驱动：

- `src/routes/Skills/team-provider-access.ts`
- `src/routes/Skills/use-team-member-actions.ts`
- `src/routes/Skills/TeamMembersPanel.tsx`
- `src/routes/Skills/TeamMemberDialogs.tsx`

它们把权限建模为“某成员可访问哪些 Provider”，并写入类似：

```json
{
  "user::alice": {
    "connector": [
      {
        "method": "POST",
        "provider": ["github"]
      }
    ]
  }
}
```

这不是当前 App role 契约。Wanta 新增的 App 级 parser 没有调用方，无法抵消旧 writer 的影响。

风险分级：**P0 产品安全误导。** UI 显示“已限制给 Alice”不等于 Connector 实际执行了这个限制。

### 4.3 新策略模块尚未达到 Console 完整契约

`src/lib/team-connection-access.ts` 是正确方向，但接线前至少需要补齐：

1. 忽略嵌套 `app` 字段，以 role key 为权威身份；当前实现会错误拒绝部分兼容策略。
2. 提供当前用户有效访问判断、按用户增删单个 App role、整组恢复/清理等共享操作。
3. 明确 parse 后是否返回规范化但尚未写回的内存模型；Console 会清理 legacy user connector 字段并规范化受管 rule。
4. 与 Console 共享同一批 contract fixtures，避免两份 parser 再次漂移。
5. 扩展 malformed/unknown App/历史字段/不相关 service 保留等测试矩阵。

### 4.4 Wanta 缺少 Action catalog 领域和 UI

Wanta 当前没有 `/v1/actions?service=<service>` client，也没有以下字段对应的领域类型：

- `name`；
- `description`；
- `operationType: read | write | destructive`；
- `requiredScopes`；
- `providerPermissions`。

因此目前无法实现 Action 数量摘要、分类树、默认 read 选择、未知 Action 保留或只读 Action 视图。

### 4.5 Connection UI 是 Provider 详情，不是 App 权限详情

Wanta 的 Connections 页以 Provider catalog 和账号列表为主。一个 Provider 下可有多个 `ConnectionAppSummary`，但当前每个账号只有重连、断开、别名和执行记录相关操作，没有 App 级权限入口。

权限入口必须落在具体账号行或账号详情上；放在 Provider 顶层会再次丢失多账号粒度。

### 4.6 Agent 执行安全与体验的区别

Wanta 的 Agent 调用链已经把 teamName 绑定到 Link runtime：

```text
Agent tool -> LinkCapability -> oo connector run --team <teamName> -> Connector policy
```

因此 Action 最终授权仍由 Connector 执行，Wanta UI 或本地 parser 失效不会让 Agent 越权。服务端返回 `POLICY_DENIED` 时，Wanta 会规范化为 action denied。

但发现链路仍有体验缺口：

- `search_actions` 与 `inspect_action` 读取全局 schema，不携带 workspace；
- `list_apps` 是 workspace-aware；
- `call_action` 是 workspace-aware 并由服务端最终鉴权。

结果是 Agent 可能先发现一个受限 Action，调用后才被拒绝。它不构成授权绕过，但会造成无效尝试、噪声错误和错误的能力预期。

### 4.7 Direct Provider 不属于本次 app-access

Wanta 的本地 Lark、WeCom、DingTalk CLI 是 Direct Provider，不是 Connector-managed Connection App。它们没有 Connector App ID，也不经过 `/v1/apps` 和上述 App role policy。

首版 UI 必须明确只对 `executionMode !== "direct"` 的 Connector 连接展示团队权限入口，不能让用户误以为 Direct Provider 已受同一策略保护。Direct Provider 权限需要单独设计。

## 5. 差距与优先级

| 优先级   | 差距                                                         | 影响                                                     |
| -------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| P0       | 旧 Provider writer 仍可写过时规则                            | 管理者看到的限制可能并未生效，形成安全误导               |
| P0       | App 级 parser 未接线且与 Console 有契约差异                  | 不能可靠读取、编辑或修复当前策略                         |
| P1       | 无 Connection App 权限概览与成员编辑器                       | 无法按具体连接账号管理成员                               |
| P1       | 无 Action catalog/client/editor                              | 无法配置接口级 allowlist，也无法表达 deny-all            |
| P1       | Team 管理页和 Connection 页没有共享权限状态                  | 后续双入口容易产生陈旧数据和互相覆盖                     |
| P1       | 普通成员无只读权限解释                                       | `/v1/apps` 虽正确过滤，但用户不知道为何缺少连接或 Action |
| P2       | Agent discovery 不感知 Action allowlist                      | Agent 会发现并尝试最终被拒绝的 Action                    |
| P2       | OAuth scopes 类型已支持但没有 Console 等价的选择 UI/metadata | 连接授权体验仍不完整                                     |
| 独立议题 | Direct Provider 无 Team app-access                           | 不能通过本方案自动获得成员/Action 权限                   |

## 6. 推荐方案

### 6.1 架构原则

1. **Connector 是最终授权点。** Wanta 不实现第二套服务端 RBAC，不允许本地判断覆盖 Connector 结果。
2. **App ID 是唯一权限主体。** Provider 只用于目录和展示。
3. **一个共享 policy adapter。** Connections 页、Team 页和 Agent 体验使用相同解析语义。
4. **读写分离。** 解析器是纯函数；数据层负责 GET/ETag/PUT/cache；UI 只消费领域 view model。
5. **独立 mutation。** 成员范围和 Action 范围分别保存，互不重写对方字段。
6. **失败关闭。** invalid policy 不得回退到默认开放，也不得自动修复后写回。
7. **未知数据保留。** 不相关 service、未知 role、用户历史字段和 catalog 中暂时消失的 Action 均不得被无意删除。

### 6.2 建议模块边界

```text
src/lib/team-connection-access.ts
  纯策略 adapter：parse / effective access / member transform /
  action transform / restore / contract fixtures

src/lib/connection-actions-client.ts
  GET /v1/actions?service=...
  Action catalog 类型和条件缓存

src/lib/team-app-access-resource.ts
  GET snapshot + ETag
  teamId 级共享缓存/invalidation
  mutateLatest(transform)

src/routes/Connections/ConnectionAccessOverview.tsx
  App 级成员和 Action 摘要

src/routes/Connections/ConnectionMemberAccessDialog.tsx
  team / selected member editor

src/routes/Connections/ConnectionActionAccessDialog.tsx
  unrestricted / restricted + Action tree

src/routes/Connections/ConnectionMemberAccessView.tsx
  普通成员只读有效权限
```

Team 管理页不应维护另一份 parser。它可以复用同一 resource 和 view model，提供“按成员查看/修改 Connection”入口。

### 6.3 UI 放置

Wanta 当前是 Provider detail + connection account list。建议：

1. 在 `ConnectionAccountsList` 的每个 Connector-managed App 账号行增加“权限”入口。
2. 选中账号后，在 Provider detail 下展示与 Console 一致的两列摘要：成员权限、Action 调用范围。
3. 管理者可分别打开两个 Dialog；普通成员只显示只读有效状态。
4. Team Members 表保留成员管理，但移除旧 Provider grant。替换为每个成员的“连接权限”摘要/入口，内部仍操作 App role。
5. Direct Provider 不显示该入口，并在需要时显示“本地连接，不受团队 Connection 权限管理”的短说明。

## 7. 分阶段实施计划

### Phase 0：立即消除旧 writer 风险

目标：在完整 UI 上线前，不再产生过时且具有误导性的 policy。

1. 禁用或移除 Team 页面旧 Provider Access 的保存/撤销入口。
2. 只读识别到旧 `user.connector` 时显示迁移提示，不把它解释为有效 App 限制。
3. 增加回归测试：任何新 UI 操作均不得写入 `user::<id>.connector`。

验收：Wanta 不再新增旧格式规则；现有连接和成员管理其余功能不受影响。

### Phase 1：完成共享权限内核

目标：让 Wanta 的纯策略逻辑与 Console 当前主干逐项一致。

1. 以 Console `team-connector-access-policy.ts` 当前行为为基线修正 Wanta adapter。
2. 加入 exact fixtures，至少覆盖：
   - 未配置默认开放；
   - 只有 user role、没有 App role；
   - team scope；
   - selected scope 有人/无人；
   - unrestricted / restricted / `actions: []`；
   - 嵌套 `app` 不一致但 role key 有效；
   - malformed role / user roles；
   - deleted App；
   - legacy user.connector 清理；
   - 不相关 policy 和用户字段保留。
3. 提供 `mutateLatest(teamId, transform)`：读取最新 snapshot、转换、带 ETag PUT、成功后统一 invalidation。
4. 冲突时保留草稿，不自动重试写入。

验收：同一 fixture 在 Console 与 Wanta 得到相同 effective access、相同受管 JSON 和相同 invalid 状态。

### Phase 2：Connection App 成员权限

目标：先完成“谁能访问具体连接账号”。

1. 在账号级别展示成员摘要。
2. 管理者实现全团队/指定成员编辑器。
3. 读取成员列表与 user summary；失效用户保留并标记 unavailable。
4. 普通成员只读显示自己的有效状态。
5. invalid policy 显示 repair 入口；repair 必须二次确认并明确会恢复全团队 + Action 不限。

验收：两个同 Provider 账号可以配置不同成员；指定成员为空后所有人都无法运行该 App；creator/admin 不会被隐式加入。

### Phase 3：Action 级权限

目标：实现截图中的“配置 Action / 全部接口定义”。

1. 增加 Action catalog client 和缓存。
2. 用显式 union 区分 unrestricted 与 restricted，绝不以空数组代表 unrestricted。
3. 实现 read/write/destructive 分类树、父级三态选择、搜索和计数。
4. 首次切换 restricted 时默认选择 read Action；明确空选择可保存为 deny-all。
5. 保留 catalog 中消失但策略仍引用的 Action。
6. 在 UI 中清楚说明 restricted 会禁用 Proxy/MCP `tool_call`。

验收：Action 新增后在 restricted 模式下默认仍不可用；选择全部 catalog Action 后 Proxy/MCP 仍保持禁用；保存 Action 不改变成员范围。

### Phase 4：Team 页面统一与清理

目标：删除旧模型并让两个管理入口一致。

1. 删除 `team-provider-access.ts` 及旧 Provider grant form/model/actions。
2. Team Members 页按 App 展示有效 Connection 权限，不再按 Provider 显示授权。
3. Connections 与 Team 页面共享 app-access resource 和 invalidation。
4. 成员从 Team 删除时不自动删除其 App role 引用；在权限编辑器中作为 unavailable assignment 显示并可显式清除。

验收：任一页面修改后另一页面立即刷新，不出现陈旧摘要或整文档覆盖。

### Phase 5：Agent 权限感知优化

目标：减少“先发现、后拒绝”的无效调用，同时保持 Connector 为最终授权点。

推荐优先顺序：

1. 首选推动 Connector 提供 policy-aware Action discovery，返回当前 App/connection 下的可调用 Action。
2. 若后端短期不能提供，HostCapabilityContext 增加 opaque team/user/app access binding，由 Wanta 对 discovery 结果做只读过滤或 `allowedConnections` 标注。
3. `call_action` 永远继续调用 Connector，不因本地允许结果跳过服务端校验。
4. `POLICY_DENIED` 区分成员未分配、Action 不在 allowlist 和上游 Provider 权限不足；若后端无法区分，UI 不做未经证实的归因。

验收：Agent 默认不选择当前 Connection 明确禁止的 Action；伪造工具参数仍被 Connector 拒绝。

### Phase 6：OAuth 与 Direct Provider 后续

1. 补齐 `authorizationScopeSelection` metadata 和 scopes 选择 UI。
2. 为 Direct Provider 单独定义 Team sharing/permission 模型；在此之前不得复用 Connector App role UI。

## 8. 关键测试矩阵

| 场景                         | UI 期望                           | Agent/服务端期望                       |
| ---------------------------- | --------------------------------- | -------------------------------------- |
| App role 不存在              | 全团队、Action 不限               | 所有成员可见并可调用                   |
| `requireRole: true` + 空成员 | 显示指定 0 人                     | 所有人均不可运行，包括 creator/admin   |
| 仅 Alice 被选中              | Alice 有效，其他人无权限          | `/v1/apps` 只向 Alice 暴露该 App       |
| `actions` 缺失               | 无限 App Action                   | Proxy/MCP 可用                         |
| `actions: []`                | 自定义 0/N                        | 所有 Action、Proxy、MCP 均拒绝         |
| 只允许 read                  | read 已选，write/destructive 未选 | write/destructive 返回 policy denied   |
| App A policy 损坏            | A 显示 repair，失败关闭           | App B 仍正常                           |
| 保存成员后并发修改 Action    | ETag 冲突并保留草稿               | 不覆盖他人 Action 修改                 |
| Provider 下两个账号          | 两个独立权限摘要                  | 选择 connectionName 后分别执行各自策略 |
| 成员被移出 Team              | 显示 unavailable assignment       | 不自动重写 app-access                  |
| Direct Provider              | 不显示 Connector 权限入口         | 继续走其独立本地授权                   |

## 9. 风险与决策

### 9.1 是否直接复制 Console UI

不建议整页复制。Console 是浏览器管理后台，Wanta 是 Electron 工作台，页面结构不同。应复用领域语义、fixtures 和交互规则，在 Wanta 的 Provider detail + account list 结构中实现 App 级入口。

### 9.2 是否把 parser 提取成共享包

长期建议共享；短期不应让包抽取阻塞修复。先让 Wanta 与 Console 使用同一 fixtures 并逐字对齐受管语义，随后再把纯 TS adapter 提取到无 React、无 HTTP 依赖的小包。

### 9.3 是否客户端预判等于授权

不等于。客户端解析只用于展示、编辑和减少无效调用。任何真实 Action 的最终结果都必须由 Connector 根据当前身份、Team、App policy 和 Provider credential 决定。

### 9.4 是否自动迁移旧规则

不建议在页面加载时自动写回。旧 Provider rule 无法无损映射到多个 Connection App，也无法推导 Action 范围。应先只读识别，由管理员确认映射到具体 App；写入新策略后再删除对应 legacy 字段。

## 10. 预计变更面

按当前代码结构，实施会涉及：

- `src/lib/team-connection-access.ts` 及 tests；
- `src/lib/teams-client.ts` / 新共享 app-access resource；
- `src/lib/connections-client.ts` / Action catalog client；
- `electron/connections/common.ts` 的 Action 类型；
- `src/routes/Connections/ConnectionAccountsList.tsx` 和 Provider detail；
- 新的权限概览、成员 Dialog、Action Dialog、只读视图；
- `src/routes/Skills/*team-provider-access*` 旧模型删除和 Team Members 入口替换；
- i18n 文案和 UI 测试；
- `electron/agent/link-capability.ts` 的 discovery 优化（后续阶段）。

不需要在首版修改 Connector 服务端授权执行逻辑，也不应把 app-access 的业务判断放到 renderer 之外的第二份实现。

## 11. 建议交付拆分

建议拆成 4 个可审查 PR：

1. **安全收口 + contract parity：** 禁用旧 writer，完成 parser/fixtures/resource。
2. **Connection 成员权限：** App 概览、成员编辑、普通成员只读视图。
3. **Action 权限：** catalog、Action tree、allowlist mutation。
4. **Team 页面统一 + Agent discovery：** 删除旧模型、共享状态、降低无效调用。

前三个 PR 完成后，用户即可在 Wanta 内获得与截图核心能力等价的成员和接口权限管理；第四个 PR 解决跨页面一致性和 Agent 体验完整度。

## 12. 证据索引

### Console

- `/Users/wushuang/code/console.oomol.com/docs/connection-app-access-plan.md`
- `/Users/wushuang/code/console.oomol.com/src/pages/team-connector-access-policy.ts`
- `/Users/wushuang/code/console.oomol.com/src/pages/connection-team-access-panel.tsx`
- `/Users/wushuang/code/console.oomol.com/src/pages/connection-action-access-draft.ts`
- `/Users/wushuang/code/console.oomol.com/src/api/connections.ts`
- `/Users/wushuang/code/console.oomol.com/src/api/teams.ts`

### Wanta

- `src/lib/team-connection-access.ts`
- `src/lib/team-connection-access.test.ts`
- `src/routes/Skills/team-provider-access.ts`
- `src/routes/Skills/use-team-member-actions.ts`
- `src/routes/Skills/TeamMembersPanel.tsx`
- `src/routes/Skills/TeamMemberDialogs.tsx`
- `src/lib/connections-client.ts`
- `src/lib/connection-workspace.ts`
- `src/lib/teams-client.ts`
- `src/routes/Connections/ConnectionAccountsList.tsx`
- `electron/agent/link-capability.ts`
- `electron/agent/manager.ts`
