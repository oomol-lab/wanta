# Chat 与制成品性能测量 Runbook

> 用于复核 Q-2026-007（长会话流式渲染）和 Q-2026-010（大型预览首次打开）。
> 两项都依赖真实 renderer、真实会话或制成品，不能用 bundle 大小或静态阅读替代运行态证据。

## 1. 固定环境记录

每次测量先记录：

- Git commit、macOS/Windows/Linux 版本、CPU 架构、Node/npm 版本；
- dev 或 production bundle，是否打开 DevTools，是否启用 Chromium cache；
- 登录账号类型和 workspace 类型，但不记录账号标识、cookie 或 token；
- 会话消息数、可见消息数、文本总字符数、图片数和制成品数量；
- PDF 文件字节数/页数，工作簿字节数/sheet 数/非空单元格数。

同一轮 before/after 必须使用相同设备、构建模式、账号、workspace 和输入文件。关闭其他高负载应用，首次采样只用于 warm-up，不计入汇总。

## 2. Q-2026-007：长会话流式更新

### 场景

1. 运行 `npm run dev`，确认 Agent sidecar ready；
2. 打开至少 200 条消息的会话，并滚动到最新消息；
3. 准备一个能稳定输出至少 3000 个中文字符或 6000 个英文字符、持续至少 20 秒的只读请求；
4. 分别记录流式开始前 5 秒、持续输出全程和完成后 5 秒；
5. 至少执行 5 次，丢弃第一次 warm-up，报告其余样本的中位数、p95 和最差值。

### React Profiler

记录并导出 profile，至少检查：

- `AppShell`、sidebar、composer、`ChatTimeline`、当前 turn 和 artifact panel 的 commit 次数；
- 没有数据变化的 sidebar/settings/artifact 子树是否跟随每批 token commit；
- 单次 commit duration 的中位数、p95 和最大值；
- part key 是否保持稳定，是否出现 message/part 非预期重挂载。

### Chromium Performance

启用 Screenshots 与 Memory，记录：

- 大于 50ms 的 long task 数量、持续时间和调用栈；
- scripting/layout/paint 时间；
- 输入框键入和滚动期间的 Interaction latency；
- renderer JS heap 在流式前、峰值和完成后 30 秒的数值；
- GC 次数和单次暂停时间。

只有 profile 指向明确组件、selector、序列化或布局根因时才能改代码。不得仅凭 commit 次数添加全局 memo，也不得改变累计全文 part、稳定 partId、Enter 只发送或制成品层级。

## 3. Q-2026-010：大型预览首次打开

### 构建与样本

1. 运行 `npm run build`，使用 production renderer bundle；
2. 准备固定的 PDF、XLSX 和 CSV 样本；工作簿测试必须保留 Univer 完整渲染与交互；
3. 每类样本记录文件大小和结构规模，不使用包含隐私或凭证的数据；
4. 每次冷测前关闭制成品预览并禁用 Chromium cache；热测保持 cache，各执行至少 5 次。

### 采集点

从点击预览卡开始，到以下状态分别打点：

- 动态 import 请求开始和完成；
- JavaScript parse/evaluate 完成；
- preview RPC/worker 开始和完成；
- 首个可见内容绘制；
- PDF 可滚动、工作簿可选择单元格时的可交互时间；
- 打开前、首次可见、可交互和关闭后 30 秒的 renderer heap。

同时记录 Network、Performance trace 和 chunk 名称。区分下载、parse/evaluate、worker 数据准备和组件渲染，不能把总时间全部归因于 chunk 大小。

## 4. 判定与归档

- 原始 trace/profile 文件可能包含本地路径或业务内容，默认放 `.wanta-dev/quality/`，不得提交；
- 在 `docs/quality/baseline.md` 只记录脱敏后的场景、原始数值、汇总方法和结论；
- 达不到可感知阈值或没有稳定根因时，将 finding 标记 `rejected` 或继续 `defer`；
- 确认问题时先记录 before 和目标，再做最小改动，并使用完全相同的场景复测；
- Univer 预览不得删除、降级、替换或改成只读表格以换取性能数字。
