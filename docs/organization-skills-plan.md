# 组织级 Skill 配置方案

> 相关：[project-overview.md](project-overview.md)（产品定位）· [architecture.md](architecture.md)（进程与 Agent）· [conventions.md](conventions.md)（约定）

## 1. 背景与目标

当组织连接了大量 SaaS 服务后，Agent 只依赖 action 搜索与 schema inspect，容易出现服务选择不稳定、参数理解偏差、任务流程不一致等问题。组织级 Skill 的目标是让组织管理员把与组织工作流强相关的 Skill 配置到组织工作区，使成员切换到该组织后，Agent 自动获得这组 Skill 的指导，从而更准确地调用组织连接器与本地工具。

本功能要满足：

- 组织拥有自己的 Skill 配置；个人空间继续使用现有本地 / runtime Skill。
- 用户切换组织时，连接器作用域与组织 Skill 作用域同步变化。
- 成员可查看组织 Skill，组织 creator 可管理组织 Skill。
- 配置结果必须进入 Agent 生效路径，而不是只显示在 UI 上。
- 后端 API 参考 Console 现有 Skill / organization / connection 设计，但 Wanta 前端按当前三栏与 Skills Route 结构接入。

## 2. Console 参考结论

Console 的 Skill 菜单主要是“我发布的 Skill”管理和分享，不是完整的组织级 Skill 配置。

可直接参考的部分：

| 范围                | Console 位置                                 | 可复用点                                                                                       |
| ------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 我发布的 Skill 列表 | `src/api/skills.ts`                          | `GET search.<endpoint>/v1/packages/-/my-skills?size=100&lang=...`                              |
| Skill Markdown 预览 | `src/api/skills.ts`                          | `GET package-assets.../packages/{packageName}/{version}/files/package/skills/{skill}/SKILL.md` |
| 私有 Skill 临时分享 | `src/api/skills.ts`                          | `POST registry.<endpoint>/-/oomol/package-shares/share/{packageName}`，仅适合临时分享          |
| 组织 workspace 选择 | `src/stores/organization-workspace/store.ts` | UI 存 organization id，请求连接器时解析 organization name                                      |
| 连接器组织作用域    | `src/api/connections.ts`                     | 连接器请求通过 `x-oo-organization-name` header 切组织                                          |

不可照搬的部分：

- Console 的 Skill 页没有“组织配置”概念，也不会让 Agent runtime 生效。
- Console 的临时 share id 不适合作为组织长期配置。组织配置私有 Skill 应由后端按组织权限校验。
- Wanta 已有更完整的 Skill 页面与本地 runtime 管理，应该增量接入组织层，而不是替换成 Console 的单列表页。

## 3. 当前 Wanta 基础

Wanta 已具备以下基础能力：

- 组织列表、成员、权限、app access 请求已在渲染层直连，见 `src/lib/organizations-client.ts`。
- 连接器请求已按 workspace 带 `x-oo-organization-name`，见 `src/lib/connections-client.ts`。
- Agent 组织作用域已通过 `chatService.setAgentOrganization` 同步到主进程，`AgentManager` 写 `organization-scope.json`，自定义 connector 工具运行时读取组织名。
- Skills Route 已有 Discover / Installed / install / update / publish / preview，见 `src/routes/Skills/index.tsx`。
- Runtime Skill 当前经 `SkillServiceImpl` 安装到 Wanta runtime skill root，并通过 agent refresh 让 OpenCode 重新扫描。

因此组织级 Skill 的主要新增点是：远端组织配置 API、组织配置 UI、组织配置到 Agent 生效路径的同步。

## 4. 后端 API 设计

组织级 Skill 是组织策略，建议 API 放在 `org-control.<endpoint>`。Skill 包浏览、Markdown 预览、registry 信息仍复用 search / registry / package-assets。

### 4.1 组织 Skill 配置模型

```ts
interface OrganizationSkillConfigItem {
  id: string
  packageName: string
  skillName: string
  version: string
  versionPolicy: "pinned" | "latest"
  displayName: string
  description?: string
  icon?: string
  visibility: "public" | "private" | "unknown"
  enabled: boolean
  order: number
  createdBy: string
  createdAt: string
  updatedAt: string
}
```

约束：

- `packageName + skillName` 在同一组织内唯一。
- 默认 `versionPolicy = "pinned"`，保存具体版本，保证组织配置可复现。
- `latest` 仅作为显式选择，后端在 resolved API 中解析到当前最新版本。
- `enabled=false` 保留配置但不进入 Agent 生效集合。

### 4.2 读取组织配置

```http
GET /v1/organizations/{orgId}/skills
Host: org-control.<endpoint>
```

响应：

```json
{
  "skills": [
    {
      "id": "org-skill-1",
      "packageName": "@oomol/gmail-skills",
      "skillName": "gmail-report",
      "version": "1.2.3",
      "versionPolicy": "pinned",
      "displayName": "Gmail Report",
      "description": "Generate repeatable Gmail summaries and reports.",
      "icon": ":mail:",
      "visibility": "private",
      "enabled": true,
      "order": 100,
      "createdBy": "user_id",
      "createdAt": "2026-06-25T00:00:00.000Z",
      "updatedAt": "2026-06-25T00:00:00.000Z"
    }
  ],
  "updatedAt": "2026-06-25T00:00:00.000Z"
}
```

权限：

- 组织 creator / member 均可读。
- 用户不属于组织返回 403。

### 4.3 新增配置

```http
POST /v1/organizations/{orgId}/skills
Host: org-control.<endpoint>
Content-Type: application/json
```

请求：

```json
{
  "packageName": "@oomol/gmail-skills",
  "skillName": "gmail-report",
  "version": "1.2.3",
  "versionPolicy": "pinned",
  "enabled": true
}
```

权限：

- 仅组织 creator 可写。
- 后端校验 package 存在、skill 属于该 package、private package 对该组织或操作者可见。

### 4.4 更新配置

```http
PATCH /v1/organizations/{orgId}/skills/{configId}
Host: org-control.<endpoint>
Content-Type: application/json
```

请求：

```json
{
  "enabled": false,
  "order": 200,
  "version": "1.2.4",
  "versionPolicy": "pinned"
}
```

### 4.5 删除配置

```http
DELETE /v1/organizations/{orgId}/skills/{configId}
Host: org-control.<endpoint>
```

### 4.6 批量替换排序

```http
PUT /v1/organizations/{orgId}/skills/order
Host: org-control.<endpoint>
Content-Type: application/json
```

请求：

```json
{
  "items": [
    { "id": "org-skill-1", "order": 100 },
    { "id": "org-skill-2", "order": 200 }
  ]
}
```

### 4.7 Resolved API

Wanta 要让 Skill 真正进入 Agent runtime，最终需要拿到可下载、可校验的 Skill artifact。建议新增：

```http
GET /v1/organizations/{orgId}/skills/resolved
Host: org-control.<endpoint>
```

响应：

```json
{
  "skills": [
    {
      "configId": "org-skill-1",
      "packageName": "@oomol/gmail-skills",
      "skillName": "gmail-report",
      "version": "1.2.3",
      "archiveUrl": "https://package-assets.oomol.com/packages/@oomol/gmail-skills/1.2.3/files/package/skills/gmail-report.tgz",
      "checksum": "sha256:...",
      "manifest": {
        "format": "oomol-skill-archive",
        "entry": "SKILL.md",
        "files": [
          { "path": "SKILL.md", "checksum": "sha256:..." },
          { "path": "assets/logo.png", "checksum": "sha256:..." }
        ]
      }
    }
  ],
  "updatedAt": "2026-06-25T00:00:00.000Z"
}
```

`resolved` endpoint 应是运行时解析的权威入口：后端在这里完成 package 权限校验、版本解析、artifact 地址生成和 checksum/manifest 生成。Wanta 只按响应下载单个 Skill artifact，并用 `checksum` 与 `manifest.files` 校验完整性后再释放到 runtime。

如果 registry 短期还没有单 Skill 归档，可以临时返回 `assetBaseUrl` + `skillPath` 作为目录 fallback，但仍必须同时返回 manifest 与每个文件 checksum。客户端不能只靠目录路径推断结构，否则容易遗漏 `references/`、`assets/`、脚本或后续新增资源。

## 5. Wanta 前端接入

### 5.1 新增请求客户端

新增 `src/lib/organization-skills-client.ts`：

- `listOrganizationSkills(orgId)`
- `addOrganizationSkill(orgId, input)`
- `updateOrganizationSkill(orgId, configId, patch)`
- `removeOrganizationSkill(orgId, configId)`
- `reorderOrganizationSkills(orgId, items)`
- `listResolvedOrganizationSkills(orgId)`（runtime 同步阶段使用）
- `listMyPublishedSkills(locale)`（参考 Console `my-skills`）
- `readSkillMarkdown(packageName, version, skillName)`

实现要求：

- 统一使用 `oomolFetchJson` / `oomolFetch`。
- base URL 从 `@/lib/domain` 派生，补充 `packageAssetsBaseUrl` 常量时也必须来自 `electron/domain.ts`。
- 不在渲染层设置 `Authorization` / `Cookie`，继续依赖 httpOnly `oomol-token` cookie。
- 401 归一为现有 auth_required 流程。

### 5.2 SkillsRoute 接收 workspace

当前 `AppShell` 已持有 `organizationWorkspace`。将：

```tsx
<SkillsRoute />
```

改为：

```tsx
<SkillsRoute workspace={organizationWorkspace} />
```

`SkillsRoute` 内根据 `workspace.activeWorkspace` 决定是否展示组织配置区域：

- personal：只显示现有 Discover / Installed。
- organization 且组织对象未解析：显示 loading。
- organization 已解析：显示组织配置 tab / section。

### 5.3 新增 hook

新增 `src/routes/Skills/useOrganizationSkillConfig.ts` 或放入 `src/hooks/`：

```ts
interface UseOrganizationSkillConfig {
  canManage: boolean
  error: UserFacingError | null
  loading: boolean
  skills: OrganizationSkillConfigItem[]
  addSkill(input: AddOrganizationSkillInput): Promise<void>
  removeSkill(configId: string): Promise<void>
  reload(options?: { forceRefresh?: boolean }): Promise<void>
  reorder(items: { id: string; order: number }[]): Promise<void>
  updateSkill(configId: string, patch: UpdateOrganizationSkillInput): Promise<void>
}
```

缓存 key 使用 `organization:${orgId}`。切换组织时必须清空上一组织的配置状态，避免短暂显示错组织 Skill。

### 5.4 UI 结构

建议在现有 Skills 页面中加入组织区域，而不是创建新主路由：

- 顶部显示当前 workspace：个人 / 组织名。
- 组织态显示 `Organization Skills` section。
- 已配置 Skill 列表展示：icon、displayName、packageName@version、enabled 状态、更新时间。
- creator 可见操作：Add、Enable/Disable、Remove、Update version、Reorder。
- member 只读，操作区显示“Managed by organization creator”。

Add Skill 面板：

- 数据源 tab：
  - My published：使用 Console 的 `my-skills` API。
  - Public：复用 Wanta 现有 public catalog。
- 搜索字段匹配 displayName / skillName / packageName / description。
- 选择具体 skill，而不是只选择 package。
- 右侧预览 `SKILL.md`。
- 确认后调用组织配置新增 API。

### 5.5 Composer Palette

当前 `ChatComposer` 的 Skill palette 只来自 runtime inventory。组织态需要合并组织配置：

- 组织 Skill 排在个人 runtime Skill 前。
- 同名 Skill 以组织配置优先。
- 禁用的组织 Skill 不进入 palette。
- 组织 Skill item 的 meta 显示 `organization`。
- 选中后仍生成 `ChatContextMention { kind: "skill" }`，进入当前 turn 的 system prompt。

## 6. Agent 生效路径

组织级 Skill 有两阶段生效方案。

### 6.1 第一阶段：system prompt 生效

这是最小可交付版本，不要求立刻同步 Skill 文件。

流程：

1. 渲染层切组织后加载组织 Skill 配置。
2. 发送消息时把当前启用的组织 Skill 摘要传给 `chatService.sendMessage`，或主进程按 active organization 自行读取缓存。
3. `ChatServiceImpl` 构造 per-turn system prompt。
4. `AgentManager.promptStreaming` 与现有 `buildAuthorizedSystem()`、`buildContextMentionsSystem()` 合并。

提示词原则：

- 只描述“组织为当前 workspace 配置了这些 Skill”，不强迫使用。
- 明确“仅当用户请求相关时使用”。
- 显式 `@skill` 的权重高于组织默认配置。
- 不把大量完整 `SKILL.md` 全量塞进每轮 system，避免 prompt 膨胀；只放名称、id、描述、package。

示例：

```text
Organization-configured skills for the active workspace:
- Treat these as workspace guidance, not mandatory tool calls.
- Use them only when they are relevant to the user's actual task.
- "Gmail Report"; id: "gmail-report"; package: "@oomol/gmail-skills"; description: "Generate repeatable Gmail summaries and reports."
```

优点：切换组织即时生效；实现风险低。缺点：不等价于 OpenCode 原生 Skill 加载，复杂 Skill 的 references / scripts 不能自动读取。

### 6.2 第二阶段：runtime Skill 文件同步

完整方案是把组织 Skill 同步到 Wanta app-private runtime skill root，让 OpenCode 扫描到真实 `SKILL.md` 与配套文件。

目录建议：

```text
userData/agent/organization-skills/{orgId}/{skillName}/
userData/agent/workspace/.opencode/skill/{skillName}/
```

注意：

- 不写 `~/.agents/skills`，避免污染个人和其他 agent。
- 不删除 bundled skills。
- 不删除用户个人 runtime skills，除非明确采用“组织覆盖同名 skill”的策略。
- 同组织内禁止重复 `skillName`。
- 切组织后同步完成再触发 agent refresh。

同步流程：

1. 渲染层或主进程得知 active organization 变化。
2. 主进程拉 `resolved` API。
3. 下载每个 enabled Skill artifact。
4. 校验 checksum。
5. 写入 `userData/agent/organization-skills/{orgId}/`。
6. 重建 `.opencode/skill/` 中的组织 Skill 映射。
7. 复用 `scheduleAgentRefreshForSkillChange()` 重启 sidecar。
8. 如果当前有 active generation，沿用 busy retry 机制，回复完成后再刷新。

建议把远端同步逻辑拆到新模块，例如 `electron/organization-skills/`，不要把 `SkillServiceImpl` 继续变成巨型类。

## 7. 组织切换流程

切换组织后应发生：

1. `useOrganizationWorkspace` 更新 active workspace。
2. `useConnections` 用 organization name 刷新连接器 summary。
3. `chatService.setAgentOrganization` 更新主进程 agent 组织名，保持现状。
4. `useOrganizationSkillConfig` 加载组织 Skill 配置。
5. Composer palette 刷新组织 Skill。
6. 第一阶段：下一轮消息 system prompt 带组织 Skill 摘要。
7. 第二阶段：主进程同步 Skill 文件并刷新 agent runtime。

如果组织 id 已选中但 organization name 尚未解析：

- 连接器请求必须保持 pending，并清空当前连接器 summary；不能沿用上一个组织或个人 workspace 的 `x-oo-organization-name`。
- 组织 Skill 配置可按 org id 读取。
- `chatService.setAgentOrganization` 应先清空主进程 agent 组织名，Agent connector tool 在新 organization name 可用并完成连接器 scope 刷新前暂停组织连接器调用。
- organization name 可用后，先用新 organization name 刷新连接器 summary，再恢复 Agent connector tool 与 UI 操作，确保所有 connector/tool 请求都使用新的组织上下文。

## 8. 权限与安全

- 组织 creator 可管理组织 Skill。
- 组织 member 可查看组织 Skill，但不能修改。
- private package 权限必须由后端校验，不接受客户端传 share id 绕过。
- 渲染层不接触 session token。
- 主进程同步 Skill 文件时必须校验路径，禁止 artifact 解压写出目标目录。
- `skillName` 用作目录名前必须做安全校验，拒绝 `/`、`\`、`.`、`..`。
- 下载 artifact 要有大小限制和超时。
- 组织 Skill 不应进入外部 agent skill root。

## 9. 版本与更新策略

默认策略：

- 添加组织 Skill 时保存具体 `version`，`versionPolicy = "pinned"`。
- UI 提供 “Update to latest”。
- 后端或 Wanta 可检查组织 Skill 是否有新版本。
- `latest` 策略仅给高级场景使用，UI 要明确提示会自动变化。

更新检查可复用现有 registry version check 思路，但组织 Skill 的检查结果应与个人 Installed Skill 分开展示，避免用户误以为本地已安装 Skill 需要更新。

## 10. 实施阶段

### 阶段 1：后端 API 与前端只读

- 后端提供组织 Skill CRUD 中的 `GET /skills`。
- Wanta 新增 `organization-skills-client.ts`。
- SkillsRoute 在组织态显示只读组织 Skill 列表。
- 切换组织时状态正确隔离。

### 阶段 2：组织 Skill 管理 UI

- creator 可添加 / 删除 / 启停 / 排序。
- Add Skill 复用 public catalog 与 Console `my-skills`。
- 支持 `SKILL.md` 预览。
- member 只读。

### 阶段 3：system prompt MVP 生效

- 组织 Skill 摘要进入每轮 system。
- Composer palette 合并组织 Skill。
- 增加测试覆盖 prompt 构造与 palette 合并。

### 阶段 4：runtime 同步完整生效

- 后端提供 resolved artifact API。
- 主进程同步组织 Skill 到 app-private runtime root。
- 切组织后刷新 agent。
- 处理 active generation busy retry。

### 阶段 5：版本管理与治理

- 组织 Skill 更新检查。
- Update to latest。
- 操作审计 / updatedBy。
- 同名冲突策略 UI 明示。

## 11. 测试建议

纯函数 / 单测：

- organization skill API normalize。
- organization switch 后 cache key 隔离。
- creator / member 权限 UI model。
- organization skill + installed skill palette 合并去重。
- system prompt 构造：不强迫使用、不泄漏无关数据、显式 mention 优先。
- artifact 路径校验与解压目录逃逸防护。

集成 / 手工验证：

- 个人空间不显示组织 Skill 配置。
- 切组织 A → B 后列表、Composer、agent scope 同步变化。
- 组织成员只读。
- creator 添加 private Skill 后成员可见并能用于组织工作区。
- active generation 期间修改组织 Skill 不打断当前回复。
- 登出后组织 Skill cache 不泄漏到下一个账号。

## 12. 主要风险

- 只有 UI 配置但不进入 Agent 生效路径，会达不到产品目标。
- 使用临时 share id 做长期组织配置会在过期后失效。
- `latest` 自动漂移会造成组织内任务结果不可复现。
- 组织 id 与组织 name 混用会导致 org-control 和 connector 作用域错乱。
- runtime 同步若粗暴重建 `.opencode/skill/`，可能删掉 bundled skills 或个人 runtime skills。
- 生成中重启 sidecar 会影响用户体验，必须沿用现有延迟刷新策略。
