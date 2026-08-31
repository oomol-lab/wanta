# Wanta OO 一等公民能力优化报告

更新时间：2026-08-31（Asia/Shanghai）

> 2026-08-31 补充决策：已启用的 Wanta 托管 OO 上传、下载、查询和执行操作全部自动放行，不再触发用户批准。本文中把上传、Flow run/publish 描述为需要确认的旧策略已被 [OO 行为一致性与自动放行解决方案](oo-parity-auto-allow-solution.md) 取代；路径、workspace、凭证、命令准入和输出脱敏校验仍然保留。

## 1. 执行原则

本报告以两个不可妥协的产品原则为前提：

1. **OO 是 Wanta 的一等公民能力。** 无论调用来自内置 OpenCode、Claude Code、Codex、Grok、未来新增的 BYOA，还是 Skill、Connector、文件传输、Open Flow，用户都应获得一致、可靠、可解释的 OO 能力，不应感知某个 Agent 的适配差异。
2. **OpenCode 内置实现是兼容性基线。** 新增或调整 BYOA 路径时，优先复用 OpenCode 已验证的能力语义、权限体验、工作区绑定、错误结构、授权提示和工具展示。只有 Agent 协议确实不支持时才允许改变传输方式；传输差异不得改变业务结果。

这意味着优化目标不是“分别把 OpenCode 和 BYOA 修到能用”，而是把 OO 建设为一套 Wanta Host 拥有的统一产品能力，再为不同 Agent 提供薄传输适配。

## 2. 结论摘要

当前实现已经具备不少正确基础：

- OpenCode 的 Link 工具优先走 Electron 主进程内的 `HostCapabilityKernel`；
- Wanta 已经拥有 Link workspace、凭证、授权信号、审计、脱敏和工具 UI；
- 外部 Agent 已有受控 OOCLI、操作白名单、文件根目录检查和 Flow 约束；
- `oo` Skill、OOCLI 版本和能力契约已有 bundle lock 与完整性校验；
- 同一条 Link action 已能在不同传输上归一为一致的工具记录。

但当前架构仍把 OO 分成了两套执行体系：

- OpenCode：Host Invoke 为主要路径，进程内 OOCLI guard 为兼容路径；
- BYOA：共享 loopback guard + 外部 CLI shim 为主要路径。

两套体系分别维护入口、环境变量、scope 解析、进程执行和输出处理，已经导致过一次实际回归：外部 Agent 的 loopback 客户端替换了 OpenCode 的进程内 guard，而 OpenCode 没有外部 guard descriptor，最终报出 `managed OO execution boundary is unavailable`。这类问题不能靠增加更多分支长期解决。

**目标架构应收敛为：一个 Host-owned OO Runtime、一个能力契约、一个精确的每轮 lease、统一的输出双视图和多种薄传输。** OpenCode 与 BYOA 只在“如何到达 Host”上不同，不再拥有不同的 OO 业务实现。

## 3. OpenCode 内置路径提供的基准

OpenCode 当前最值得作为基线复用的不是某个具体函数，而是以下完整行为：

### 3.1 Host 优先，CLI 只做兼容

OpenCode 的 `search_actions`、`list_apps`、`inspect_action`、`call_action` 会先调用 Host Capability；只有 Host transport 不可达时，才回退到受控 OOCLI。Host 路径负责绑定当前 session、team 和 Link runtime，并把结果转换成稳定的工具输出。

目标状态下，所有 Agent 都应遵循同一原则：

- 业务执行始终进入 Wanta Host 的 OO Runtime；
- CLI 只是 Agent 熟悉的调用外形，不是另一套业务后端；
- 不允许因为一种 transport 失败就绕到 curl、直连 API、本机另一个 `oo` 或错误的 workspace。

### 3.2 精确 session 身份，而不是推测身份

OpenCode Host Invoke 请求携带明确的 `sessionId`，Host 直接读取该 session 的能力上下文。身份解析不依赖当前目录，也不要求“所有活跃任务碰巧属于同一个团队”。

BYOA 应达到同样水平。当前通过 cwd 与所有活跃 external turn 推导 scope 的方式可以作为过渡保护，但不应成为最终身份模型。

### 3.3 Wanta 拥有凭证和授权体验

OpenCode Host 路径不会让模型决定账号、endpoint 或 provider credential。Host 绑定当前 Link runtime，校验显式 `connectionName`，把授权问题转换成结构化 `authorization_required`，再由 Wanta 显示连接入口。

BYOA 不应获得更弱的体验，也不应因为使用 CLI 就暴露、复制或重新登录 Wanta 的 OO 凭证。

### 3.4 稳定的错误与重试语义

OpenCode 已有以下值得统一的行为：

- inspect-before-call；
- 同一 connection/action 的短期阻断缓存；
- 授权失败后不重复轰炸 Connector；
- 并发 action 限制；
- 明确区分授权、策略拒绝、workspace 缺失、普通运行错误；
- 失败时不静默切换账号或 workspace。

这些应成为 OO Runtime 的公共能力，而不是继续留在 OpenCode 生成工具的内嵌 JavaScript 中。

### 3.5 OpenCode 是权限体验下限

同一个已启用的托管 OO 操作，无论是只读、上传、下载、执行还是发布，OpenCode 与 BYOA 都应自动放行，不增加重复确认。Agent 自身的 sandbox 可以额外拒绝，但不应制造第二套相互矛盾的 Wanta 权限体验；未开放或非法调用由托管边界直接拒绝。

## 4. 当前主要问题

### P0：两套 guard 具有结构性漂移风险

现状中，OpenCode guard 与 external guard 的启动协议不同：

- OpenCode guard 依赖 `WANTA_REAL_OO_BIN` 和 team scope 文件；
- external guard 依赖 `WANTA_OO_GUARD_URL` 和 `WANTA_OO_GUARD_TOKEN`；
- 两者都以 `oo` shim 的形式出现在 Agent PATH 中；
- 两者的文件命名和调用位置曾发生混用。

已完成的拆分修复可以立即消除当前故障，但它属于止血措施，不是最终架构。继续长期维护两套业务 guard，会在命令准入、文件规则、脱敏、取消、超时和 OOCLI 升级时再次产生差异。

### P0：BYOA 的 workspace 身份仍可能依赖全局一致性

外部 Agent 的 CLI 调用没有天然携带 Wanta session id。当前 Host 会根据 cwd 匹配任务根目录；无法唯一匹配时，要求所有活跃 external turn 的 runtime/team 一致。这能避免错账号，但会把合法的并发多团队任务变成不可用状态。

OO 作为一等公民能力，必须同时满足：

- 绝不串 workspace；
- 多 workspace 并发仍可用；
- 不依赖模型手写 `--team`；
- 不用 cwd 猜测身份作为主路径。

### P0：输出没有完整建模“实时值”和“可持久化值”

`oo file upload` 返回的临时签名 `downloadUrl` 是下一步远端 action 必须使用的实时能力值，但不应该显示到 UI、日志或长期 transcript。当前部分外部 guard 已特殊保留实时 URL，同时对其他敏感字段脱敏；但该语义还没有成为统一的 Host 输出契约。

如果只做统一脱敏，Agent 拿不到下一步所需 URL；如果完全不脱敏，敏感签名 URL 会进入历史。正确做法不是在不同路径上打例外，而是明确输出双视图。

### P0：基础设施错误会诱发模型绕路

当托管 OO 边界不可用时，模型可能尝试：

- 改走另一个 Link transport；
- 用 curl 直传；
- 猜测预签名 URL；
- 把文件转换成 base64；
- 调用未验证的替代 action。

这会把一个应在秒级暴露的基础设施故障扩大成十几分钟的试错。OO transport 错误应被标记为终止型基础设施错误，由 Host 或 adapter 做一次受控重试；模型不应把它理解为“换一种上传技巧即可解决”。

### P1：公共行为仍散落在 OpenCode 内嵌工具和 external guard

以下能力目前存在重复或分散：

- action schema 查询与执行；
- workspace 绑定；
- connectionName 校验；
- 授权错误解析；
- 并发限制与短期阻断；
- OO command operation 识别；
- 输出脱敏；
- timeout、取消和进程回收；
- UI 工具名称归一化。

只要这些逻辑没有下沉到统一 Host Runtime，就无法证明所有 Agent 的 OO 行为持续一致。

## 5. 目标架构

### 5.1 单一 Host-owned OO Runtime

在 Electron 主进程建立 `OoCapabilityRuntime`，作为所有 OO 命令的唯一业务执行者。它负责：

- OOCLI 版本与 Skill bundle 完整性检查；
- operation contract 解析；
- runtime、team、project、artifact/process roots 绑定；
- Connector account 与 `connectionName` 校验；
- 托管 OO 自动放行与非法操作直接拒绝的权限判定；
- 真实 OOCLI 进程启动、取消和输出限制；
- 实时输出、展示输出和持久化输出的生成；
- 结构化错误、授权信号和审计事件；
- UI 所需的标准 operation metadata。

真实 OO 二进制路径、OOMOL session token、OpenConnector token、endpoint 和 store 目录只存在于 Host Runtime，不再由任何 Agent 直接持有。

### 5.2 单一 OO 能力契约

把当前 `EXTERNAL_OO_OPERATIONS` 升级为 Agent-independent `OO_OPERATIONS`。每项至少声明：

| 字段               | 含义                                                            |
| ------------------ | --------------------------------------------------------------- |
| `id`               | 稳定 operation id，例如 `file.upload`                           |
| `command`          | OOCLI 命令前缀                                                  |
| `availability`     | enabled / planned / denied                                      |
| `effect`           | read / local-read / local-write / external-action / local-state |
| `workspace`        | none / optional / required                                      |
| `inputPolicy`      | 路径、URL、stdin、`@file` 和大小限制                            |
| `timeoutPolicy`    | discovery、action、异步查询、Flow 的不同 deadline               |
| `outputPolicy`     | 哪些字段可实时返回、可展示、可持久化                            |
| `permissionPolicy` | 已启用托管 OO 自动放行；非法或未开放操作直接拒绝                |
| `uiMetadata`       | 工具名称、详情、安全展示信息                                    |

OpenCode、BYOA guard、Skill guidance、权限分类器、工具展示、bundle lock 和测试全部从该契约派生，禁止维护平行清单。

### 5.3 每轮 opaque OO lease

每个 Wanta turn 由 Host 发行一个短生命周期、不可推导业务凭证的 `OoCapabilityLease`：

- 绑定 session id、turn id、Link runtime、team、project 和 managed roots；
- 任务结束、取消、账号切换、team 切换或应用退出时立即撤销；
- lease 不能修改自己的 workspace；
- lease token 只允许连接本机 loopback Host，不是 OOMOL credential；
- 每个 Agent 的 `oo` shim 自动携带该 lease；模型无需、也不能指定它。

这样可以同时支持多个 Agent、多个团队、多个项目并发，不再依赖 cwd 或“所有 external turn 一致”。cwd 只用于解析相对文件，不再用于决定身份。

### 5.4 多传输、同执行

目标数据流如下：

```text
OpenCode native tool ── host invoke ──┐
OpenCode Skill/raw oo ─ local shim ───┤
Claude/Codex/Grok ─ managed oo shim ──┼─> OoCapabilityRuntime ─> bundled OOCLI
未来 Agent/MCP transport ─────────────┘
```

所有 transport 只完成：

- 认证本地调用方；
- 关联当前 lease；
- 传递 argv、cwd、取消信号；
- 返回 Runtime 已产生的标准结果。

transport 不再自行绑定 team、解析业务错误、决定脱敏字段或维护 operation 白名单。

### 5.5 输出双视图

统一结果模型至少包含：

```ts
interface OoExecutionResult {
  exitCode: number
  liveOutput: string
  displayOutput: string
  persistedOutput: string
  operation: OoOperationMetadata
  authorization?: AuthorizationSignal
  error?: OoStructuredError
}
```

- `liveOutput`：只返回给当前运行中的 Agent，用于后续步骤；可包含短期签名 URL。
- `displayOutput`：进入 Wanta 工具卡片；敏感字段脱敏，只显示文件名、大小、过期时间等安全信息。
- `persistedOutput`：进入 transcript、diagnostics 和恢复历史；默认与 display 一样或更严格。

任何 transport 都不得自行决定是否保留 `downloadUrl`。

### 5.6 结构化错误与固定恢复策略

统一错误类型：

| 类别                       | 示例                          | 恢复策略                                       |
| -------------------------- | ----------------------------- | ---------------------------------------------- |
| `transport_unavailable`    | loopback/lease 不可达         | adapter 或 Host 原通道重试一次；禁止模型换通道 |
| `runtime_integrity_failed` | OOCLI/Skill lock 不匹配       | fail closed，提示升级或重新安装                |
| `workspace_unavailable`    | turn 未绑定 team              | 阻止执行；不猜 team、不切账号                  |
| `authorization_required`   | Connector 未连接或 scope 失效 | 显示 Wanta 授权入口，停止当前外部步骤          |
| `policy_denied`            | operation 或 action 被禁止    | 不重试、不找非托管替代路径                     |
| `input_shape_unsupported`  | schema 不接受 URI/file        | 报告真实能力缺口                               |
| `remote_action_failed`     | provider/action 运行失败      | 按 operation 的幂等性与错误码决定是否重试      |
| `cancelled`                | 用户取消或任务结束            | 终止真实 OOCLI 子进程并清理 lease              |

Skill 和系统提示应明确：托管 OO 基础设施错误不是“请尝试 curl/base64”的信号。

## 6. 图片编辑专项优化

图片编辑应有一条稳定、可测量的标准路径：

1. 加载图片 Skill；
2. 一次 inspect 同时获取 async submit/result 两个 action contract；
3. `oo file upload` 上传本地图片；
4. Agent 从 `liveOutput` 获得临时 `downloadUrl`；UI 和 transcript 只看到安全摘要；
5. 调用 async submit；
6. 根据 action 建议的间隔轮询 result，避免固定盲等；
7. 将明确的结果 artifact URL 交给受控 `oo file download`；
8. 在 Wanta artifact root 发布最终图片。

以下行为应禁止作为基础设施故障的自动替代方案：

- curl/wget/自写 HTTP 上传；
- 从脱敏文本猜测签名 URL；
- 将私有上传端点当成公开下载地址；
- 为绕过 guard 临时转 JPEG 或 base64；
- 未 inspect 就改调另一个 action；
- 在一个 transport 失败后静默切换本机原生 `oo`。

只有 action schema 明确接受 base64，并且这是能力本身的正常输入方式时，才允许使用 base64；它不应成为 Wanta transport 失败的恢复策略。

## 7. 实施计划

### P0：立即可靠性，1 个小版本

1. 保留当前 OpenCode/external guard 拆分止血修复，确保已发布版本不再触发边界缺失。
2. 增加启动自检：
   - OpenCode shim 必须能完成一个无外部副作用的 OO capability probe；
   - external shim 必须能用临时 lease 完成同一 probe；
   - probe 失败时不允许开始需要 OO 的 turn，并输出结构化错误。
3. 在模型可见错误中加入稳定 error code，阻止自由文本被理解为可绕过的安全限制。
4. 为图片编辑增加端到端回归：本地图片 → upload → submit → result → download，全程使用 fake OOCLI，断言没有 curl/base64 fallback。
5. 记录分阶段耗时：skill、schema、upload、submit、poll、download、publish。

### P1：统一 Runtime，1–2 个版本

1. 将 external guard server 的执行逻辑抽取为 `OoCapabilityRuntime`。
2. 将 `EXTERNAL_OO_OPERATIONS` 重命名并升级为共享契约。
3. OpenCode Host Invoke 和两个 CLI shim 全部调用同一个 Runtime。
4. 将 connection/action 并发协调、授权阻断缓存和错误归一从 OpenCode 内嵌工具下沉到 Runtime。
5. 引入 `live/display/persisted` 输出三态，移除 transport 层的特殊脱敏分支。
6. 真实 OO credential 只保留在 Electron main；OpenCode sidecar 也改用 opaque Host lease。

### P2：精确 turn lease 与并发，1 个版本

1. 每轮发行独立 OO lease，替换 external “所有活跃 turn 必须同 team”的主路径。
2. 支持同一 Wanta 实例中多个 Agent、多个 team 和多个 project 并发。
3. cwd 只处理相对路径；身份完全由 lease 决定。
4. 对账号切换、team 切换、取消、删除任务和应用退出做 lease 撤销测试。

### P3：一等公民体验与可观测性

1. 所有 OO operation 使用统一工具 UI，不暴露 ACP、MCP、shim、loopback 等基础设施名称。
2. 授权、上传、下载、Flow run/publish 使用同一权限词汇和 CTA。
3. 增加 OO 健康面板或诊断摘要：版本、contract 版本、Skill lock、runtime 状态，不显示凭证和私人路径。
4. 建立发布前真实 smoke：OpenCode、Claude Code、Codex、Grok 执行同一套 OO 用例。

## 8. 验证矩阵

每个 Agent 都必须通过同一份参数化测试矩阵：

| 场景                    | OpenCode | Claude | Codex | Grok | 预期                         |
| ----------------------- | -------: | -----: | ----: | ---: | ---------------------------- |
| capability search       |     必测 |   必测 |  必测 | 必测 | 同一结果语义                 |
| connector schema        |     必测 |   必测 |  必测 | 必测 | 不绑定错误 team              |
| connector read action   |     必测 |   必测 |  必测 | 必测 | 同一 workspace、同一输出     |
| authorization required  |     必测 |   必测 |  必测 | 必测 | 同一 CTA、无重复请求         |
| explicit connectionName |     必测 |   必测 |  必测 | 必测 | 严格校验，不静默换账号       |
| file upload             |     必测 |   必测 |  必测 | 必测 | Agent 可用 URL，UI/历史脱敏  |
| file download           |     必测 |   必测 |  必测 | 必测 | 只写 managed roots           |
| Flow read/run/publish   |     必测 |   必测 |  必测 | 必测 | 同一项目且均自动放行         |
| 多 team 并发            |     必测 |   必测 |  必测 | 必测 | 不串 workspace，也不互相阻塞 |
| transport 中断          |     必测 |   必测 |  必测 | 必测 | 原通道一次重试，不绕路       |
| task cancel/delete      |     必测 |   必测 |  必测 | 必测 | OOCLI 子进程终止、lease 撤销 |
| history restore         |     必测 |   必测 |  必测 | 必测 | 无签名 URL/凭证泄漏          |

测试层级：

1. 契约单元测试：所有 operation、effect、workspace、输出策略；
2. Runtime 测试：fake OOCLI，覆盖 argv、env、cwd、取消、超时、脱敏；
3. transport parity：同一 fixture 经 OpenCode host invoke 与各 BYOA shim 执行，比较标准结果；
4. Wanta UI 测试：工具名称、授权提示、过程/最终结果归组；
5. 真实环境 smoke：使用已登录 Wanta workspace 执行非破坏性 action、文件传输和图片编辑。

## 9. 成功指标

上线后至少持续监控：

- `managed_oo_boundary_unavailable`：目标为 0；
- OO transport 故障后 curl/base64/本机 `oo` fallback：目标为 0；
- workspace 错绑或静默切换：目标为 0；
- 已启用 OO 操作在任一 Agent 上出现批准卡：目标为 0；
- `file.upload` 的 live URL 可用率：目标接近 100%；
- 签名 URL 或凭证进入 UI、diagnostics、transcript：目标为 0；
- 128–1024 px 单图编辑端到端 P50：目标小于 90 秒；
- 同类单图编辑端到端 P95：目标小于 180 秒；
- 图片模型实际生成以外的前置工具耗时 P95：目标小于 20 秒；
- OO 基础设施错误被首次识别的时间：目标小于 2 秒。

## 10. 决策建议

建议立即确认以下架构决策：

1. `OoCapabilityRuntime` 是 Wanta 中所有 OO 执行的唯一业务边界；
2. OpenCode 当前 Host Invoke 行为是其他 Agent 的兼容性基线；
3. CLI 是 transport，不是第二套 OO backend；
4. 所有 Agent 使用精确 turn lease，不用 cwd 或全局 team 一致性推导身份；
5. OO 输出原生支持 live/display/persisted 多视图；
6. OO transport 错误禁止触发非托管绕路；
7. 每次 OOCLI 或 Skill bundle 升级必须跑跨 Agent parity suite 和真实图片编辑 smoke。

当前拆分 OpenCode 与 external guard 的修复应尽快发布用于止血；随后按 P1 收敛到统一 Runtime。这样既不会为了长期重构延迟当前故障修复，也不会把两套 guard 固化成未来架构。
