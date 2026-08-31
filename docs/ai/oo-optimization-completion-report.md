# Wanta OO 优化完成审计报告

更新时间：2026-08-31（Asia/Shanghai）

## 1. 审计结论

前序分析中属于当前问题、能产生直接产品收益且不构成过度设计的改动，已经全部完成：

- 修复内置 OpenCode 错用 BYOA guard 的故障；
- 内置 OpenCode 与 BYOA 对合法托管 OO 操作统一自动放行；
- `oo file upload/download`、Connector execution、Flow run/publish 不再弹批准；
- 覆盖事故中真实出现的 `BUN_BE_BUN=1 oo ...` 命令形态；
- 保留身份、workspace、operation、路径、URL、凭证和混合 shell 的直接拒绝；
- 明确禁止 OO 基础设施失败后绕到 curl、wget、本机原生 `oo`、直连 API 或非 schema 要求的 base64；
- 增加内置图片编辑 `upload → submit → result → download` 回归；
- 保证签名上传 URL 在当前 turn 内可供 Agent 使用，完成后从 OpenCode 持久化历史中脱敏；
- 增加 OpenCode、Claude 风格和 ACP/BYOA 风格的权限一致性测试；
- 同步 Skill policy、架构文档和交接文档；
- 完成全量测试、类型、lint、OO bundle 和生产构建验证。

没有实施完整 `OoCapabilityRuntime`、新 turn lease 或强制所有 Agent 使用同一种协议。这些属于没有当前故障证据支持的长期抽象，暂缓可以避免过度设计。

## 2. 完成项明细

### 2.1 内置 OpenCode guard 修复：完成

事故路径原为：

```text
内置 OpenCode
→ Skill 中调用 oo
→ 错误进入 BYOA loopback guard 客户端
→ 缺少 WANTA_OO_GUARD_URL/TOKEN
→ managed OO execution boundary is unavailable
```

现在分为两个明确入口：

```text
wanta-opencode-oo-guard.js → 内置 OpenCode
wanta-oo-guard.js          → BYOA
```

内置 guard 使用 `WANTA_REAL_OO_BIN` 和当前 OpenCode team scope；BYOA guard 继续使用 Electron main 的 authenticated loopback boundary。两个入口不再共享不兼容的环境协议。

### 2.2 OO 自动放行：完成

共享 Wanta local-access policy 已移除 `managedOoCommandRequiresConfirmation`。以下已启用托管 OO 操作在默认权限模式中统一返回：

```ts
{
  type: "allow",
  reason: "oo_cli",
  kind: "command",
  highRisk: false,
}
```

自动放行包括：

- capability search；
- Connector search/schema/apps/run；
- file upload/download；
- 已启用的 Flow read/edit/apply；
- Flow run/publish；
- 通过 Connector action 运行的异步 AI submit/result/poll。

同一策略用于内置 OpenCode、Claude 风格 native permission 和 ACP/BYOA raw permission，不为外部 Agent增加第二次批准。

### 2.3 真实 Bun 启动前缀：完成

事故截图中的实际调用包含：

```bash
BUN_BE_BUN=1 oo file upload ...
```

严格分类器现在只额外接受固定的 `BUN_BE_BUN=1` marker。以下仍不被托管 OO 自动放行：

```bash
PATH=/tmp oo ...
BUN_BE_BUN=0 oo ...
OO_ENDPOINT=... oo ...
OO_API_KEY=... oo ...
```

并已验证安全 marker 不能绕过 `oo auth`、`oo config`、`oo connector logout` 等 hard deny。

### 2.4 自动放行与安全校验分层：完成

产品语义现在是：

> 合法托管 OO 直接执行；非法或未开放 OO 直接拒绝；都不弹用户批准。

仍然拒绝：

- auth/login/logout/config；
- endpoint、connector token、connector URL、config/data directory override；
- capability contract 为 denied/planned 的 operation；
- BYOA 上传 managed roots 之外的文件；
- 非普通文件或超限文件；
- localhost、私网、链路本地、特殊用途或含 credential 的下载 URL；
- managed roots 之外的下载目录；
- 缺失明确 project 的 Project-scoped Flow；
- 未开放的 project switch、delete、rollback、cancel、open/workbench；
- 借 OO 拼接任意 shell、命令替换、环境篡改或高风险资源读取；
- 无法唯一解析的 runtime/workspace。

这些失败不能通过用户点击“批准”改变，因此由 guard 直接返回错误。

### 2.5 图片编辑完整回归：完成

新增内置 OpenCode fake OOCLI 集成回归，完整执行：

```text
oo file upload
→ 获得实时签名 downloadUrl
→ oo connector run ... submit
→ oo connector run ... result
→ oo file download
```

回归断言：

- upload 返回的签名 URL 对当前 Agent 可用；
- submit/result 均绑定当前 team；
- 结果进入 managed OO download；
- 整条 trace 不包含 curl、wget 或 base64 fallback。

### 2.6 签名 URL 实时可用与持久化脱敏：完成

外部 BYOA guard 已有以下行为：

- `file.upload` 实时结果向当前 Agent 保留 `downloadUrl`；
- UI/transcript 翻译层仍脱敏；
- Connector credential-shaped 字段继续脱敏。

本次补齐内置 OpenCode：

- 当前 turn 中的 raw upload output 先供模型完成后续 submit；
- `session.idle` 后扫描本 session 的 Connector 和 `oo file upload` tool parts；
- 使用 OpenCode `part.update` 将签名 URL 和 credential-shaped 字段替换为脱敏值；
- 启动时增加 v2 历史 sweep，处理旧 session 中遗留的 signed upload URL；
- UI 和历史读取本身继续通过 translator 脱敏。

这避免了“提前脱敏导致任务无法继续”和“长期保存签名 URL”两个相反问题。

### 2.7 Skill 与失败恢复策略：完成

Wanta 当前轮 Skill execution policy 现在明确：

- enabled managed OO operation 不需要额外用户确认；
- 用户请求本身提供业务授权范围；
- managed OO policy 或 infrastructure failure 是当前路径的终止错误；
- 不允许绕到 curl、wget、本机原生 OO、直连 provider API；
- 不允许把 base64 当成 transport 故障恢复，除非 inspected action schema 本身要求 base64。

### 2.8 文档一致性：完成

已更新：

- `docs/ai/oo-parity-auto-allow-solution.md`；
- `docs/ai/oo-first-class-optimization-report.md`；
- `docs/ai/agent-adapter.md`；
- `docs/ai/host-capabilities.md`；
- `docs/ai/byoa-follow-up-handoff.md`。

旧的“file upload、Flow run/publish 进入 consequential confirmation”已改为自动放行。

## 3. 验证结果

最终验证结果：

- 定向 OpenCode/BYOA/OO/图片链路测试：通过；
- TypeScript：通过；
- oxlint：通过；
- 全量 test files：368 passed，2 skipped；
- 全量 tests：2948 passed，4 skipped；
- OO bundle lock：通过；
- OOCLI：`1.7.12/universal`；
- 生产构建：通过；
- `dist-electron/wanta-opencode-oo-guard.js`：已生成；
- `dist-electron/wanta-oo-guard.js`：已生成；
- `git diff --check`：通过。

OO bundle 确认以下为 enabled：

- `connector.run`；
- `file.upload`；
- `file.download`；
- `flow.apply`；
- `flow.run`；
- `flow.publish`。

以下继续保持 denied/planned，不会变成审批：

- `auth`: denied；
- `skills.manage`: denied；
- `skills.recommend`: denied；
- `connector.proxy`: planned；
- `llm`: planned；
- `team.current`: planned；
- `variables`: planned。

## 4. 未实施但不属于当前有效缺口

以下内容来自长期架构讨论，但当前没有必要实施：

- 完整统一的 `OoCapabilityRuntime`；
- 新的 per-turn lease 系统；
- 强制 OpenCode 与 BYOA 使用相同 wire protocol；
- 为所有 OO operation 新建 orchestration framework；
- 重写已经稳定的 OpenCode Host Invoke Link 工具。

只有再次出现 operation contract 漂移、第三种 OO transport、多 team 并发身份冲突或新的输出语义不一致时，才应逐步抽取这些能力。

## 5. 仍需发布前执行的操作性验收

代码与自动化改动已经完成。发布前仍建议执行两次真实 smoke，它们是运行环境验收，不是缺失实现：

1. 内置 Agent 使用真实图片执行一次编辑，确认无批准卡、无 boundary unavailable、无 curl/base64 绕路；
2. 选择一个 BYOA 执行同样流程，确认权限与结果一致。

真实图片模型调用会产生外部请求、时间和可能的费用，因此未在本次自动化验证中擅自执行。

## 6. 最终状态

前序分析中当前应实施的有效改动已经完成，没有需要继续补的代码项。当前工作树尚未提交；开发版仍可用于真实 smoke 验收。
