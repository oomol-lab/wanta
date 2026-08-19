# Wanta Team 成员连接权限交互优化报告与执行计划

**调研日期：** 2026-08-19

**Console 基线：** `/Users/wushuang/code/console.oomol.com` `main@5c2022e`

**Wanta 基线：** 本仓库 `main@49d6ecd0`

**参考资料：** 用户提供的两张 Console Team 成员页截图，以及 Console/Wanta 当前源码

**调研范围：** Team 成员视角下的 Connector Connection 权限查看与配置；不改变 Team 角色语义，不覆盖个人空间和本地 Direct Provider。

## 1. 执行摘要

Console Team 成员页中的盾牌入口，本质上不是另一套权限系统，而是把同一份 `app-access` Connection App 策略从“以连接为中心”转置成“以成员为中心”：管理员可以从某个成员出发，查看该成员当前能够使用哪些 Connection，并直接调整成员与 Connection 的关联。

这个入口解决了一个真实的管理问题：

- Connection 详情适合回答“谁能用这个连接”；
- Team 成员页适合回答“这个人能用哪些连接”。

Wanta 在 `49d6ecd0` 已经完成 Connection 详情中的成员范围、Action 范围、ETag 写入、异常策略修复和普通成员只读能力，底层权限契约已经具备。当前缺口不是权限基础设施，而是缺少成员视角的审计和批量配置入口。

但不建议原样复制 Console 的多选框交互。Console 允许管理员从单个成员身上取消一个“全团队可用”的 Connection；由于当前策略没有“单用户拒绝”能力，它实际上会把整个 Connection 从“全团队”改成“指定成员”，并把除目标成员以外的所有当前成员写入角色列表。这样虽然保留了当前其他成员的访问，但**新加入 Team 的成员将不再自动继承该 Connection**。这是全局策略变化，不是局部成员变化。

因此建议采用三阶段方案：

1. 先上线成员连接权限审计视图，清楚区分“随团队继承”和“单独授权”，不产生写入。
2. 再开放安全的成员级编辑，只允许增删“指定成员”模式下的显式授权；全团队继承项保持只读，并可跳转到 Connection 权限页。
3. 若业务明确需要“从全团队连接中排除单个人”，再增加带影响说明和二次确认的高级转换操作；长期正确解法是后端支持显式 exclusion/deny，而不是在客户端隐藏地物化全部当前成员。

结论：**Wanta 应补齐成员视角，但应把“查看有效权限”“编辑显式授权”“改变整个 Connection 的默认继承策略”设计成三种不同强度的操作。**

## 2. 截图与 Console 交互解读

### 2.1 成员行入口

截图中的 Team 成员表在每个成员行末提供盾牌按钮。源码中该按钮根据有效权限呈现三种状态：

| 状态                | Console 表现 | 实际含义                                           |
| ------------------- | ------------ | -------------------------------------------------- |
| 存在显式成员授权    | 绿色盾牌     | 该成员至少被某个指定成员模式的 Connection 显式选中 |
| 仅有全团队继承权限  | 中性盾牌     | 没有显式授权，但至少有一个全团队可用 Connection    |
| 没有有效 Connection | 蓝色授予图标 | 既没有显式授权，也没有全团队 Connection            |

按钮 tooltip/ARIA 文案会在“权限管理”和“授予权限”之间切换。它只表达 Connection 访问概况，不替代成员角色、启用/停用、移除等 Team 成员操作。

### 2.2 “连接权限管理”对话框

打开后，对话框展示：

- 当前成员的头像、名称和标识；
- Connection 范围选择器；
- 当前有效 Connection 数量，例如截图中的“默认 × 38”；
- Connection 分组，包括“指定成员访问”和“全团队可访问”；
- 保存、取消，以及存在显式授权时的“恢复默认”。

这里展示的是成员的**有效权限集合**，不是只展示 `user::<id>.roles` 中的显式角色：全团队 Connection 也会默认处于选中状态。

### 2.3 状态和写入行为

Console 的读取链路可概括为：

```text
Team members
    + managed Connection Apps
    + Team app-access
             |
             v
按 App 解析 team / selected / invalid
             |
             v
投影为某成员的 effective Connection 列表
```

保存前 Console 会重新拉取最新成员和 `app-access`，计算新增与移除的 App ID，再写回完整策略。读取时保存 ETag，PUT 时通过 `If-Match` 防止并发覆盖。

恢复默认只移除该成员在各 `connector-app:<appId>` role 上的显式引用，不删除其他成员或其他 App 的策略。

异常策略不会回退成默认开放，而是进入 repair/reset 状态。这一点应在 Wanta 的成员视图中保持一致。

## 3. Console 的关键语义风险

### 3.1 当前契约无法表达“全团队可用，但 Bob 除外”

现有 Connection 成员权限只有两种模式：

```text
Team 模式：所有 Team 成员有效，未来成员自动继承

Selected 模式：只有 user::<id>.roles 中引用 connector-app:<appId> 的成员有效
```

它没有第三种 `excludedUsers`、deny role 或 deny rule。因此在成员视图中取消 Bob 对 Team 模式 Connection 的勾选，不可能只修改 Bob。

### 3.2 Console 实际执行的是全局模式转换

Console 的处理方式是：

```text
变更前：Connection A = Team 模式

管理员操作：在 Bob 的页面取消 Connection A

变更后：Connection A = Selected 模式
         selected users = 当前全部 Team 成员 - Bob
```

例如 Team 当前有 Alice、Bob、Carol：

```text
Team scope
   ->
Selected members [Alice, Carol]
```

当前访问结果看似只移除了 Bob，但默认继承语义已经改变。随后加入的 Dave 不会自动获得 Connection A。

### 3.3 当前警告不足以完整表达影响

Console 提示：

> 取消全团队连接后，当前成员将失去访问权限，其他当前团队成员仍可使用。

这句话描述了“当前成员”，但没有明确告知：

- Connection 会从全团队模式转换为指定成员模式；
- 新成员不会再自动获得该 Connection；
- 当前成员列表会被物化进策略，Team 很大时会造成明显的策略膨胀；
- 保存期间若成员变化，必须依赖最新快照、成员重取和 ETag 共同控制竞态。

这不是实现 bug，而是数据模型能力与 UI 直觉之间的错位。Wanta 不应让一个普通复选框承担这种全局转换。

## 4. Wanta 当前状态

### 4.1 已具备的 Connection 中心能力

Wanta 当前每个 Connector-managed Connection account 已有独立权限对话框，能够：

- 在全团队访问与指定成员访问之间切换；
- 配置 Action 不受限或显式 allowlist；
- 保存空成员列表，表达无人可用；
- 保存空 Action allowlist，表达所有 Action 禁止；
- 保留 catalog 中暂时不存在的未知 Action；
- 用 ETag/`If-Match` 防止无提示覆盖；
- 修复 invalid policy；
- 为普通成员提供只读有效权限视图；
- 保持成员范围与 Action 范围互相独立。

因此成员视角不需要引入新的策略格式，也不应复制一套独立 writer。

### 4.2 Team 成员页当前边界

Team 成员页目前只处理：

- 成员列表；
- Team role；
- 启用/停用；
- 添加、移除；
- 管理者与普通成员的操作边界。

成员行没有 Connection 权限概况或入口，也不会加载 `app-access` 与 managed Connection catalog。因此当前页面无法高效回答：

> 某位离职交接成员、外部协作者或服务账号，到底能访问哪些 Connection，访问来源是什么？

### 4.3 可复用基础

| 能力                          | Wanta 当前状态 | 建议用途                                  |
| ----------------------------- | -------------- | ----------------------------------------- |
| `app-access` snapshot 与 ETag | 已完成         | 成员审计和后续安全写入                    |
| Connection App 级 parser      | 已完成         | 将策略投影为成员有效权限                  |
| 成员访问 pure writer          | 已完成         | 只修改目标 App 的成员维度                 |
| Action 范围 parser/summary    | 已完成         | 在成员列表中展示 Action 风险概况          |
| Team detail resource          | 已完成         | 共享/缓存成员、策略和 Connection 目录数据 |
| Connection 权限对话框         | 已完成         | 作为权威的 Connection 中心编辑器          |
| AppShell workspace context    | 已完成         | 提供当前 Team、管理权限和当前用户身份     |

需要注意：现有 `ConnectionAccessDialog` 面向单个 App，在组件内部加载和 mutation。成员视图需要一次解析全部 Apps，适合抽出共享读取模型，而不是循环挂载多个 Connection 对话框。

## 5. 能力对比

| 场景                       | Console Team 成员页 | Wanta 当前                   | Wanta 建议目标                         |
| -------------------------- | ------------------- | ---------------------------- | -------------------------------------- |
| 从成员查看有效 Connection  | 支持                | 不支持                       | 支持，且区分权限来源                   |
| 区分全团队继承/显式授权    | 选择器分组          | 不支持                       | 明确分区与来源标签                     |
| 成员行权限概况             | 三态盾牌            | 无                           | 使用三态入口，并提供可读 tooltip       |
| 修改 selected 模式成员授权 | 支持                | 只能从 Connection 侧修改     | 第二阶段支持                           |
| 从单成员取消 Team 模式权限 | 自动全局转换        | 只能在 Connection 侧改模式   | 默认禁止；高级操作明确转换影响         |
| 查看 Action 范围           | 成员选择器中不突出  | Connection 侧完整支持        | 成员侧显示摘要，编辑仍回 Connection 侧 |
| invalid policy             | repair/reset        | Connection 侧支持            | 成员侧失败关闭并引导修复               |
| 并发写保护                 | ETag                | 已支持                       | 所有成员侧 mutation 复用               |
| 普通成员视角               | 入口由管理页面控制  | Team 页可读成员，权限不展示  | 可选展示“我的有效连接”，不可修改       |
| Direct Provider            | 不在该模型内        | Wanta 有本地 Direct Provider | 明确排除并标注边界                     |

## 6. 推荐产品方案

### 6.1 第一阶段：成员权限审计

在 Team 成员每一行增加盾牌图标。点击打开“成员连接权限”对话框，首版只读。

顶部展示：

- 成员身份；
- 有效 Connection 总数；
- 单独授权数量；
- 继承自 Team 的数量；
- 异常配置数量。

主体使用可搜索列表，并按来源分区：

1. **随团队默认可用**：App 为 Team 模式，该成员因 Team 身份获得访问。
2. **单独授权**：App 为 selected 模式，且成员显式拥有 `connector-app:<appId>` role。
3. **不可用**：selected 模式但成员未被选择。默认折叠，可通过筛选查看。
4. **配置异常**：App 或 policy 无法可靠解释。失败关闭，不能显示为可用。

每个 Connection 行展示：

- Provider 图标；
- Connection display name / alias；
- 权限来源；
- Action 范围摘要：全部 Action、允许 N 项、禁止全部、配置异常；
- Connection 状态；
- “在连接中配置”操作。

首版不提供复选框。这样可以先解决审计问题，同时验证多 App 聚合、来源解释、性能和跨页面导航，不引入新的批量写入风险。

### 6.2 第二阶段：安全的成员中心编辑

只开放局部、可精确表达的变更：

- 对 selected 模式 Connection 添加当前成员；
- 从 selected 模式 Connection 移除当前成员；
- 清除当前成员的全部显式 Connection role，引导其回到各 App 的默认有效状态；
- Team 模式 Connection 始终显示为“随团队继承”，不能在普通列表里直接取消。

建议用“编辑”模式或显式复选框区分只读审计。多项修改先保存在本地 draft，提交前展示差异摘要：

```text
将授予 3 个 Connection
将移除 1 个显式授权
不会修改任何全团队默认范围
```

保存时必须：

1. 重取最新 `app-access` 和 ETag；
2. 重取或验证 managed Connection catalog；
3. 对 draft 中每个目标 App 再解析当前模式；
4. 如果 App 已从 selected 变成 team/invalid，停止并提示刷新；
5. 只增删目标成员的对应 App role；
6. 保留其他用户、其他 App、Action allowlist 和未知字段；
7. PUT 完整文档并携带 `If-Match`；
8. 409/412 时保留 draft，要求用户审阅后重试。

### 6.3 第三阶段：高级排除操作

只有产品确认确实需要时，才允许从成员页排除一个 Team 模式 Connection。入口不应是普通复选框，而应是“从此全团队连接中排除成员”的高级命令。

确认界面必须明确显示：

- 目标 Connection；
- 被排除成员；
- Connection 将从“全团队”变成“指定成员”；
- 当前其余 N 位成员将被显式保留；
- 未来新成员不会自动继承；
- Action 范围不会改变；
- 可通过 Connection 权限页恢复全团队模式。

更保守的实现是仅从成员页跳转到 Connection 权限页，由管理员在那里完成模式转换。这样操作发生在正确的对象上下文中，管理员能同时看到全部受影响成员。

### 6.4 长期模型建议

如果“全团队默认开放，但排除少量成员”是高频业务需求，应推动 Connector/backend 扩展契约，例如：

```json
{
  "memberAccess": {
    "mode": "team",
    "excludedUserIds": ["bob"]
  }
}
```

或等价的 deny/exclusion 规则。服务端必须定义：

- deny 与 allow 的优先级；
- creator/admin 是否可被排除；
- disabled member、service account 和已离队成员如何处理；
- 审计日志如何记录；
- 老策略如何兼容。

在服务端契约落地前，不应在 Wanta 客户端自行发明只对本地 UI 有效的 deny 状态。

## 7. 信息架构与交互细节

### 7.1 成员行三态

建议保留 Console 已验证的三态思路，但让含义更明确：

| 视觉状态   | 判定                         | Tooltip                         |
| ---------- | ---------------------------- | ------------------------------- |
| 成功色盾牌 | 至少一个显式 selected 授权   | “查看连接权限，含 N 个单独授权” |
| 中性盾牌   | 无显式授权，但存在 Team 继承 | “查看连接权限，均随团队继承”    |
| 弱提示盾牌 | 无有效 Connection            | “查看连接权限，当前无可用连接”  |
| 警告色盾牌 | 存在 invalid/missing App     | “连接权限存在异常配置”          |

异常状态优先级应高于授权颜色，避免绿色图标掩盖坏策略。

### 7.2 对话框筛选

建议提供：

- 搜索输入；
- 分段筛选：全部 / 可用 / 单独授权 / 随团队继承 / 不可用 / 异常；
- 稳定数量徽标；
- 大列表虚拟化阈值或至少保持滚动容器固定高度。

不建议用一个包含几十个 chip 的下拉触发器作为主要视图。它在 30 到 100 个 Connection、长 alias 和窄窗口中可读性较差，也无法自然展示 Action 范围与异常来源。

### 7.3 导航

“在连接中配置”应定位到准确的 Connection App，而不只是 Provider：

```text
Team member dialog
  -> Connections route
  -> service
  -> appId
  -> open ConnectionAccessDialog
```

Wanta 当前有 `selectedService` 路径，但成员视图需要补充精确 `appId` 定位，否则同一 Provider 多账号时管理员仍要二次查找。

## 8. 技术设计

### 8.1 领域投影模型

新增纯函数模块：

`src/routes/Skills/team-member-connection-access-model.ts`

建议模型：

```ts
type MemberConnectionProvenance = "team" | "explicit" | "none" | "invalid"

interface MemberConnectionAccessItem {
  appId: string
  service: string | null
  label: string
  provenance: MemberConnectionProvenance
  effective: boolean
  actionScope: "all" | "selected" | "none" | "invalid"
  actionCount: number | null
  issues: ConnectionAccessIssue[]
}
```

它应负责：

- 一次解析全部 managed Apps；
- 按指定 user ID 计算 effective access；
- 区分继承与显式来源；
- 聚合 Action 摘要但不混淆 Action 与成员访问；
- 保留 disconnected/unknown App 信息；
- 为成员行生成轻量 summary；
- 第二阶段生成只针对 selected Apps 的 mutation delta。

### 8.2 UI 组件

新增：

- `src/routes/Skills/TeamMemberConnectionAccessDialog.tsx`
- 可选 `src/routes/Skills/TeamMemberConnectionAccessButton.tsx`

修改：

- `src/routes/Skills/TeamMembersPanel.tsx`
- `src/routes/Skills/TeamMembersTable.tsx`
- Team management/AppShell 的 props 和导航回调；
- i18n 文案与类型定义。

对话框只消费领域投影，不直接理解原始 `TeamAppAccess` 结构。原始策略解析与写入继续集中在 `src/lib/team-connection-access.ts`。

### 8.3 数据加载边界

不要把成员基本列表与权限聚合绑成同一个成功/失败状态。建议拆成：

```text
成员资源：Team members + user summaries
策略资源：Team app-access snapshot
目录资源：managed Connection Apps
Action 摘要：来自已解析 policy；catalog 仅在需要完整名称/总数时按需加载
```

原则：

- 成员列表加载成功时，即使权限策略失败，仍能管理成员；
- 策略失败只禁用盾牌内容并显示重试；
- catalog 失败时可以显示 App ID/已知 service 和策略来源，不应把整个 Team 页面置为错误；
- 切换 Team 时用 request token/AbortController 丢弃旧响应；
- 多个成员行共享一次策略与 App catalog，不对每行发请求；
- 对话框打开时按 user ID 计算投影，不重新请求全部资源，除非缓存失效。

### 8.4 mutation 复用

第二阶段可复用：

- `getTeamAppAccessSnapshot`
- `updateTeamAppAccess`
- `parseTeamConnectionAccess`
- `hasTeamConnectionAppAccess`
- `setTeamConnectionMemberAccess`
- `invalidateTeamDetailsResource`

需要新增一个批量但仍为纯函数的 helper，避免对同一份对象反复解析：

```ts
applyMemberConnectionAccessDelta(access, apps, {
  userId,
  addAppIds,
  removeAppIds,
})
```

该 helper 必须拒绝对 Team 模式和 invalid App 的局部移除。高级模式转换应使用单独命名和单独确认流程，不能复用这个安全 helper。

### 8.5 权限边界

- 只有 Team creator/admin 可以加载管理目录并修改策略；
- 普通成员若展示此入口，只能看到自己，且使用 runtime-visible Apps 或已经过滤后的投影；
- 不向普通成员暴露其他成员列表或 managed Connection 凭证信息；
- Direct Provider 不进入 `app-access` 投影；
- disabled member 的权限应展示但标注账号已停用，便于清理；
- Team role 不是 Connection runtime access 的隐式豁免，creator/admin 在 selected 模式下仍需显式角色。

## 9. 分阶段执行计划

### Phase 0：契约固定与交互决策

目标：在开发 UI 前固定哪些操作属于安全局部修改。

工作项：

1. 用 Console 与 Wanta 共享 fixture 固定 team/selected/invalid/unknown 的解析结果。
2. 写清成员视角的 provenance 和 effective 定义。
3. 产品确认首版只读，以及 Team 模式 Connection 不支持直接取消。
4. 确认 disabled member、service account、离队残留 role 的显示规则。
5. 定义 Connection 精确跳转参数 `service + appId`。

完成标准：同一份策略在 Connection 视图和成员视图产生一致结果；无任何 UI 层自行推断策略。

### Phase 1：只读成员审计

目标：管理员能从任意成员查看完整的有效 Connection 清单和来源。

工作项：

1. 实现成员投影纯函数及测试。
2. 扩展 Team 详情资源，独立加载 app-access 与 managed Apps。
3. 在成员行加入带 loading/error/invalid 状态的盾牌入口。
4. 实现搜索、来源分区、Action 摘要和空状态。
5. 增加“在连接中配置”并支持精确 appId 跳转。
6. 补齐中英文文案和无障碍标签。

完成标准：首版没有任何 `PUT app-access` 路径；展示结果与 Connection 详情一致；权限加载失败不影响成员 CRUD。

### Phase 2：显式授权编辑

目标：管理员可以从成员侧批量调整 selected 模式 Connection 的显式授权。

工作项：

1. 实现 draft 和 delta review。
2. 实现只接受 selected Apps 的批量 pure writer。
3. mutation 前重取 snapshot，并验证目标 App 模式未变化。
4. 写入携带 ETag，处理 409/412 并保留 draft。
5. 成功后统一失效 Team detail 与 Connection detail 缓存。
6. 增加审计事件埋点：打开、筛选、保存、冲突、跳转。

完成标准：不会通过该流程把 Team 模式隐式转换为 selected；不会改动 Action allowlist、其他成员或其他 App。

### Phase 3：高级排除与后端评估

目标：仅在明确需求下支持对 Team 模式的单成员排除。

工作项：

1. 评估真实使用频率和 Team 规模。
2. 优先增加跳转到 Connection 权限页的确认流程。
3. 若实现客户端转换，展示未来成员不继承等完整影响。
4. refetch 最新成员并用 ETag 提交；冲突必须重新确认影响人数。
5. 同时评估后端 `excludedUserIds`/deny 契约和迁移方案。

完成标准：任何 Team -> selected 转换都必须被用户明确确认，且 UI 显示当前和未来影响；不存在普通 checkbox 隐式触发。

## 10. 测试计划

### 10.1 纯模型测试

- Team 模式对每个当前成员投影为 `team + effective=true`。
- selected 模式只对 role 中的成员投影为 `explicit + effective=true`。
- creator/admin 在 selected 模式下没有隐式访问。
- 空 selected member list 表示所有人不可用。
- Action 全量、部分、空 allowlist 与成员来源互相独立。
- role key 是 App 身份来源，Connection 多账号不会按 Provider 合并。
- missing/disconnected App 被保留并进入异常或未知分组。
- invalid policy 失败关闭，不显示为 Team 默认开放。
- 成员 summary 的显式、继承、异常计数准确。
- Phase 1 的所有交互均不生成 mutation。
- Phase 2 增删显式 role 时保留其他用户、其他 App、Action 和未知字段。
- Phase 2 对 Team 模式局部移除明确抛错。
- 高级 Team -> selected 转换保留其他当前成员和原 Action allowlist。

### 10.2 数据与并发测试

- 打开多个成员对话框仍只共享一份聚合资源。
- 保存前重新获取最新 snapshot。
- PUT 带 `If-Match`。
- 409/412 不丢失 draft，不自动覆盖远端。
- Team 切换后旧请求不能回写新 Team 状态。
- 成员、policy、catalog 三类失败状态互不拖垮。
- 保存期间成员加入/离开时，局部 selected 修改保持正确。
- 普通成员不能调用管理 mutation。
- Direct Provider 不进入列表和策略写入。

### 10.3 UI 与运行时验证

- 1080 × 720 桌面窗口。
- 窄 drawer/sheet 和最小支持宽度。
- 超长成员名、邮箱、Provider 名与 Connection alias。
- 50+ Connection、100+ Team 成员场景。
- 键盘打开、搜索、筛选、关闭和焦点恢复。
- 图标 tooltip 与 screen reader label 完整。
- 固定列表高度，loading/badge 不引起布局跳动。
- 无文本遮挡、横向溢出或嵌套 card。
- 同一 Provider 多账号时跳转打开准确 App。

## 11. 验收标准

### 第一阶段

- 管理员可从任一成员行打开连接权限审计。
- 每个 Connection 明确显示“随团队继承”“单独授权”“不可用”或“异常”。
- Action 权限显示为独立摘要，不暗示成员有权调用所有 Action。
- 权限数据失败不影响成员添加、角色、启停和移除。
- 所有 Connection 结果与现有 ConnectionAccessDialog 一致。
- 可以跳转到准确 Connection account 进行配置。
- 不写入 `app-access`。

### 第二阶段

- 仅 selected 模式 Connection 可以从成员页增删显式成员授权。
- Team 模式继承项不能通过普通选择控件取消。
- 保存前能查看差异，冲突时草稿保留。
- 保存不改变 Action 范围、其他成员或不相关策略。
- Connection 页面和成员页面在保存后同步刷新。

### 第三阶段

- Team -> selected 是独立高级操作。
- 确认文案明确未来成员不再自动继承。
- 影响人数由最新成员快照计算。
- ETag 冲突后必须重新计算并再次确认。

## 12. 风险与控制

| 风险                                         | 等级 | 控制措施                                 |
| -------------------------------------------- | ---- | ---------------------------------------- |
| 单成员取消导致整个 Connection 默认范围变化   | P0   | 首两阶段禁止；高级操作独立确认           |
| 成员页与 Connection 页解析结果漂移           | P0   | 共用 parser、writer 和 contract fixtures |
| 批量保存覆盖并发管理员修改                   | P0   | refetch + ETag + 冲突保留 draft          |
| policy/catalog 失败拖垮成员管理              | P1   | 资源和错误边界独立                       |
| 只显示有效权限但不显示来源                   | P1   | provenance 为领域模型必填字段            |
| 多账号按 Provider 错误合并                   | P1   | 所有 identity 和导航使用 appId           |
| 大 Team 物化成员导致策略膨胀                 | P1   | 默认不支持 Team 排除；推动后端 exclusion |
| 普通成员看到管理目录或他人权限               | P1   | 管理/运行时端点分流与视图权限检查        |
| Direct Provider 被误认为已受 app-access 管理 | P1   | 明确排除并单独标识产品边界               |

## 13. 推荐排期与优先级

建议优先级：

1. **P0：Phase 0 + Phase 1。** 补齐成员视角审计，不引入策略写入。
2. **P1：Phase 2。** 在审计模型稳定后开放 selected 模式显式授权编辑。
3. **P2：Phase 3。** 用真实需求数据决定是否实现高级排除，优先推动后端模型。

粗略工程量按一个熟悉 Wanta 权限模块的工程师估算：

| 阶段    | 工程量               | 主要产出                                      |
| ------- | -------------------- | --------------------------------------------- |
| Phase 0 | 1–2 人日             | fixtures、模型定义、交互决策                  |
| Phase 1 | 4–6 人日             | 只读审计、聚合资源、精确跳转、测试            |
| Phase 2 | 3–5 人日             | draft、批量 selected mutation、冲突处理、测试 |
| Phase 3 | 2–4 人日（不含后端） | 高级确认与转换；后端 exclusion 需另行评估     |

## 14. 最终建议

本轮优化应以“成员权限审计”作为第一交付物，而不是直接复制 Console 的 Connection 多选框。

Wanta 已经有完整的 Connection 中心权限编辑器。新增成员视角的价值是提供反向查询、权限来源解释和跨连接审计；它不应该让局部交互掩盖全局默认策略变化。只读审计先行、显式授权编辑随后、Team 范围排除单独升级，是当前契约下风险最低且最容易验证的推进顺序。

## 15. 主要代码依据

### Console

- `src/pages/teams-members-panel.tsx`
- `src/pages/teams-provider-access-dialog.tsx`
- `src/pages/teams-provider-access.ts`
- `src/pages/team-connector-access-policy.ts`
- `src/pages/teams-manage-store.ts`
- `src/pages/teams-manage-store.test.ts`
- `src/api/teams.ts`
- `src/i18n/common/zh-CN.json`

### Wanta

- `src/routes/Skills/TeamMembersPanel.tsx`
- `src/routes/Skills/TeamMembersTable.tsx`
- `src/routes/Skills/use-team-details.ts`
- `src/routes/Connections/ConnectionAccessDialog.tsx`
- `src/routes/Connections/index.tsx`
- `src/lib/team-connection-access.ts`
- `src/lib/team-details-resource.ts`
- `src/lib/teams-client.ts`
- `src/components/app-shell/AppShell.tsx`
