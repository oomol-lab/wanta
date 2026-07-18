# 质量基线

> 本文记录首轮质量优化使用的可复现基线。长期方法和执行规则见
> [全项目质量优化计划](../quality-improvement-plan.md)。

## 2026-07-18 首轮基线

环境：

- macOS Darwin 25.5.0，arm64；
- npm 10.9.4；
- 当前 shell 为 Node 22.21.1，低于仓库要求的 Node 22.22.2；
- CI 使用 Node 24，因此本机结果用于发现回归，最终合入仍以 CI 为准。

结果：

| 检查               | 结果 | 记录                                                  |
| ------------------ | ---- | ----------------------------------------------------- |
| `npm run ts-check` | 通过 | 无类型错误                                            |
| `npm run lint`     | 通过 | 无 lint 错误                                          |
| `npm run format`   | 通过 | 首次检查 774 个文件                                   |
| `npm test`         | 通过 | 修改前 232 个测试文件、1554 个测试                    |
| `npm run build`    | 通过 | renderer、main、preload 均构建成功；存在大 chunk 警告 |

源码规模仅用于规划审计范围，不作为质量目标：

- `electron/`、`src/`、`scripts/` 下约 742 个 TypeScript/TSX 文件；
- 合计约 134,496 行；
- 显式 TODO 共 1 个，是消息反馈 API 的已知预留。

## 当前验证缺口

- 本轮没有真实账号，因此没有执行登录、组织切换、连接器 OAuth、支付返回和 Agent 对话金路径；
- 没有以签名 packaged app 验证通知；
- 尚未采集长会话 React Profiler、Chromium Performance trace 和多进程内存曲线；
- 当前 shell Node 版本低于仓库最低要求，不能替代 Node 24 CI 结果。

后续性能 finding 在没有同环境 before/after 数据前只能保持 `hypothesis`。

## 首轮修复后的结果

- 新增 5 个回归测试，测试总数从 1554 增至 1559；
- `ts-check`、`lint`、`format`、全部测试和 production build 通过；
- `npm run dev` 在 195ms 内启动 Vite，main/preload 构建成功，Agent sidecar 正常 ready；
- 开发版启动观察期没有新增主进程或 renderer 错误日志；
- 真实账单支付返回和账号/组织切换仍因缺少可用测试账号而未实机验收。

## 第二轮修复后的结果

- 新增 2 个测试文件、7 个乱序响应测试，测试总数从 1559 增至 1566；
- `ts-check`、`lint`、`format`、234 个测试文件和 production build 通过；
- `npm run dev` 在 322ms 内启动 Vite，main/preload 构建成功，Agent sidecar 正常 ready；
- 启动观察期未发现认证或知识库相关错误；主动结束开发进程后仅记录预期的 renderer `clean-exit`；
- 真实登录回调、换号和知识库 beta 开关切换仍需账号环境补验。

## 第三轮性能修复后的结果

- 确认首次技能清单的主要瓶颈不是 101 个 skill 的 hash，而是 agent discovery 实际启动第三方 CLI 并等待 `--version` timeout；
- 改为在 login-shell 合并后的 PATH 中异步检查 executable，不再为发现操作启动第三方进程；新增 2 个回归测试，测试总数从 1566 增至 1568；
- 五次显式重置缓存的 discovery + scan 为 1141–1249ms，五次缓存内 scan 为 50–77ms；剩余冷启动时间主要来自用户 login shell PATH 解析；
- 真实 `npm run dev` 首次 inventory scan 从前三次的 2097–2154ms 降至 610ms，随后两次为 68ms 和 65ms；同时正确发现旧探测超时漏掉的 Hermes，最终 installed skill 数从 101 变为 125；
- `ts-check`、`lint`、`format`、234 个测试文件、1568 个测试和 production build 通过；开发版 Vite 在 198ms ready，Agent sidecar 正常 ready，观察期没有 warn/error diagnostics。

## 第四轮缓存生命周期修复后的结果

- 账单缓存现在随认证 identity 变化清空，不再在登出或换号后永久保留历史账号、组织和权限组合的数据；
- 清理采用 Map detach，清理前的在途请求即使随后成功，也只能写回已脱离的旧 entry，不能污染同 key 的新账号缓存；
- 新增 1 个回归测试，测试总数从 1568 增至 1569；`ts-check`、`lint`、`format`、234 个测试文件和 production build 通过；
- `npm run dev` 在 200ms ready，main/preload 和 Agent sidecar 正常启动，观察期没有新增 warn/error diagnostics；当前账号环境无法执行真实换号交互。

## 第五轮性能假设复核

- 缩略图由主进程统一生成 160×160 PNG，renderer 仅在 near viewport 加载并最多保存 128 项；纯色、渐变、棋盘格和不可压缩噪声样本的 data URL 分别为 714、1914、886、120410 字符；
- 128 个极端噪声缩略图约为 14.7 MiB ASCII payload，常见可压缩样本合计约 0.09–0.23 MiB；在没有 heap/GC 异常证据时增加字节预算会提高滚动重载成本，因此 Q-2026-008 标记为 rejected；
- 当前真实技能清单为 42 groups、143367 bytes JSON；与 renderer 相同的 normalize + stringify 双边比较执行 1000 次，中位数 1.809ms、p95 2.277ms、最大 2.731ms；
- 10 倍合成清单为 420 groups、1204830 bytes，200 次比较中位数 16.482ms、p95 17.041ms、最大 20.085ms；两种规模均未达到 50ms long-task 阈值，因此 Q-2026-009 标记为 rejected；
- 两项均只更新证据和决策，没有为了理论数字改动运行时代码。
