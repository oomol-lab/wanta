# Wanta OO 行为一致性与自动放行解决方案

更新时间：2026-08-31（Asia/Shanghai）

## 1. 已确认的产品决策

本方案以以下产品决策为最终依据：

1. **内置 OpenCode 与 BYOA 的 OO 行为尽量一致。** Agent 协议可以不同，但同一个 OO 操作的可用性、workspace、账号、输入输出、错误、工具展示和权限结果必须一致。
2. **OO 是 Wanta 的一等公民和可信工作通道。** 凡是进入 Wanta 托管 OO 边界、且在当前能力契约中已启用的上传、下载、查询、Connector action、异步任务和 Flow 操作，全部自动放行，不再要求用户批准。
3. **自动放行不等于取消边界校验。** Wanta 仍然负责防止串 workspace、伪造 credential、路径逃逸、写入非托管目录、访问本地/私网下载目标、运行未开放的管理命令以及把敏感输出写入 UI 或历史。这些情况直接返回结构化错误，不弹“是否批准”。
4. **OpenCode 内置行为是兼容性基线。** BYOA 不得因为 ACP/native shell 的额外 permission request 给用户增加第二次批准，也不能因 transport 差异降低 OO 的可用性。

一句话定义：

> **合法的托管 OO 操作直接执行；不合法或未开放的 OO 操作直接拒绝；两种情况都不让用户处理基础设施审批。**

## 2. 本次问题的准确归因

15 分钟图片编辑发生在内置 Agent，而不是 BYOA：

```text
内置 Agent / OpenCode
→ 加载图片编辑 Skill
→ bash 调用 oo
→ 错误命中 BYOA loopback guard 客户端
→ 内置 Agent 没有 WANTA_OO_GUARD_URL/TOKEN
→ managed OO execution boundary is unavailable
→ 模型尝试 Link、curl、预签名上传、base64 等绕路
→ 图片生成本身约 1 分钟，总流程约 15 分钟
```

根因是 BYOA 改造复用了内置 OpenCode 原有的 guard 入口，但两种入口需要完全不同的启动上下文。当前工作区已经用独立的 `wanta-opencode-oo-guard` 恢复内置路径，BYOA 保留 `wanta-oo-guard`。这是应立即发布的修复。

同时，当前权限代码确实把以下操作标成 high-risk 并弹批准：

- `oo file upload`；
- `oo flow run`；
- `oo flow publish`；
- 部分其他 Flow consequential operation。

这与最新产品决策冲突，必须修改。

## 3. “OO 一律放行”的精确定义

### 3.1 自动放行范围

以下条件同时满足时，Wanta 必须直接执行，不显示批准卡：

1. 命令使用 Wanta 注入的 `oo` 或 `WANTA_OO_BIN`；
2. 命令能被严格识别为一个纯 OO 调用，或只带已认可的安全输出后缀；
3. operation 在共享 OO capability contract 中为 `enabled`；
4. 调用通过当前 Wanta session/turn 的托管 runtime；
5. 参数通过 operation 对应的 workspace、路径、URL、文件和 project 校验。

自动放行包括但不限于：

| 域                  | 操作示例                                                     | 权限结果 |
| ------------------- | ------------------------------------------------------------ | -------- |
| Capability          | `oo search`                                                  | 自动放行 |
| Connector discovery | `oo connector search/schema/apps`                            | 自动放行 |
| Connector execution | `oo connector run`                                           | 自动放行 |
| File                | `oo file upload`                                             | 自动放行 |
| File                | `oo file download`                                           | 自动放行 |
| Flow read           | list/show/inspect/check                                      | 自动放行 |
| Flow edit           | create/apply/rename/node/code/connector/trigger 等已启用命令 | 自动放行 |
| Flow execute        | `oo flow run`                                                | 自动放行 |
| Flow publish        | `oo flow publish`                                            | 自动放行 |
| Async AI            | submit/result/poll action                                    | 自动放行 |

用户表达任务本身就是授权，例如“编辑这张图片”“发布这个 Flow”“把结果上传并执行”。Wanta 不应再就底层 OO 上传或执行重复询问。

### 3.2 仍然直接拒绝的情况

以下不是“需要用户批准”，而是托管 OO 边界不接受：

- `oo auth/login/logout/config` 等可能改变 Wanta 托管身份或 runtime 的命令；
- 覆盖 `--endpoint`、`--connector-token`、`--connector-url`、`--config-dir`、`--data-dir`；
- 当前 capability contract 为 `denied` 或尚未实现的 operation；
- 上传文件不在当前 turn 的 managed roots；
- 上传对象不是普通文件或超过限制；
- 下载目标是 localhost、私网、链路本地、特殊用途地址或含 URL credential；
- 下载目录位于 managed roots 之外；
- Flow 缺少明确 project，或包含未开放的 project switch、delete、rollback、cancel、open/workbench；
- shell 在 OO 调用旁拼接额外高风险命令、命令替换、任意重定向或环境覆盖；
- workspace、runtime 或 turn 身份无法唯一确定。

这些行为返回稳定的 `policy_denied`、`workspace_unavailable`、`invalid_input` 或 `unsupported_operation`，不弹批准，因为用户无法通过“批准”把一个不安全或不受支持的调用变成合法调用。

### 3.3 纯 OO 与混合 shell 的边界

“OO 一律放行”只覆盖托管 OO 本身，不把与 OO 拼接的任意 shell 一并白名单化。

自动放行：

```bash
oo file upload "/managed/input.png" --json
oo flow publish demo --project project-a --json
oo connector run fusion-api --action submit --data @payload.json --json
oo connector schema fusion-api.submit 2>&1 | head -100
```

不按 OO 自动放行：

```bash
oo search image && rm -rf /somewhere
oo connector run service --data "$(cat ~/.ssh/id_rsa)"
PATH=/tmp oo file upload input.png
sudo oo flow publish demo
```

后者进入普通 shell policy 或直接拒绝，避免 `oo` 关键字成为任意命令的通行证。

## 4. 立即解决方案

### 4.1 修复内置 OpenCode guard 装配

保留当前已经完成的止血修改：

- `wanta-opencode-oo-guard.js`：内置 OpenCode 兼容路径；
- `wanta-oo-guard.js`：BYOA loopback 路径；
- 两个文件不再共享不兼容的环境变量契约；
- 构建必须同时产出两个 entry；
- 启动和回归测试分别验证两条路径。

这一步修复当前线上事故，不等待后续优化。

### 4.2 移除 OO 上传和执行的批准

权限修复集中在共享 Wanta local-access policy，不为每个 Agent 单独加例外。

具体修改：

1. 从 `isHighRiskPermissionRequest` 中移除 `managedOoCommandRequiresConfirmation`；
2. 删除或废弃 `managedOoCommandRequiresConfirmation`，避免未来重新把上传、Flow run/publish标成 prompt；
3. 继续先执行 `openConnectorCommandPolicy` 的 hard deny，拦截 auth/config/credential override；
4. 对严格识别的托管 OO 调用，统一返回：

   ```ts
   { type: "allow", reason: "oo_cli", kind: "command", highRisk: false }
   ```

5. OpenCode 的 bash permission 保留 `oo` 快速 allow；
6. BYOA native permission request 进入同一个 Wanta policy 后自动回答 allow；
7. external guard 不再产生第二层 consequential confirmation；
8. 上传、下载和 Flow 的安全校验继续在 guard 内执行。

重要顺序：

```text
识别托管 OO
→ 检查 forbidden mutation/runtime override
→ 检查是否为纯 OO invocation
→ Wanta permission 自动 allow
→ guard 检查 operation/workspace/path/url/project
→ 执行或结构化拒绝
```

### 4.3 更新 Skill 和系统提示

当前 external OO policy 中仍写着：

- file upload 需要 host confirmation；
- Flow run/publish 需要 host confirmation。

需要改为：

- 所有 enabled managed OO operation 自动放行；
- Agent 不得预先询问用户批准底层 upload/download/run/publish；
- 用户的任务指令已经提供业务授权；
- guard 拒绝时报告结构化 blocker，不改走 curl、本机原生 `oo`、直连 API 或 base64 绕过；
- 只有业务目标本身缺少必要信息时才提问，例如用户没有指定要发布哪个 Flow，而不是询问“是否允许执行 oo flow publish”。

### 4.4 修正测试

必须修改现有明确期待 prompt 的测试：

```text
managed file upload and consequential Flow boundaries prompt in default mode
```

替换为参数化 parity 测试，验证在 OpenCode 和 external session 下均自动放行：

- file upload；
- file download；
- connector run；
- Flow run；
- Flow publish；
- Flow apply/edit；
- safe output filter；
- shell wrapper 中的纯 OO 调用。

同时保留拒绝测试：

- auth/login/logout/config；
- endpoint/token override；
- 路径逃逸；
- unmanaged upload；
- private-network download；
- 混合高风险 shell；
- 不明确 workspace；
- 未开放 operation。

## 5. OpenCode 与 BYOA 一致性方案

### 5.1 一致的是产品语义，不强求相同传输

短期内不做大一统重构：

- OpenCode 继续以 Host Invoke 为 Link 主路径，受控 OOCLI 为 Skill/兼容路径；
- BYOA 继续使用 managed OOCLI loopback；
- 两者共享 Wanta local-access policy、operation contract、workspace 语义、错误和 UI metadata；
- 不要求 OpenCode 和 ACP 使用同一种协议。

这样遵循 OpenCode 基线，也避免为了形式统一进行过度设计。

### 5.2 最小共享面

当前只强制共享五项：

1. operation 是否 enabled；
2. permission decision；
3. workspace/runtime 绑定结果；
4. error code 与 authorization signal；
5. display/persistence 脱敏规则。

只有当同一逻辑已经在两条路径发生实际漂移时，才继续抽取执行 Runtime。

### 5.3 Parity fixture

建立一个小型 fake OOCLI parity fixture，用同一组输入分别经过：

- OpenCode guard；
- BYOA guard；
- OpenCode Host Link action（适用时）。

比较：

- operation id；
- 最终 argv 语义；
- team/workspace；
- allow/deny，不允许出现 prompt；
- live output；
- UI/persisted redaction；
- error code；
- 取消和退出状态。

测试只比较产品语义，不要求内部事件字节级相同。

## 6. 图片编辑专项路径

内置 Agent 与 BYOA 都应执行同一条业务流程：

```text
加载图片 Skill
→ inspect submit/result contracts
→ oo file upload（自动放行）
→ 获得实时 downloadUrl
→ submit（自动放行）
→ poll result（自动放行）
→ oo file download（自动放行）
→ 发布 Wanta artifact
```

验收要求：

- 不出现任何 OO 批准卡；
- 不出现 `managed OO execution boundary is unavailable`；
- 不调用 curl/wget；
- 不因 transport 故障改走 base64；
- 不要求用户确认上传；
- Agent 实时获得可用的临时 URL；
- UI、日志和历史不保留完整签名 URL；
- 图片模型之外的前置处理目标小于 20 秒；
- 单图编辑正常目标为 1–2 分钟。

## 7. 克制的优化计划

### P0：本次必须完成

1. 发布内置 OpenCode guard 修复；
2. OO upload/download/execute/run/publish 全部移除批准；
3. 更新 permission、Skill policy 和相关文档；
4. 增加 OpenCode/BYOA permission parity 测试；
5. 增加内置 Agent 图片编辑完整回归；
6. 在真实开发版分别跑一次内置 Agent 和一个 BYOA smoke。

### P1：只有出现证据再做

1. 如果 operation 清单再次漂移，抽取共享 `OO_OPERATIONS`；
2. 如果签名 URL 在不同 transport 再次处理不一致，抽取统一 live/redacted result helper；
3. 如果多 team 并发真实失败，再引入精确 turn lease；
4. 如果第三种 OO transport 出现，再抽取完整 `OoCapabilityRuntime`。

### 当前明确不做

- 不一次性重写 OpenCode Link Host Invoke；
- 不立即建立庞大的 OO orchestration framework；
- 不为了代码形式一致强制所有 Agent 使用同一协议；
- 不新增用户能感知的 OO 设置或审批层；
- 不把所有普通 shell 因为包含 `oo` 字样而自动放行；
- 不取消 workspace、路径、URL、凭证和 operation 校验。

## 8. 验收矩阵

| 场景                         | 内置 OpenCode | BYOA | 预期                          |
| ---------------------------- | ------------: | ---: | ----------------------------- |
| `oo search`                  |          必测 | 必测 | 自动放行                      |
| connector schema/apps/run    |          必测 | 必测 | 自动放行、同一 workspace      |
| file upload                  |          必测 | 必测 | 自动放行，无批准卡            |
| file download                |          必测 | 必测 | 自动放行，只写 managed roots  |
| Flow edit/run/publish        |          必测 | 必测 | 自动放行，无批准卡            |
| auth/config/runtime override |          必测 | 必测 | 直接拒绝，不弹批准            |
| unmanaged upload path        |          必测 | 必测 | 直接拒绝                      |
| private-network download     |          必测 | 必测 | 直接拒绝                      |
| mixed dangerous shell        |          必测 | 必测 | 不按 OO 白名单放行            |
| authorization required       |          必测 | 必测 | 同一授权 CTA，不是 shell 批准 |
| 图片编辑完整链路             |          必测 | 必测 | 无绕路，1–2 分钟目标          |
| task cancel                  |          必测 | 必测 | OO 子进程终止                 |
| history restore              |          必测 | 必测 | 不含签名 URL/credential       |

## 9. 完成标准

本方案完成必须同时满足：

- 内置 Agent 不再引用 BYOA guard 客户端；
- 所有 enabled managed OO operation 在默认权限模式下返回 allow；
- OO 上传、下载、执行、Flow run/publish 不再显示批准卡；
- OpenCode 与 BYOA 对同一 OO operation 的 permission 结果一致；
- 未开放或非法 OO 调用直接结构化拒绝，不让用户批准；
- 图片编辑不再使用 curl/base64 作为 transport 故障恢复；
- 没有 workspace、credential、签名 URL 或私有路径泄漏；
- 相关 lint、format、type check、tests、build 和 OO bundle verification 全部通过；
- 内置 Agent 与 BYOA 的真实 smoke 均通过。

## 10. 最终建议

本轮不实施完整大一统 Runtime。先完成明确且低风险的两项产品修复：

1. 修复内置 OpenCode 的 OO 执行入口；
2. 将所有合法托管 OO 操作改为自动放行。

随后用最小 parity fixture 保证 OpenCode 与 BYOA 不再漂移。只有在出现新的真实重复问题时，才逐步抽取公共 Runtime。这样既兑现 OO 一等公民和跨 Agent 一致性，也避免过度设计。
