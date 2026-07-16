# 问题报告命令：现状分析与优化计划

> 调研日期：2026-07-16
>
> 范围：Wanta 内置 `/bug-report`、OpenCode 1.17.13，以及 Claude Code、OpenCode、Cursor、VS Code/GitHub Copilot 的命令与 Skill 机制。
>
> 实施状态：PR `#177` 已完成结构化 Composer command、命令胶囊、可选备注与提交后重置；主进程仍以序列化后的 `/bug-report` 文本作为兼容协议。下文明确区分当前实现、PR 前基线与尚未实施的目标。

## 1. 结论

Wanta 当前的“问题报告”**不是 Skill，也不会调用 Skill**。它是一个由 Wanta UI 暴露、由主进程识别、再通过本轮专用 system prompt 驱动模型生成文件的**应用内置命令**。

这个架构方向本身合理：问题报告需要确定性触发、可信的 Wanta 运行时元数据、受控的制成品目录和严格的工具边界，这些职责不适合完全交给模型自行判断是否加载某个 Skill。PR `#177` 已在 Composer 中补上结构化命令选择和命令胶囊，但执行协议与宿主状态仍有继续结构化的空间。

1. 从与 Skill、Connections 混排的 `/` 菜单选择“问题报告”，自然会以为它也是一个 Skill。
2. PR `#177` 前，选择后只看到输入框里的 `/bug-report` 文本，没有命令胶囊或参数提示，像是普通文本补全；当前已改为命令胶囊和可选备注输入。
3. 执行时没有 `skill` tool call；Wanta 现有的 Skill 活动 UI 只会识别 `Loaded skill: ...`，所以用户无法从执行详情确认“问题报告工作流”是否被加载。

推荐方案不是“为了显示 Skill UI 而强行调用 Skill”，而是继续建设**结构化的 Wanta Command**。当前已实现“Bug 图标 + 问题报告”胶囊和 Composer command state；后续仍需在 IPC 中传递可信 command id、补充宿主驱动的执行状态，并将报告规范沉淀为单一、可版本化的工作流定义。如果未来需要跨 Agent 复用，再从该定义导出 Agent Skills 标准版本，但 Wanta 内仍由命令适配层负责确定性触发和安全边界。

## 2. 当前实现到底做了什么

### 2.1 选择阶段

`src/routes/Chat/composer-palette-items.ts` 将“问题报告”声明为：

- `kind: "slash"`
- `action: "bug-report"`
- `meta: "command"`

它与 Creator Skill、Skills、Connections、文件选择和 Billing 一起出现在根 `/` 菜单中。这里的 `meta: "command"` 只是菜单右侧的分类文案，不会让 OpenCode 注册或调用一个 Skill。

`src/routes/Chat/useComposerPalette.ts` 在用户选择该项后派发 `select-bug-report`；`src/routes/Chat/composer-state.ts` 保存结构化 command state，`ChatComposer.tsx` 显示命令胶囊并将输入框用于可选关注点。提交时，`composerSubmissionText()` 再把该状态序列化为 `/bug-report` 兼容文本。因此选择动作不会：

- 添加 `ChatContextMention`；
- 把命令伪装成 `ContextMentionChips` 或 Skill；
- 自动提交；
- 调用 OpenCode command API；
- 调用 OpenCode `skill` tool。

截图一展示的是 PR `#177` 前只插入普通文本的基线；当前界面已经使用独立命令胶囊。

### 2.2 提交阶段

`electron/chat/node.ts` 在 `sendMessage()` 开头调用 `parseBugReportCommand(req.text)`。只有整条消息匹配以下形式时才会识别：

```text
/bug-report
/bug-report <可选关注点>
```

识别成功后，主进程会：

1. 把本轮有效模式强制为 Build，即使用户当前选择的是 Plan；
2. 创建本轮 artifact/process 目录；
3. 用 `buildBugReportSystemPrompt()` 生成专用 system prompt；
4. 将这段 prompt 与组织 Skill、用户选择的上下文、项目上下文及权限上下文合并；
5. 仍通过 `agent.promptStreaming()` 把原始 `/bug-report ...` 作为普通用户文本发送给当前 OpenCode session；
6. 要求模型只基于命令之前已经存在的会话证据，写出唯一文件 `wanta-bug-report.md`；
7. 复用普通 `ArtifactBundle` 链路展示报告文件。

因此，“问题报告”确实会触发一套专门行为，但这套行为来自 **Wanta 注入的 system prompt**，不是来自某个 `SKILL.md`。

### 2.3 为什么没有 Skill UI

Wanta 的 Skill 有两类可见证据：

- 用户在 composer 中显式选择 Skill 时，Skill 会进入 `contextMentions`，由 `ContextMentionChips.tsx` 显示胶囊，并随用户消息保留；
- OpenCode 模型调用 `skill` tool 时，工具活动标题会是类似 `Loaded skill: pdf`，`tool-activity.ts` 和 `ToolActivityStep.tsx` 会把它归为 Skill 活动。

`/bug-report` 两条 Skill 路径都没有走，所以当前 UI 显示命令胶囊而不显示 Skill 活动，是符合代码现状的，不是偶发渲染故障。

## 3. 当前方案的合理之处与问题

### 3.1 合理之处

当前方案承担了几项必须由宿主应用控制的职责：

- **确定性触发**：用户明确选择命令后，不依赖模型判断“是否应该使用某 Skill”。
- **可信元数据**：Wanta version、build commit、platform、model、agent mode 和 permission mode 来自主进程，而不是让模型猜测。
- **受控制成品路径**：目标文件路径由 Wanta 分配，进入既有 artifact 生命周期。
- **安全边界**：报告轮次禁止调查、重试、修复、连接器、网络、shell 和额外文件读取，只允许写目标文件。
- **上下文连续性**：报告使用当前 OpenCode session 中已有的消息、工具结果、错误、权限和附件证据，不需要重新拼装一份可能丢失信息的外部上下文。
- **兼容现有流式与制成品链路**：无需另建报告渲染器或旁路 session。

这些都是保留“Wanta 命令编排层”的充分理由。

### 3.2 主要问题

#### P0：执行协议仍依赖文本兼容层

Composer 已经知道用户选择了 `bug-report`，但提交时仍把状态序列化进 `req.text`，主进程再解析文本。当前结构化状态解决了选择阶段的交互语义问题，但 command id 尚未贯穿 IPC 和历史消息元数据；未来若修改命令值或本地化显示文本，仍需谨慎维护兼容解析。

#### P0：缺少执行可观察性

系统没有面向用户的“问题报告命令已识别 / 正在整理上下文 / 报告已生成 / 报告生成失败”状态。最终如果模型没有写文件，用户只能从普通助手回复或制成品缺失间接判断。

#### P1：工作流规范硬编码在 TypeScript 字符串中

模板可测试，但不方便复用、版本化、审阅或导出给其他 Agent。它也无法利用 Skill 的支持文件、示例、模板和验证脚本能力。

#### P1：命令提交给模型的正文仍是 `/bug-report ...`

真正的行为契约在隐藏 system prompt 中，而用户消息只保留命令字面量。回看历史时，用户能看到自己输入了命令，却看不到 Wanta 是否把它识别为结构化命令；后续诊断也缺少明确的 command id/version。

#### P2：强制 Build 的 UI 解释不足

后端正确地强制 Build 以写入 artifact，但如果用户当时选择 Plan，界面没有解释“本轮仅为生成报告而使用受限 Build”。这可能让用户误以为 Plan 权限被无条件绕过。

## 4. 其他 Agent 怎么做

行业里没有“所有 slash command 都必须是 Skill”的统一规则。主流产品大致分成三层：

| 机制                         | 典型用途                                                           | 是否依赖模型         | 典型产品                                                        |
| ---------------------------- | ------------------------------------------------------------------ | -------------------- | --------------------------------------------------------------- |
| 内置控制命令                 | 切换 session、权限、模型、撤销、分享、配置 UI                      | 否，宿主直接执行     | Claude Code `/help`、OpenCode `/undo`、`/share`                 |
| Prompt command / prompt file | 手动触发一次可复用 prompt 工作流                                   | 执行工作流时依赖模型 | OpenCode custom commands、Cursor commands、VS Code prompt files |
| Agent Skill                  | 可被用户显式调用，也可由模型按需加载的可复用知识、流程、脚本和资源 | 通常由模型加载并执行 | Claude Code Skills、OpenCode Skills、GitHub Copilot Skills      |

### 4.1 OpenCode

OpenCode 将 command 和 Skill 分开：

- [Commands](https://opencode.ai/docs/commands/) 是可重复执行的 prompt 模板，可配置 template、agent、model 和 subtask，并通过 `/name` 运行。
- [Agent Skills](https://opencode.ai/docs/skills/) 以 `SKILL.md` 定义，Agent 先看到名称和描述，需要时通过原生 `skill` tool 加载完整内容。

Wanta 固定使用的 SDK 1.17.13 也同时暴露 `/command` 列表接口和 `/session/{id}/command` 执行接口；当前 `/bug-report` 没有使用它们，而是走 `/session/{id}/prompt_async` 加自定义 system prompt。

所以从 OpenCode 自身分类看，当前功能更接近“Wanta 自己实现的 prompt command”，不是 Skill。

### 4.2 Claude Code

Claude Code 已将自定义 commands 合并进 Skills：`.claude/commands/deploy.md` 与 `.claude/skills/deploy/SKILL.md` 都可产生 `/deploy`，但官方推荐 Skill，因为它还能携带支持文件、调用控制、动态上下文和 subagent 配置。用户可以直接 `/skill-name` 调用，模型也可以按描述自动加载；可用 `disable-model-invocation: true` 把它限制为仅用户触发。详见 [Claude Code Skills](https://code.claude.com/docs/en/slash-commands)。

这说明“slash 菜单里出现”并不能单独证明它是宿主命令还是 Skill；Claude Code 选择让两者在 UI 上趋同，但依靠类型、配置和执行记录区分。

### 4.3 Cursor

Cursor 的 [Commands](https://docs.cursor.com/en/agent/chat/commands) 是 `.cursor/commands/*.md` 中的普通 Markdown 工作流。输入 `/` 后发现并运行，本质是可复用 prompt，不要求存在 Skill，也不表示调用了 Skill。

### 4.4 VS Code / GitHub Copilot

VS Code 的 [Prompt files](https://code.visualstudio.com/docs/agent-customization/prompt-files) 明确又称 slash commands：用户手动调用 `.prompt.md`，可指定 agent、model 和 tools。Skill 也可以出现在同一个 `/` 菜单中。

GitHub Copilot CLI 则明确区分 custom instructions、Skills、custom agents 与 commands；其[定制机制对比](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/comparing-cli-features)建议在需要按场景加载、输出格式一致、可重复流程时使用 Skill，同时允许手动用 slash command 调用 Skill。其 CLI reference 也将 command 文件描述为 Skill 的简化替代形式。

### 4.5 对 Wanta 的启示

主流实践支持当前“命令触发 prompt 工作流”的技术方向；不合理的不是“它没有做成 Skill”，而是 Wanta 目前缺少清楚的产品语义和执行可观察性。

同时，Claude Code、VS Code 和 Copilot 的趋势表明，用户会逐渐把 `/` 理解为统一的能力入口，而不是严格的类型入口。因此 Wanta 应允许 Command、Skill、Context 和 UI action 共存，但选择后必须用不同的结构化 UI 和执行状态说明它们分别做了什么。

## 5. 方案比较

### 方案 A：维持现状，只改文案

做法：将菜单项改名为“生成问题报告（命令）”，描述强调“选择后会插入命令，发送后生成 Markdown”。

优点：改动小。

缺点：仍依赖文本解析，仍无命令胶囊和执行状态，不能解决“是否真的生效”的核心问题。

结论：只能作为临时止血，不应作为最终方案。

### 方案 B：改成纯 Skill

做法：新增 `wanta-bug-report/SKILL.md`，用户选择后添加 Skill chip，再让模型调用 `skill` tool 并生成报告。

优点：Skill 身份和现有 UI 一致；工作流易复用；可以携带模板和示例。

缺点：如果仍让模型决定是否调用，就失去确定性；Skill 自身不能可信地分配 Wanta artifact 路径或提供主进程 runtime metadata；工具限制和强制 Build 仍需要宿主编排；仅为显示 UI 而伪造一次 skill call 会误导用户。

结论：不推荐作为单独方案。

### 方案 C：采用 OpenCode 原生 custom command

做法：在 OpenCode 配置中注册 `bug-report` command，通过 SDK `session.command()` 执行。

优点：更符合 OpenCode 的 command 抽象；可能获得 `command.executed` 事件；模板从业务代码中分离。

缺点：Wanta 当前依赖 `promptAsync` 的流式、取消、权限、组织上下文和每轮 system 合并；SDK 1.17.13 的 command endpoint 返回完整 assistant message，能否完全保持现有 SSE 和 artifact 生命周期需要实测。动态 artifact 路径、可信 metadata 和隐藏参数也需要安全设计。

结论：值得做兼容性 spike，但不能未经运行验证直接替换。

### 方案 D：结构化 Wanta Command + 单一工作流定义（推荐）

做法：Wanta UI 和 IPC 使用结构化 command id；主进程继续负责确定性执行、安全策略、runtime metadata 和 artifact 路径；报告规范移到一个单一、可版本化、可测试的定义中。OpenCode 原生 command API 若通过 spike，则作为底层执行器；否则保留当前 system 注入，但不再依赖文本识别作为主路径。

优点：解决用户信任问题；保留现有安全与 artifact 能力；不伪装成 Skill；为未来导出标准 Skill 留出空间。

缺点：需要扩展 composer state、聊天 IPC、消息元数据和执行 UI。

结论：推荐。

## 6. 推荐的目标交互

### 6.1 选择后

用户从 `/` 菜单选择“问题报告”后：

- 不再把 `/bug-report` 后接一个空格作为普通文本留在输入框；
- 在输入框上方显示简洁的 `Bug 图标 + 问题报告` 胶囊，不额外添加“命令”前缀；
- 输入框 placeholder 变为“补充希望重点说明的内容（可选）”；
- 胶囊可移除；移除后恢复普通输入；
- 不再增加额外的“命令”可见标签，避免让这个轻量入口显得复杂。

这与 Skill 胶囊应有视觉亲缘性，但通过 Bug 图标和“问题报告”名称表达具体动作，不显示 Skill 标识，也不声称加载了 Skill。

### 6.2 发送后

用户消息展示：

```text
[Bug 图标 · 问题报告]
重点说明授权状态与实际 UI 不一致（可选备注）
```

不要只显示 `/bug-report`。历史记录中应保存结构化 command metadata，确保回看时仍能确认本轮类型。

### 6.3 执行中

在助手活动区显示一个确定性的命令步骤：

- `正在整理当前任务中的问题证据…`
- `正在生成问题报告…`
- 成功：`问题报告已生成`
- 失败：`问题报告生成失败`，附可操作的简短原因

如果底层没有调用 Skill，就不要显示“已加载问题报告 Skill”。执行详情可以显示 command id、workflow version、Wanta version 和是否使用受限 Build，但不显示报告正文或敏感上下文。

### 6.4 完成后

继续使用现有单文件 artifact 卡片展示 `wanta-bug-report.md`。助手正文只给简短状态，避免与报告正文重复。若目标文件缺失，必须显示失败态，不能仅凭模型回复“已生成”判定成功。

## 7. 数据与架构设计

### 7.1 Composer state

新增独立于 `contextMentions` 的命令选择状态，例如：

```ts
type ChatComposerCommand = {
  id: "bug-report"
  label: string
}
```

命令不是上下文，不应混入 `ChatContextMention`。同一轮第一阶段只允许一个 command，避免多命令组合语义不清。

### 7.2 IPC 请求

在 `SendMessageRequest` 增加可信枚举字段：

```ts
command?: {
  id: "bug-report"
}
```

`text` 只承载可选关注点。主进程以 `command.id` 为权威，不再以文本正则作为主路径。

为兼容键盘用户和旧历史，可继续接受字面量 `/bug-report ...`：主进程解析后立即规范化为同一个结构化 command；未知 `/...` 不应静默冒充已知命令。

### 7.3 消息元数据

为用户消息增加 command display metadata，例如 command id、localized label snapshot、workflow version。该字段进入聊天历史和 optimistic message，渲染为 Command chip。

不要把本地化 label 当作执行依据；执行只使用稳定 id。

### 7.4 执行器

抽象 `resolveChatCommand()` 和 `buildChatCommandExecution()`，返回：

- forced mode；
- artifact 文件契约；
- 受控 system/workflow prompt；
- runtime metadata；
- 工具策略；
- 用户可见状态 key；
- workflow version。

先只实现 `bug-report`，但避免把命令分支继续堆进 `sendMessage()`。

### 7.5 工作流定义

将报告结构、事实/假设规则、隐私规则和输出验收从长 TypeScript 数组迁移为单一工作流资源。可选形式按优先级为：

1. Wanta 内置、版本化的 Markdown prompt template；
2. 经 spike 验证可用后，注册为 OpenCode custom command template；
3. 若需要跨 Agent 分发，再提供 Agent Skills 标准的 `SKILL.md` 包装层。

动态的可信路径、runtime metadata 和本轮权限策略仍由 TypeScript envelope 注入，不能放进可被用户或模型覆盖的参数。

### 7.6 可观察性

新增不包含报告正文的 diagnostics：

- `chat command selected`（仅 renderer 本地调试需要时记录）；
- `chat command recognized`；
- `chat command submitted`；
- `chat command artifact verified`；
- `chat command failed`。

字段限制为 command id、workflow version、session/message id、模式、耗时、文件存在性和标准错误分类。不得记录 focus note、报告正文、token、cookie、账号或组织私有数据。

## 8. 开发计划

### 阶段 0：OpenCode 1.17.13 command spike

目标：决定底层继续用 `promptAsync + system`，还是迁移到 `session.command()`。

1. 在 `.wanta-dev/` 建立不入库的 smoke 脚本，注册最小 custom command。
2. 验证 `session.command()` 是否：
   - 产生与 `promptAsync` 一致的 SSE message/tool/permission 事件；
   - 支持取消与 generation watchdog；
   - 支持指定 Build agent、model 和参数；
   - 能与 Wanta 每轮组织、项目、权限和 artifact system context 合并；
   - 不阻塞 RPC 到完整回复结束；
   - 能保留用户可见命令消息并产生可识别的 command event。
3. 记录结果：只要任一关键不变量不满足，本轮优化继续使用现有 `promptAsync`，不阻塞 P0 UX。

验收：形成一页 spike 结论和可重复命令；不得仅依据最新版 OpenCode 文档推断固定版本行为。

### 阶段 1：结构化命令状态与兼容解析（P0）

状态：PR `#177` 已完成 Composer command state、选择动作和文本兼容序列化；结构化 IPC command id、历史消息 metadata 和显式未知命令错误尚未完成。

1. 扩展 composer state，新增单一 command selection。
2. 选择“问题报告”时设置 command，不再插入普通文本。
3. 扩展 `SendMessageRequest` 与 optimistic message metadata。
4. 主进程按结构化 id 识别；保留 `/bug-report` 文本兼容入口并统一规范化。
5. 将命令解析和执行计划从 `sendMessage()` 分离为纯函数模块。
6. 未知或格式错误的显式命令给出明确错误，不静默按普通消息处理。

验收：UI 选择与手输 `/bug-report` 最终进入同一 command execution；修改可选备注不会破坏命令身份。

### 阶段 2：命令 UI 与历史呈现（P0）

状态：PR `#177` 已完成命令 chip、可选备注 placeholder、移除行为和提交后重置；用户消息 command metadata、宿主执行状态和 Plan 模式解释尚未完成。

1. 新增问题报告 chip，只显示 Bug 图标和“问题报告”。
2. 添加可选备注 placeholder 与移除行为。
3. 用户消息气泡渲染 command metadata。
4. 增加执行中、成功、失败状态；状态由宿主事件驱动，不由模型文案猜测。
5. Plan 下触发时解释本轮使用“受限 Build，仅用于写报告文件”。
6. 中文界面将菜单 meta `command/context/skill/ui` 本地化，降低类型误解。

验收：仅看 UI 即可回答“我选择了什么、是否生效、现在在做什么、是否成功”。

### 阶段 3：工作流定义单一化（P1）

1. 把静态报告规范迁移到 Markdown template。
2. TypeScript 仅注入可信 runtime envelope、目标路径和安全策略。
3. 增加 workflow version，并写入报告环境区和 diagnostics。
4. 增加模板结构测试、隐私规则测试和 snapshot/fixture 测试。
5. 根据阶段 0 结果决定 template 由 Wanta prompt executor 还是 OpenCode native command executor 承载。

验收：报告章节和规则只有一个权威来源；模板改动可独立审阅和测试。

### 阶段 4：结果验证与故障恢复（P1）

1. 完成时由主进程验证目标文件存在、是普通文件、位于本轮 artifact root、UTF-8 可读且非空。
2. 可选增加最低结构验证：标题和关键章节存在；失败时标记“报告不完整”而不是成功。
3. 失败 UI 提供“重试生成报告”，重试仍只使用已有上下文，不调查或修复原问题。
4. 确保模型口头声称成功但文件缺失时，宿主最终状态仍为失败。

验收：artifact 是成功状态的权威，模型文案不是。

### 阶段 5：可选的跨 Agent Skill（P2）

只有在确实需要让 Wanta 之外的 Agent 复用报告流程时执行：

1. 从同一工作流规范生成或包装 `wanta-bug-report/SKILL.md`。
2. Skill 负责报告方法、模板与隐私规则，不负责伪造 Wanta runtime metadata 或 artifact path。
3. Wanta 命令显式调用内部适配器；若底层实际调用 Skill，才显示 Skill activity。
4. 做 Claude Code、OpenCode 和 Copilot 的最小兼容测试。

验收：Skill 与 Wanta command 不复制规范；任何 UI 都准确反映真实调用路径。

## 9. 测试计划

### 9.1 纯函数与 IPC

- 结构化 `bug-report` command 正常解析；
- 文本 `/bug-report` 兼容并规范化；
- `/bug-report-other`、消息中间出现 `/bug-report`、未知命令不会误触发；
- command 与可选备注分离；
- forced Build、artifact root 和 prompt runtime metadata 保持一致；
- command metadata 能随消息历史往返；
- 不把 command 误存为 Skill context mention。

### 9.2 UI

- 菜单选择后显示 Command chip，不显示普通 `/bug-report` 文本；
- Command chip 与 Skill chip 在图标、类型和无障碍名称上可区分；
- 移除、重新选择、发送、停止、失败和重试状态正确；
- 用户消息历史正确展示 command 与备注；
- Plan 场景显示受限 Build 说明；
- 中文和英文 meta 全部本地化。

### 9.3 安全与产物

- 报告工作流不能调用 connector、web、shell 或读取额外文件；
- 只能写目标文件，越界路径被拒绝；
- runtime metadata 由宿主提供；
- focus note 不能覆盖 system contract；
- secrets、cookies、tokens、authorization code 和非必要账号信息不会进入报告；
- 文件缺失、空文件、目录、symlink、越界路径、非 UTF-8 和不完整结构都有明确失败或警告。

### 9.4 全量验证

按仓库纪律运行：

```bash
npm run ts-check
npm run lint
npm run format
npm test
npm run dev
```

运行态至少保存以下证据：

1. 选择命令后的 composer 截图；
2. 发送后的用户消息和执行中状态截图；
3. 成功 artifact 卡片截图；
4. 模拟文件缺失时的失败截图；
5. diagnostics 中 command recognized → artifact verified 的脱敏记录。

## 10. Definition of Done

优化完成必须同时满足：

- 用户不再需要猜测“问题报告是不是 Skill”；
- UI 明确把它称为 Command，并在选择、执行和历史中保持同一身份；
- 用户能确认命令已经被 Wanta 识别，而不只是插入了文本；
- 结构化 command id 是主执行入口，文本正则仅用于兼容；
- 报告仍基于命令前已有会话证据，不额外调查、重试或修复；
- 报告 artifact 由宿主验证后才显示成功；
- 如果实际没有调用 Skill，任何界面和日志都不声称调用了 Skill；
- 报告工作流只有一个权威定义；
- `ts-check`、`lint`、`format`、`test` 全绿，UI 经 `npm run dev` 实机验证。

## 11. 最终产品判断

当前实现可以概括为：**能力是真的，类型是 Command，Skill 没有被调用，用户反馈不足。**

它不需要为了符合某种抽象而被整体改造成 Skill。更稳妥的产品设计是：

```text
Slash 菜单入口
  → 结构化 Wanta Command（确定性、可信元数据、安全策略、状态 UI）
    → 可版本化报告工作流（prompt template；必要时可导出 Skill）
      → 当前 OpenCode session
        → 经宿主验证的 wanta-bug-report.md artifact
```

这个分层既符合多数 Agent 产品对 command/prompt workflow 的实践，也保留了 Skill 在跨 Agent 复用、支持文件和按需加载方面的价值，同时不会用一个并不存在的 Skill 调用误导用户。
