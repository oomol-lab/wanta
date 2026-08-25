# Wanta 与 Console 组织 / Connection 权限最终对齐报告

**完成日期：** 2026-08-25

**Wanta 实施基线：** `main@c9775f26` 之后的当前工作树

**Console 参考基线：** `oomol/console.oomol.com main@cfaaf5e`
**范围：** Team Connection 权限契约、成员分配、管理 / 成员 API、legacy 迁移、并发写入、Lingxing 数据权限、管理 UI 与错误恢复

## 最终结论

Wanta 已按 Console 当前实现完成 Permission Rules v2 的安全语义和迁移能力对齐：

- 正常读写统一使用 `permissionRules.teamDefault + rules + assignments`；
- legacy `requireRole + user.roles` 可安全读取，任何写入都会转换为 canonical multi-rule；
- v2 外层与 grant 字段使用严格 allowlist，`effect` 和未知字段失败关闭；
- 新建规则默认 deny-all；
- invalid policy 可由团队管理员恢复未配置状态；
- 管理端、普通成员、Action 和 Lingxing ERP 用户 API 与 Console 一致；
- Lingxing 权限支持按需加载、状态码错误说明、负责人姓名摘要和 App ID 权限提示；
- 中文 Lingxing Action description 与 Console 本地化内容一致；
- 保存前刷新最新 policy，并强制使用 ETag / `If-Match`。
- HTTP 412 冲突会关闭过期编辑草稿、重新加载最新 policy，并提示管理员确认后再编辑。

Wanta 仍保留一个明确的产品差异：日常权限写入口只放在具体 Connection，不恢复 Console 成员中心的第二套批量编辑器。底层权限文档、assignment 语义和服务端执行结果保持一致；这是 UI 信息架构收敛，不是授权契约差异。

## 参考变更

- [Console PR #290：use policy-visible apps for team members](https://github.com/oomol/console.oomol.com/pull/290)：管理员 / 创建者使用 `/v1/connections`，普通成员使用 `/v1/apps`。
- Console `5607e3b`：多规则 `permissionRules` 管理界面。
- Console `df68360`：Lingxing ERP 负责人权限与用户端点。
- Console `969c6a`：Action description 本地化。
- Console `795fef5`：规则摘要显示 Lingxing 负责人姓名。
- Console `cfaaf5e`：Lingxing App ID / ERP 用户权限说明。

[Console PR #299](https://github.com/oomol/console.oomol.com/pull/299) 和 [Console PR #300](https://github.com/oomol/console.oomol.com/pull/300) 属于 Connection discovery / onboarding 信息架构，不改变本报告的组织权限契约。

## 最终对齐矩阵

| 领域                | Console                                        | Wanta                             | 状态           |
| ------------------- | ---------------------------------------------- | --------------------------------- | -------------- |
| Role subject        | `role::connector-app:<appId>`                  | 相同                              | 对齐           |
| 最终模型            | `teamDefault`、`rules`、`assignments`          | 相同                              | 对齐           |
| assignment          | 命中自定义规则，否则只使用 team default        | 相同                              | 对齐           |
| deny-all            | `actions: []`                                  | 相同                              | 对齐           |
| unrestricted        | 缺少 `actions`                                 | 相同                              | 对齐           |
| legacy              | 兼容读，写入时迁移 multi-rule                  | 相同                              | 对齐           |
| v2 外层校验         | 严格 key allowlist，拒绝 `effect`              | 相同                              | 对齐           |
| grant 校验          | 多规则 grant 严格 key allowlist                | 相同                              | 对齐           |
| `appAccessConfig`   | 当前仅 Lingxing 合法                           | 相同                              | 对齐           |
| 新规则默认值        | deny-all                                       | deny-all                          | 对齐           |
| invalid 恢复        | 管理员可恢复未配置                             | 相同                              | 对齐           |
| 管理端 App API      | `/v1/connections`                              | 相同                              | 对齐           |
| 普通成员 App API    | `/v1/apps`                                     | 相同                              | 对齐           |
| Action API          | `/v1/actions?service=...`                      | 相同                              | 对齐           |
| Lingxing 用户 API   | `/v1/connections/by-id/:id/lingxing/erp-users` | 相同                              | 对齐           |
| Lingxing grant 三态 | users 缺失 / 非空 / 空数组                     | 相同                              | 对齐           |
| Lingxing 加载       | 编辑 selected-owner rule 时按需读取            | 相同                              | 对齐           |
| Action description  | 中文 Connector 本地化                          | Lingxing 权限 Action 使用同一文案 | 对齐本次范围   |
| 保存前刷新          | mutation 前重新 GET policy                     | 相同                              | 对齐           |
| 并发写入            | ETag 存在时 `If-Match`                         | 强制要求 ETag 和 `If-Match`       | Wanta 更严格   |
| 412 冲突恢复        | 拒绝过期写入                                   | 丢弃过期草稿并重新加载最新 policy | 对齐并增强     |
| 成员中心编辑器      | 保留兼容入口                                   | 不保留第二写入口                  | 有意的 UI 差异 |

## 关键实现

### 兼容读、canonical 写

`src/lib/team-connection-access.ts` 同时解析最终 multi-rule 文档和 legacy `requireRole`、`user::<id>.roles` 文档。legacy 只作为迁移输入。任意写入都会：

- 生成最终 `permissionRules`；
- 将 `legacy:<appId>` 替换为新的 UUID rule ID；
- 同步重映射 assignments；
- 删除该 App 的 legacy `user.roles` 引用；
- 保留其他角色和无关 policy 数据。

### 严格失败关闭

multi-rule connector 外层只允许 `app`、`method`、`provider`、`permissionRules`；`permissionRules` 只允许 `teamDefault`、`rules`、`assignments`。每个 grant 只允许 `actions` 和 `appAccessConfig`；规则额外允许 `id` 和 `name`。

`effect`、未知字段、重复 Action、重复 rule ID、非法 Lingxing 用户结构均判 invalid。

### 最小权限默认值与 invalid 恢复

新建自定义规则使用 `actions: []`，管理员必须显式选择允许的 Action。invalid policy 不进入常规 transform，但管理员可以基于最新 snapshot 删除目标 Connector role 和 legacy 引用，再通过 ETag 更新。普通成员仍只能看到失败关闭状态。

### Lingxing

每个 grant 独立支持：

- 负责人不受限：缺少 `appAccessConfig.users`；
- 指定负责人：`users: [...]`；
- 无负责人权限：`users: []`。

ERP 用户仅在编辑 selected-owner rule 时读取。403 / 404 / 409 / 429 / 502 显示对应说明；已保存但 API 不再返回的负责人继续显示并允许移除。规则摘要显示负责人姓名，连接凭据页说明 App ID 必须具备 ERP 用户读取权限。

## 测试覆盖

回归覆盖包括：

- legacy 读取和首次写入迁移；
- legacy assignment UUID 重映射与无关角色保留；
- `effect` / 未知外层字段失败关闭；
- 非 Lingxing `appAccessConfig` 失败关闭；
- deny-all、unrestricted 与 assignment fallback；
- Lingxing users 缺失、非空、空数组三态；
- invalid / configured App 恢复时删除目标角色和 legacy 引用；
- 新规则默认 deny-all；
- Lingxing Action 中文本地化不改变 Action identity；
- Connection API 路径、Lingxing 用户端点和 ETag 请求。
- HTTP 412 冲突识别、过期草稿关闭和最新 policy 重载。

## 发布建议

本轮授权契约修复应独立于 Connection discovery / onboarding 页面改造发布。上线观察重点：

- legacy policy 首次编辑后的 canonical v2 文档；
- ETag 是否在所有桌面网络路径稳定暴露；
- 412 冲突后最新 policy 是否成功重载；
- Lingxing 403 是否能通过 App ID 权限配置恢复；
- 普通成员实际可见 App 是否始终以服务端 `/v1/apps` 为最终权威。

## 验证结果

- TypeScript 检查通过；
- 全仓 oxlint 通过；
- 全仓格式检查通过；
- renderer、main、preload 生产构建通过；
- 5 个定向测试文件、66 项测试全部通过；
- 完整套件 355 个测试文件、2799 项测试通过，2 个文件 / 4 项测试跳过；
- `electron/agent/oo-guard-runtime.test.ts` 的一个既有时序用例在全量并发运行时未等到临时 started 文件；该文件单独运行时 5 项全部通过，与本轮权限改动无代码关联。
