# Console 权限 v2 对齐实施报告

**完成日期：** 2026-08-25

**Wanta 实施基线：** `main@56526745`

**Console 参考基线：** `oomol/console.oomol.com main@cfaaf5e`

## 结论

Wanta 的 Team Connection 权限已经迁移到最终的多规则 `permissionRules` 契约。历史 `requireRole + user.roles` 文档只作为兼容读取和迁移输入；任意写入都会输出最终结构并清理目标 App 的 legacy 角色引用。异常结构统一失败关闭，团队管理员可恢复默认后重新配置。

日常权限编辑入口集中在具体 Connection。Team 成员页只管理成员身份、角色和启停状态，不再维护另一套成员中心 Connection 授权界面。

## 最终契约

每个 Connection App 的权限存储在：

```text
role::connector-app:<appId>
```

规范结构为：

```json
{
  "role::connector-app:app-123": {
    "connector": [
      {
        "app": ["app-123"],
        "method": "POST",
        "provider": "github",
        "permissionRules": {
          "teamDefault": {
            "actions": ["issues.list"]
          },
          "rules": [
            {
              "id": "0198-rule-id",
              "name": "研发管理员",
              "actions": ["issues.list", "issues.create"]
            }
          ],
          "assignments": {
            "user-alice": "0198-rule-id"
          }
        }
      }
    ]
  }
}
```

权限计算规则：

- 成员存在有效 assignment 时，只使用对应自定义规则。
- 没有 assignment 时，只使用 `teamDefault`。
- 默认规则和自定义规则不合并。
- 每名成员最多对应一条自定义规则。
- `actions` 缔约于每个 grant，而不是 App 顶层。
- `actions: []` 表示全部 Action 禁止。
- 缺少 `actions` 且缺少 `appAccessConfig` 时，Action、Proxy 和 MCP `tool_call` 不受限。
- 存在 `appAccessConfig` 时，Proxy 和 MCP `tool_call` 禁止。

## 已完成内容

### canonical v2 policy adapter

`src/lib/team-connection-access.ts` 现在提供：

- 最终契约解析；
- legacy 契约兼容读取与首次写入迁移；
- malformed policy 按 App 失败关闭；
- 当前用户有效 grant 和规则计算；
- canonical v2 写入；
- 团队默认 grant 更新；
- 自定义规则新增、修改和删除；
- 成员 assignments 更新；
- Connection 恢复未配置状态；
- `appAccessConfig` 无损保留；
- Lingxing 负责人权限解析和写入。

legacy writer 和成员 role writer 均不存在；兼容 reader 只负责将存量文档投影为多规则模型，所有 writer 只输出 canonical v2。

### Connection 规则管理

`src/routes/Connections/ConnectionAccessDialog.tsx` 已改为：

- 团队默认权限卡片；
- 多条具名自定义规则；
- 规则创建、重命名和删除；
- 成员多选和跨规则移动；
- 每规则 Action 编辑；
- 普通成员只读有效规则；
- 删除规则后的默认权限回落提示；
- 恢复未配置状态确认；
- 保存前重新读取最新 policy；
- ETag / `If-Match` 并发保护。

### Team 成员页收敛

以下成员中心旧权限模块已删除：

- `TeamMemberConnectionAccessDialog.tsx`；
- `team-member-connection-access-model.ts`；
- `team-provider-access.ts`；
- 对应测试、表单、文案和 Provider option 资源。

Team 设置不再请求 Connection catalog 或 `app-access`，只读取成员及成员摘要。

### Lingxing 负责人权限

新增管理端点：

```text
GET /v1/connections/by-id/:appId/lingxing/erp-users
x-oo-team-name: <teamName>
```

每个 grant 可独立配置：

- 负责人不受限：缺少 `appAccessConfig.users`；
- 指定负责人：`users: [...]`；
- 无负责人权限：`users: []`。

修改成员、规则名称或 Action 时保留 Lingxing 配置和未知合法扩展属性。已保存但 Lingxing 不再返回的负责人会继续显示，并允许管理员显式移除。Lingxing 用户列表请求失败不会阻断其他权限编辑。

## 安全边界

- App ID 以 role subject 为权威身份。
- 配置存在但不满足最终结构时，不回退到默认开放。
- 一个 App 的异常不影响其他 App。
- assignments 指向不存在规则或非当前成员时不参与权限计算。
- Action、成员 assignment 和 Provider 数据权限相互独立。
- 所有更新基于最新快照执行纯 transform，并通过 ETag 防止覆盖其他管理员的修改。
- 普通成员读取策略可见 `/v1/apps`；管理者读取 `/v1/connections`。
- Connector 服务端仍是最终授权点。

## 验证

实施完成后执行：

- TypeScript 检查；
- oxlint；
- 全仓格式检查；
- Vite renderer/main/preload 生产构建；
- v2 parser/writer 定向测试；
- Connection client 和 Lingxing 端点测试；
- 完整 Vitest 测试套件。

本轮定向验证 5 个测试文件、66 项测试全部通过；TypeScript、全仓 oxlint、全仓格式检查和 renderer/main/preload 生产构建通过。完整测试套件中 355 个测试文件、2799 项测试通过，另有 `electron/agent/oo-guard-runtime.test.ts` 的既有时序用例在全量并发运行时失败；该用例单独运行时 5 项全部通过，与本轮权限改动无代码关联。
