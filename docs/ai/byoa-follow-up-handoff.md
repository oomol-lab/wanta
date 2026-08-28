# BYOA 托管工具工作流：后续推进交接

更新时间：2026-08-28（Asia/Shanghai）

## 1. 新对话的任务目标

继续验证并完善 Wanta 的 BYOA（Claude Code、Codex、Grok）托管工具工作流。重点是确保：

1. 普通短对话不会无意义地闪现“处理过程”。
2. 工具调用前后的文字在生成过程中不会跨容器跳动。
3. Claude Code、Codex、Grok 使用 Wanta 提供的当前轮 Skill 快照和受控 OOCLI 路径，不回退到同名的本机原生 Skill 或旧 MCP 路径。
4. OOCLI、导出的 `oo` Skill、Wanta 能力契约和打包产物之间保持可验证的版本兼容性。
5. 后续扩展 `oo file`、Flow 等能力时，不绕过现有的权限、安全和工作区边界。

## 2. 当前仓库与 PR 状态

- 仓库：`oomol-lab/wanta`
- 已合并 PR：[#362 fix(byoa): stabilize managed OO tool workflows](https://github.com/oomol-lab/wanta/pull/362)
- PR 状态：`MERGED`
- 合并时间：2026-08-28 06:30:55 UTC
- 合并提交：`bf4eb95a84e0a6aa0730b731511418a9e13c3349`
- PR 最后一个源分支提交：`6b323537da4960a520559da1372c45e34884f441`
- 源分支：`codex/stabilize-byoa-tool-workflows`
- 基础分支：`main`
- 最后一轮 GitHub Actions：通过
- CodeRabbit 最后一轮复核：通过
- 未解决 review thread：0

后续推进时已经把本地 `main` fast-forward 到合并提交 `bf4eb95a`，并清理了已合并的临时分支。File/Flow 能力的后续实现位于 `codex/enable-managed-oo-file-flow`。

## 3. 已完成内容

### 3.1 对话时间线与“处理过程”展示

- 普通短对话不会因为只有 assistant 文本而创建空的“处理过程”。
- 工具调用前的说明文字仍属于处理过程，不会被错误拆成最终回答。
- 工具之后出现、但尚不能判断是中间叙述还是最终回答的文字，进入内部 `pending tail` 状态。
- 如果后面继续出现工具调用，`pending tail` 会被提交到处理过程。
- 如果当前轮以终止状态结束，`pending tail` 会被提交到最终回答。
- 未决期间只展示稳定的“正在整理结果”状态，避免文字先出现在处理过程里、完成后又跳到处理过程外。
- 时间线顺序和 React key 已保持稳定，并覆盖了恢复历史消息的场景。

主要文件：

- `src/routes/Chat/assistant-timeline.ts`
- `src/routes/Chat/assistant-timeline.test.ts`
- `src/routes/Chat/AssistantTurnRenderer.tsx`
- `src/routes/Chat/ChatTimeline.tsx`
- `electron/agent/acp/translator.ts`
- `electron/agent/acp/translator.test.ts`

### 3.2 Claude Code、Codex、Grok 的统一行为

- 三类 ACP agent 都通过参数化测试覆盖了 Skill 注册、Skill 加载、引用文件读取和托管 `oo search` 调用。
- Wanta 当前轮提供的 Skill 快照对于选中 Skill、团队 Skill 和 host-discovered Skill 具有权威性。
- agent 会收到机器可读的 Skill 来源信息，并被明确告知不要用 home/global/native 目录里的同名 Skill 替换 Wanta 快照。
- 增加了本机原生 Skill 读取检测；诊断仅保留来源类别等元数据，不保留私人路径、Skill 内容或工具负载。
- 已覆盖完整链路：ACP → Wanta managed OO shim → loopback guard → 假 OOCLI → ACP tool result。
- 端到端测试使用 `process.execPath` 显式启动 `.mjs` fixture，不依赖 Unix shebang，可在 Windows 上运行。

主要文件：

- `electron/agent/acp/adapter.ts`
- `electron/agent/acp/adapter.test.ts`
- `electron/agent/external/native-skill-source.ts`
- `electron/agent/external/native-skill-source.test.ts`
- `electron/agent/skill-host-capability.ts`
- `electron/chat/context-system.ts`

### 3.3 OO 能力契约与安全边界

- 新增单一、版本化的 External OO capability contract。
- guard 的准入、工作区绑定和 Skill 执行说明均从同一契约派生。
- 已开放受控、只读的顶层 `oo search`。
- 未开放任意 `oo *` 命令。
- 不支持或无法识别的命令会返回结构化的 `UNSUPPORTED_OO_OPERATION` 或 `UNRECOGNIZED_OO_OPERATION` 信息。
- 身份验证、配置、登出和 Skill 推荐状态操作仍明确拒绝。
- `file.upload`、`file.download` 和 Flow 仍处于 `planned`，没有因本次改动被意外放开。

主要文件：

- `electron/agent/external/oo-capability-contract.ts`
- `electron/agent/external/oo-capability-contract.test.ts`
- `electron/agent/oo-guard-core.ts`
- `electron/agent/oo-guard-core.test.ts`
- `electron/agent/external/oo-guard-server.ts`

### 3.4 OOCLI 与 Skill bundle lock

- 当前固定 OOCLI 版本：`1.7.12`。
- 固定版本常量集中在 `electron/agent/oo-version.ts`。
- 已提交 Skill lock，记录 agent format、完整 Skill 文件集合、SHA-256 和当前版本实际使用的操作域。
- predev、打包和 CI 会检查 Skill 文件新增、删除或内容漂移。
- 打包时生成 runtime integrity descriptor；启动时异步校验 OOCLI 版本、契约版本和完整 Skill 树哈希。
- 如果校验失败，系统 fail closed：不暴露 `wanta_skills`，拒绝 managed OO dispatch，但保留本地编码、浏览器、知识库、提问等非 OO 能力。
- `oo:upgrade` 会在隔离临时目录下载候选 OOCLI、导出 Skill、扫描命令域并生成 Markdown/JSON 审核报告。
- `oo:upgrade` 默认直接完成下载、审查和升级；`--dry-run` 只预览。operation 清单完全从候选 Skill 重建，不继承旧版本历史项；未知操作会阻止升级。
- 并行 Skill 导出使用独立 `mkdtemp` 配置/数据/日志目录，并在 `finally` 清理。

相关命令：

```bash
pnpm run oo:verify
pnpm run oo:upgrade -- <candidate-version>
pnpm run oo:upgrade -- <candidate-version> --dry-run
```

主要文件：

- `electron/agent/oo-version.ts`
- `resources/skill-lock/oo.json`
- `electron/agent/external/oo-runtime-integrity.ts`
- `scripts/oo-skill-lock.ts`
- `scripts/oo-upgrade.ts`
- `scripts/oo-upgrade-review-core.ts`
- `scripts/skills.ts`
- `scripts/prepare-binaries.ts`

## 4. 已完成验证

PR #362 最后一轮已完成：

- `pnpm run lint`
- `pnpm exec oxfmt --check .`
- `pnpm run ts-check`
- `pnpm test`
- `pnpm run build`
- `pnpm run oo:verify`
- `git diff --check`
- GitHub Actions `Check Pull Request / check`

本地最后一次全量测试结果为：

- 364 个 test files 通过，2 个跳过
- 2908 个 tests 通过，4 个跳过

## 5. 接下来应做的事情

### P0：同步主分支并清理已合并分支

这是新对话开始后的第一步。

1. 确认交接 Markdown 已保存。
2. `git fetch origin --prune`。
3. 切换到 `main` 并 fast-forward 到 `origin/main`。
4. 确认 `main` 包含合并提交 `bf4eb95a`。
5. 删除本地已合并分支 `codex/stabilize-byoa-tool-workflows`。
6. 如果远端临时分支尚未由 GitHub 自动删除，再删除该远端分支。
7. 最后确认工作树干净，且 `main` 与 `origin/main` 同步。

注意：不要使用 `git reset --hard`，不要覆盖用户未提交的改动。若这份交接文档尚未提交，应先妥善保留它，再切换分支。

### P0：人工验收真实 BYOA 行为

自动测试已经覆盖状态机和受控链路，但仍需要真实客户端手测。建议分别选择 Claude Code、Codex、Grok，执行同一套用例：

| 场景                                        | 预期结果                                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 只发送“你好”                                | 直接显示回答，不出现或闪现“处理过程”                                                     |
| assistant 先说明“我先加载 Skill…”再调用工具 | 说明文字从一开始就稳定留在处理过程内，不先单独显示再被搬进去                             |
| 工具调用后输出中间说明，然后继续调用工具    | 中间说明归入同一个处理过程，不产生多个碎片化处理卡片                                     |
| 最后一个工具结束后开始生成最终文字          | 未决时显示稳定的“正在整理结果”；轮次结束后文字只出现在最终回答，不先显示在处理过程再跳出 |
| 图片生成或异步任务                          | 工具记录留在处理过程；最终说明和图片留在最终回答；折叠前后归属一致                       |
| 展开/折叠处理过程                           | 不丢内容、不重复、不改变消息顺序、不明显跳动                                             |
| 刷新或重新进入历史会话                      | 恢复后的分组与生成完成时一致                                                             |
| 调用 `oo search`                            | 通过 managed guard 成功执行，不出现原始 `mcp__wanta_skills__...` 基础设施名称            |
| 读取同名本机原生 Skill                      | 应优先使用 Wanta 当前轮快照；若发生本机读取，应记录安全的来源诊断                        |

手测时建议记录：agent 类型、模型、输入、工具事件顺序、最终截图、是否发生布局跳动、是否出现重复或错误归组。

如果真实运行仍有跳动，先抓取 ACP 原始事件序列和渲染侧 timeline 派生结果，再决定修改 translator 还是 renderer；不要仅根据截图修改视觉条件。

### P1：补充真实进程级 smoke test

当前测试已经覆盖内存 ACP 和假 OOCLI 完整链路，但可以再增加一个低频、可选的真实进程 smoke test：

- 启动实际可用的 Claude Code/Codex/Grok adapter，但不调用真实模型或外部账号。
- 验证 capability 注入、Skill 来源优先级、managed OO shim 注册和关闭清理。
- 测试应允许在缺少对应 CLI 时明确 skip，不能让普通开发环境不稳定。
- 不要把真实 token、账号、用户目录 Skill 内容写入 snapshot 或日志。

这一项不是 PR #362 的合并阻塞项，建议单独开 PR。

### P1：增加可观测性和回归诊断

建议为以下状态增加开发模式下的结构化诊断，但不要暴露敏感内容：

- `pending tail` 创建、提交到 process、提交到 final 的原因。
- packaged OO runtime integrity 的失败原因。
- agent 选择了 Wanta Skill 快照还是检测到 native Skill source。
- managed OO operation 被 enabled、planned、denied 或 unrecognized 的分类。

诊断仅应包含 session-safe id、agent kind、operation id、版本、哈希或枚举原因；不要记录凭证、命令负载、连接器返回数据、私人绝对路径或 Skill 正文。

### P2：File 与 Flow 能力（已实现，待真实环境验收）

`codex/enable-managed-oo-file-flow` 已完成第一阶段安全开放：

1. `file.upload` / `file.download`
   - 只允许读取或写入当前活动 turn 的 managed roots。
   - 上传只接受普通文件，限制为 500 MiB，并进入 consequential-action 确认。
   - 下载只接受无内嵌凭据的 HTTP(S) URL，拒绝 localhost、私网、链路本地和特殊用途 IP。
   - 未提供下载目录时固定写入 managed cwd；文件名和扩展名不能形成路径逃逸。
   - 签名 `downloadUrl` 仅对当前 agent 的实时命令结果保留，进入 transcript/UI 前仍按敏感字段脱敏。
2. Flow
   - 只在 OOMOL runtime 下开放。
   - Project-scoped 命令必须显式传 `--project`；先用 `oo flow project current --json` 解析当前 Project。
   - 已开放 Project 读取、Flow 读取、Draft 创建/编辑/检查、Run、Publish 和结果读取等已建模子命令。
   - Flow `run` 和 `publish` 进入 consequential-action 确认。
   - `apply`、`@file` 等本地引用只能读取 managed roots；stdin 被拒绝。
   - Project 切换、Flow 删除、rollback、run cancel、open/workbench 仍保持关闭，等待独立的状态恢复或浏览器凭据语义。

本次同步更新了：

- capability contract
- guard admission
- workspace/side-effect/confirmation policy
- Skill 执行说明
- Skill bundle lock
- 升级扫描器
- 单元测试、拒绝测试和端到端测试
- File/Flow 的人类可读工具标签，以及下载签名 URL 的 UI 脱敏
- OOCLI 同版本重新接受 capability review 的流程

### P2：建立 OOCLI 升级演练节奏

以后升级 OOCLI 时遵循以下流程：

1. 如需预览，在干净分支运行 `pnpm run oo:upgrade -- <version> --dry-run`。
2. 正常升级直接运行 `pnpm run oo:upgrade -- <version>`；命令会下载、审查并落盘。
3. 未知命令会自动阻止升级；先修改 capability contract 和安全策略，再重跑同一升级命令。
4. 升级命令会从新版 Skill 重新生成 operation 清单，不继承旧版本历史项。
5. 运行完整验证并检查固定版本、Skill lock 和 packaged integrity descriptor 是否同步。
6. 单独提交升级，PR 中附上升级报告摘要。

## 6. 暂时不要做的事情

- 不要把所有非工具文字都永久拆到处理过程外；文字归属必须由事件时序和终止状态决定。
- 不要在收到第一段 post-tool 文本时立即决定它一定是最终回答。
- 不要允许任意 `oo *` 命令穿过 guard。
- 不要为了兼容 Claude Code 而重新暴露旧的 raw MCP Skill 工具路径。
- 不要信任 home/global 目录中的同名 Skill 覆盖 Wanta 当前轮快照。
- 不要在 runtime integrity 验证失败时“尽量继续”开放 managed OO；应继续 fail closed。
- 不要在没有路径、权限、side effect 和确认策略的情况下开放文件或 Flow 写操作。
- 不要在日志、测试快照或诊断里保留 token、connector payload、Skill 正文或私人绝对路径。

## 7. 新对话建议执行顺序

1. 阅读本文件。
2. 阅读 `AGENTS.md`。
3. 按任务读取：
   - `docs/ai/agent-adapter.md`
   - `docs/ai/host-capabilities.md`
   - 若需要启动和手测，再读取 `docs/ai/dev-debugging.md`
4. 检查 Git 和 PR #362 的最终状态，不重复实现已经合并的内容。
5. 同步 `main`，清理已合并临时分支。
6. 跑最小基线验证。
7. 启动应用，按 P0 手测矩阵完成 Claude Code、Codex、Grok 验收。
8. 把发现的问题按“事件翻译 / timeline 派生 / UI 渲染 / guard / Skill 来源 / 打包兼容性”分类。
9. 只修复能复现的问题，补对应测试，再运行完整验证。
10. P1/P2 工作分别创建小而独立的分支和 PR，不继续扩大已合并 PR #362。

## 8. 可直接复制给新对话的提示词

```text
请阅读 docs/ai/byoa-follow-up-handoff.md，并根据其中的优先级继续推进。

先检查当前 Git 状态和 PR #362 的合并状态。保护所有未提交改动，然后同步 main、清理已经合并的 codex/stabilize-byoa-tool-workflows 临时分支。之后按文档中的 P0 人工验收矩阵启动 Wanta，重点验证 Claude Code、Codex、Grok 的短对话、工具前说明、中间叙述、最终回答、图片生成、展开折叠和历史恢复是否稳定。

如果发现问题，先用 ACP 事件序列、managed OO guard 诊断和 timeline 派生结果定位根因，再修改代码并补回归测试。不要重复实现 PR #362 已经完成的能力，也不要把仍未建模的 Project 切换、Flow 删除/rollback/cancel/open/workbench 直接改成 enabled。完成后报告验证结果、剩余风险和下一步建议。
```

## 9. 完成标准

本阶段可以认为完成，需要同时满足：

- 本地 `main` 与 `origin/main` 同步，已合并临时分支完成清理。
- Claude Code、Codex、Grok 均完成 P0 手测矩阵，结果有记录。
- “你好”类短对话无处理过程闪烁。
- 工具前说明、中间叙述和最终回答在生成中及完成后归属一致。
- 展开、折叠和历史恢复不改变内容分组。
- managed `oo search` 正常，raw MCP 基础设施名称不泄露到用户界面。
- 未出现 native Skill 抢占 Wanta 快照的问题，或已有可解释且不泄密的诊断。
- 所有新增修复具备回归测试，lint、format、type check、tests、build 和 OO bundle verification 全部通过。
- File 上传/下载与已建模 Flow 子命令通过真实环境验收；未建模的管理、恢复和浏览器操作继续保持关闭。
