# Wanta Agent 回合中断分析报告

- 调查日期：2026-08-22（Asia/Shanghai）
- 代码基线：`8a53fc97`（`v0.1.164-2-g8a53fc97`）
- 范围：2026-08-11 引入 BYOA（Bring Your Own Agent Adapter）之后，到 2026-08-21 的 Agent、Link、权限和回合结束链路；同时抽查本机保存的 Codex / Claude Code 外部 Agent transcript 与诊断日志。
- 本报告先完成分析；随后已按本文 P0/P1 建议落地 ACP 回合终态保护、主进程到 UI 的结构化回合结果事件，以及脱敏的 turn-level diagnostics，实施详情见文末“本轮实施”。

## 结论先行

截图中的“先说要看 PostHog 连接器，随后无后续回复”高度符合一条已经被代码提交明确承认的故障链：**BYOA 之后的 Link 强制传输策略，把普通 `oo connector apps/run/proxy` 调用伪装成权限拒绝；Agent 在工具边界结束；聊天层又把“工具调用结束”误认为整轮回答已结束。**

因此，最主要的归因不是模型随机不说话，也不是单纯的渲染问题，而是 **BYOA + Link transport gate + 回合完成判定** 共同造成的回归。对应修复为 `0de0c0be`（2026-08-20，`fix: keep OO Connect agent turns running (#339)`）；当前代码基线已经包含该修复。

此前 ACP/Codex 外部 Agent 的 `prompt` promise 只要 resolve，适配器就无条件发出 `messageCompleted`，且 transcript 会把最新 assistant message 合成为 `finishReason: "stop"`。该高风险路径现已修复：工具未结束、工具 error 后无后续自然语言、或非 `end_turn` stop reason 都会进入明确错误，而不是完成。剩余风险集中在各原生 Agent 的终态元数据不统一，以及尚未补齐的 turn-level 持久化诊断。

## 证据与时间线

| 时间       | 改动                                                                         | 与中断的关系                                                                                                                                                                                                         |
| ---------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-11 | `9190b363`：BYOA：统一 Agent contract、Claude Code adapter、通用 ACP adapter | 新增外部 Agent 的事件翻译、transcript 和回合完成路径；这是风险面扩大的起点。                                                                                                                                         |
| 2026-08-15 | `394575b2`：Link host capabilities / 权限对齐                                | 引入 `wanta_link` MCP Host Capability，并让 Chat 层、权限层、外部 Agent 共用这一新路径。                                                                                                                             |
| 2026-08-18 | `5da6df0f`：恢复 OpenCode 权限基线                                           | 已经发现 BYOA 统一权限会让普通 `oo` 复合命令被额外拦截，说明权限归一化正在改变原本可工作的行为。                                                                                                                     |
| 2026-08-19 | `fc522597`：统一 Link 执行与恢复 UX                                          | 为强制使用结构化 Link 工具，加入 Link transport gate：有 Link runtime 时拒绝 raw `oo connector apps/run/proxy`。这是本问题的直接前置改动。                                                                           |
| 2026-08-20 | `0de0c0be`：保持 OO Connect Agent 回合继续运行                               | 提交说明明确记录：该 gate 会导致 synthetic permission rejection，OpenCode 会在工具边界停止，旧完成判定会把 `tool-calls` / `tool_use` 当终态，从用户角度像“突然断掉”。该提交移除了 gate，并排除工具型 finish reason。 |

`0de0c0be` 已是当前 `HEAD` 的祖先，因此：若用户运行的是 0.1.163 之前的已发布包，截图中的故障可以直接由该回归解释；若运行的是当前开发基线或已包含 0.1.163/0.1.164 的包，则需要优先排查下面“剩余风险”中的 ACP 完成语义与原生 Agent 退出。

## 本机 transcript 抽样结果

本机保存的外部 Agent transcript 不是全量遥测样本，不能用来推断线上发生率；但它给出了与截图同类任务的直接、可复现证据。

| Adapter      | 已完成用户回合 | 未完成用户回合 | 未完成率 | 观察                                                                                                                                      |
| ------------ | -------------: | -------------: | -------: | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Codex（ACP） |        18 / 22 |              4 |    18.2% | 3 个未完成样本在 2026-08-13，都停在 PostHog `call_action(list_projects)` 的 error 工具步骤；另 1 个样本已产生报告正文但没有记录完成事件。 |
| Claude Code  |          4 / 6 |              2 |    33.3% | 2026-08-13/14 的两个样本停在 `load_skill` 或 `Bash` 工具未完成，工具错误为“agent stopped before this tool call completed”。               |

三个 Codex 样本的最后工具均为：

```text
wanta_link.call_action(service=posthog, action=list_projects, params={limit:100})
status=error
```

随后 transcript 没有 final text、`completedAt` 或错误回合收口。这说明两件事：

1. 早期故障并不只是 UI 没有渲染 token；外部 Agent 确实在连接器工具出错后停止了。
2. 当时的记录没有保存该 host-tool error 的错误正文，事后无法判断是 workspace/授权/参数/ACP transport 哪一层失败。这是 observability 缺口。

截图的文字“我先看一下 PostHog 连接器里有哪…”正好是连接器发现/列表的首个工具步骤，和上述失败形态相符。由于截图没有会话 ID 或时间戳，不能把它与某一份 transcript 逐条等同；这里的结论是**高置信度链路匹配**，不是对单次截图的逐位归档证明。

## 故障链路

```text
用户请求 PostHog 分析
  -> Agent 先发现 connector / 列出项目
  -> BYOA/Link gate 拦截 raw oo connector 调用（旧版本）
  -> native permission protocol 得到 synthetic reject
  -> Agent 收到工具失败，可能在 tool boundary 结束，未产生 final text
  -> 旧 Chat 完成判定把 tool-calls/tool_use 或 completedAt 当作回合完成
  -> UI 切回 ready，用户只看见“我先看一下……”这段前言
```

该链路里有两个相互独立的 bug：

1. **错误地阻止了本应兼容的工具调用。**
   `fc522597` 用 transport gate 强迫 Agent 使用 `wanta_link`，却让已被基线策略认可的普通 OOCLI 命令变成拒绝。`0de0c0be` 已删除这一拒绝分支；当前的 `evaluateLocalAccessRequest()` 只保留“外部 Agent 调 Wanta host tool 时可自动许可”的放宽分支，随后回到 OpenCode 兼容的基线策略（`electron/chat/local-access-policy.ts:196`）。

2. **把“一个工具步骤结束”误判成“用户回合结束”。**
   旧逻辑只要看到 `finishReason` 或 `completedAt` 即返回完成。当前逻辑已在 `electron/chat/node.ts:1464` 排除规范化后的 `tool-calls` / `tool-use`，并在不足以确认最终答复时以指数退避重试；重试耗尽后会显式发出 `generationInterrupted` 和错误消息，而不是悄悄 ready。

## 修复前代码基线中的风险

> 本节记录的是 `10d0c026` 实施前、用于定位事故的代码与行为基线；它不是当前分支的状态描述。后文“本轮实施”记录了相应修复。为避免今后源码移动导致误导，本节不再引用当前文件行号。

### P0：ACP 完成事件没有表达“是否真正给出最终答复”

当时，`AcpAgentAdapter.trackTurn()` 在 ACP 的 `prompt` promise 正常 resolve 后，无条件发送 `messageCompleted`。它没有读取或映射 `PromptResponse.stopReason`，也没有验证这次回合是否包含 terminal assistant text / terminal native outcome。

与此同时，`ExternalTranscriptRecorder` 收到这个事件时，会把**最近一个 assistant message**直接补成：

```ts
completedAt = Date.now()
finishReason = "stop"
```

这会抹平“正常最终回答”“最后一步是工具调用”“Agent 在工具错误后错误 resolve”之间的差别；当时的 Chat 完成检查会把这样的 `stop` 放行。

这是修复前最可能继续制造“没有后续回答但界面已完成”的机制，特别影响 Codex/ACP，而不完全等同于 `0de0c0be` 已修复的 OpenCode `session.idle` 路径。

### P1：UI 的成功态过早且没有“无 final answer”保护

当时 renderer 收到 `messageCompleted` 后立即把 session 状态设为 `ready` 并 reload 历史。它不检查 reload 后本轮是否至少有一个用户可读的 final text，也不保留“工具失败后未收口”的状态。

因此，修复前后端即使有一个语义可疑的完成事件，UI 仍会把它表现成自然结束，正是截图最令人困惑的观感。

### P1：可观测性不能还原根因

当前 diagnostics 多记录聚合计数（例如 `toolCallResult` 数量）和 host capability 的 success/error，而不是“每个 turn 的状态迁移”。在失败的历史样本中，tool 状态是 `error`，但错误正文为空。缺少以下关联字段：

- `sessionId`、`turnId`、adapter、native session id；
- tool 开始 / tool result / permission auto-reply / prompt resolve 的因果顺序；
- native `stopReason`、最终 assistant message id、finish reason；
- Host capability 错误分类与安全脱敏后的错误摘要；
- 主进程为什么把该回合判为 complete / interrupted 的判定记录。

没有这些字段，用户报“突然不回复”时只能从 transcript 的最后一条倒推，无法确定是连接器、权限、ACP bridge 还是模型自行停止。

### P2：完成检查选择 active assistant message，可能遮蔽真正的 final message

`currentTurnIsComplete()` 优先按 `activeAssistantMessages` 找消息，只有找不到才取用户消息后的首个 assistant（`electron/chat/node.ts:1456`）。若 adapter 漏掉 final assistant 的 `messageStarted` 或 id 关联错误，检查可能持续盯着一个 tool-only message，即使历史里已经有最终回复。这更容易产生假超时/假中断，建议以“本轮最后一个 terminal assistant message”为选择规则，并用 monotonic event sequence 防止旧事件竞争。

## 推荐处理顺序

### 1. P0：修正 ACP 的回合终态契约

不要把 `promptPromise` resolve 直接等价为“用户回合成功完成”。将 `messageCompleted` 扩展为带终态语义的事件，至少携带：

```ts
{ sessionId, outcome: "completed" | "cancelled" | "tool_boundary" | "failed", stopReason?: string, finalMessageId?: string }
```

具体规则建议为：

- 只在 ACP `stopReason` 被明确分类为自然结束，且本轮有最终 assistant 内容或明确的“无文本但成功”协议语义时，发送 `completed`。
- 若最后可见 assistant message 只有 `reasoning` / `tool`，或最后 tool 是 error，则发送 `tool_boundary` / `failed`，保留 active run，并展示可重试错误；绝不补写为 `finishReason: "stop"`。
- cancelled 必须保持独立语义，不能和正常完成共用 `messageCompleted`。

需要添加真实的 ACP fixture：`call_action -> error -> prompt returns end_turn`，断言 UI 看到 error/retry，而不是 `ready`。

### 2. P0：统一所有 adapter 的 terminal-state classifier

将当前 `currentTurnIsComplete()` 的字符串排除表，升级为 adapter 无关的、显式 allow-list 的终态分类器：

- 非终态：`tool_calls`、`tool_use`、`tool_boundary`、`in_progress`、未知；
- 正常终态：`stop` / `end_turn`，但须满足 final-answer 证据；
- 非成功终态：`cancelled`、`error`、`max_tokens`、`content_filter` 等，须显式展示不同恢复动作。

不要用 `completedAt` 作为成功的充分条件；它最多只证明“传输层不再继续写事件”。

### 3. P1：把“最终答复缺失”做成用户可见的恢复状态

当本轮存在 text 前言但随后工具失败，或完成事件到来却没有 final answer 时：

- 显示“连接器步骤未完成，尚未生成最终答复”；
- 展开显示已执行的工具、最后一个工具的安全错误摘要；
- 提供“从失败步骤重试”和“重新发起”两个动作；
- 不把 composer/status 直接设为 ready。

这项改动即使底层 ACP 偶发提前 resolve，也能把“静默断掉”变成可理解、可恢复的失败。

### 4. P1：建立 turn-level 诊断事件

在开发构建和可控采样下，记录脱敏后的 `turn_started`、`tool_started`、`permission_auto_replied`、`tool_finished`、`adapter_prompt_settled`、`terminal_classified`、`turn_completed/failed`。每条带 session/turn/adapter、耗时和安全错误分类。对 host MCP 错误保留错误类型和短摘要，禁止记录 connector 参数、输出、token 或凭据。

这样能直接回答：“究竟是 Host Link 调用失败、权限拒绝、native agent 退出，还是主进程误判完成？”

### 5. P2：上线前回归矩阵

至少覆盖以下组合：

| 场景                                                |                OpenCode |               Codex/ACP |                            Claude Code |
| --------------------------------------------------- | ----------------------: | ----------------------: | -------------------------------------: |
| `oo connector apps/run/proxy` + active Link runtime |  自动允许、继续最终答复 |                      同 |                                     同 |
| `wanta_link.call_action` 成功                       |                正常完成 |                正常完成 |                               正常完成 |
| `wanta_link.call_action` 失败                       |         可见错误/可重试 |         可见错误/可重试 |                        可见错误/可重试 |
| tool-only finish / `tool_calls`                     |          不得 completed |          不得 completed |                         不得 completed |
| native process 在工具后退出                         | `generationInterrupted` | `generationInterrupted` | `agentError` / `generationInterrupted` |
| app reload / transcript 恢复                        |            不丢最终状态 |     不把未完成补成 stop |                    不把未完成补成 stop |

## 已完成的核验

- 当前 `HEAD` 已包含 #339 的修复（`0de0c0be` 是祖先）；工作区原本干净，本报告是唯一新增文件。
- 运行了针对本问题的回归测试：

```text
vitest:
  electron/chat/node.test.ts
  src/hooks/useChat.test.ts
  electron/agent/acp/adapter.test.ts
  electron/agent/acp/adapter-edge.test.ts
  electron/chat/external-dx-edge.test.ts

5 files passed, 212 tests passed
```

- 同时执行 `git diff --check`，通过。

## 本轮实施

已在 `electron/agent/acp/adapter.ts` 落地第一道 ACP 终态保护，目标是先消除已被 transcript 证明的“工具错误后静默完成”路径：

1. 每个 ACP turn 现在追踪未收口的 tool call，以及持久的 `failedToolNeedsExplanation` 标记。任一 tool result 为 error 时设置该标记；即使后续 tool 成功，它也会保留，直到出现非空 assistant text 为用户解释失败原因。
2. ACP `session/prompt` 返回 `end_turn` 时，若仍有进行中的 tool，或 `failedToolNeedsExplanation` 仍为 true，adapter 不再发 `messageCompleted`，而是发出明确的 `agentError`：`<Agent> stopped after a tool call without producing a final response.`。
3. `cancelled` 保持原有的独立完成确认路径，避免用户主动停止后 UI 卡在 streaming。
4. 非 `end_turn` 的 ACP stop reason（例如 token/turn 限制或 refusal）也不再伪装为成功完成，而会走明确错误。

新增的 ACP 回归测试覆盖：

- PostHog 风格的 `tool_call -> failed -> end_turn`，必须产生错误且不得完成；
- `tool_call -> failed -> final assistant text -> end_turn`，允许正常完成；
- `tool_call -> failed -> later successful tool -> end_turn` 仍必须产生错误，确保成功 fallback 不会掩盖未解释的失败；
- 原有 Wanta Link permission correlation fixture 现在补齐 tool result，符合真实 ACP 生命周期。

第二步已新增主进程权威事件 `turnOutcome`，把用户回合的终态明确区分为：

- `completed`：主进程完成历史核验后，才会在旧的 `messageCompleted` 之前发出；
- `cancelled`：用户主动停止；
- `failed`：已知 runtime error；
- `interrupted`：提交超时、启动超时、连接中断等未完成情况。

Chat renderer 已消费该事件：只有 `completed` / `cancelled` 才会进入 ready；`failed` / `interrupted` 保持 error。`messageCompleted` 保留为兼容性的“成功完成”通知，不再是唯一的终态语义来源。相应回归测试验证了正常完成与提交超时都会产生正确的 `turnOutcome`。

第三步已补齐脱敏的 turn-level diagnostics。每一轮现在可按 `sessionId + generationId` 关联以下状态迁移：

- `turn started`：adapter 类型、workspace 类型；
- `tool started` / `tool finished`：工具名、call id、状态、失败分类和用户影响分类；
- `permission automatically replied`：自动许可/拒绝的决策类别，不含资源、命令或参数；
- `prompt settled`：ACP stop reason、终态类别、是否在最后工具后形成自然语言收口；
- `turn outcome`：主进程权威的 completed / cancelled / failed / interrupted 结论及稳定 reason。

这些字段刻意不记录用户 prompt、工具 input/output、连接器返回、令牌或凭据，因此可用于生产诊断而不扩大数据暴露面。

本轮没有改变连接器权限或 raw OOCLI 兼容策略，也没有增加新的 UI 卡片文案；它建立了低风险、可扩展的 adapter → ChatService → renderer 回合终态通道和可追溯诊断链路。下一阶段只有在生产数据表明 Claude 或 OpenCode 仍有同类终态错判时，才应继续让所有原生 adapter 输出同一份强类型终态证据。

## 建议的结论性判断

**可以把这次问题定性为：BYOA 不是唯一根因，但它引入的统一权限、ACP 适配和 Link Host Capability 交汇处造成了高风险回归；#331 的 Link 强制 gate 是截图场景最直接的触发器，#339 修复了其中一半。**

为了真正消除“突然不回复”的体验，下一步不应只继续调 prompt 或增加工具重试；应继续让 Agent adapter 传递可靠的原生终态证据，并将回合状态迁移持久化，确保任何没有 final answer 的情况都能被追溯并明确显示为非成功。
