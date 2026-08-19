# Wanta Windows GPT Image 2 与 UI 问题修复报告

日期：2026-08-19
范围：Windows 11 下 GPT Image 2 运行、生成图片呈现、右侧面板和标题栏交互

## 结论

本次反馈中，Wanta 代码库可以明确处理的运行时兼容问题及右侧面板 UI 问题均已修复并通过全量自动化测试。

其中，GPT Image 2 runner 的中文 Windows 输出解析、runner 重命名、子进程窗口闪现已修复；Windows 右侧面板开关的位置、打开后开关消失、分割线位置偏移和不可拖拽已修复。生成图片在 Windows 上将使用与 macOS 相同的 Markdown 本地图片预览路径；不会在产物卡片上额外再渲染一张缩略图。由于当前开发环境不是 Windows，仍需要在 Windows 安装包上做一次真实生成回归。

## 反馈项与处置结果

| 编号 | 反馈现象                                                          | 原因判断                                                                                  | 修复状态                    | 修复结果                                                                                                        |
| ---- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1    | GPT Image 2 图片已经下载，但 runner 报“无法解析下载路径”          | 中文 Windows 的 `oo file download` 会输出 `已保存到：`，原 runner 仅匹配半角冒号          | 已修复                      | 同时支持 `Saved to:`、`已保存到:`、`已保存到：`、`保存至:`、`保存至：`                                          |
| 2    | 将 `run_image.js` 复制并改名后，脚本把自身路径当作位置参数        | runner 对脚本文件名进行了硬编码校验                                                       | 已修复                      | 任何 `.js` runner 文件名均可正常运行                                                                            |
| 3    | Windows 运行 GPT Image 2 时可能出现额外命令行窗口                 | 子进程启动参数未隐藏 Windows 控制台                                                       | 已修复                      | `oo` 子进程使用 `windowsHide: true`                                                                             |
| 4    | 右侧面板打开后，收起按钮消失                                      | 原逻辑在面板可见时隐藏主标题栏按钮，Windows 原位置又会被系统窗口控制区挤压                | 已修复                      | Windows 始终保留主标题栏的右侧面板开关                                                                          |
| 5    | 右侧面板开关会被最小化、最大化、关闭按钮挤压                      | 开关靠近 Windows 原生窗口控制区                                                           | 已修复                      | 开关移至“充值/用量”按钮右侧、右侧面板分割线左侧                                                                 |
| 6    | 拖拽右侧面板时，分割线视觉位置与实际边界不一致                    | Grid 布局与拖拽时冻结内容宽度组合，使内容尺寸可脱离面板壳层                               | 已修复                      | 改为明确的 Flex 布局，分割线和 8px 拖拽命中区是同一个真实布局边界                                               |
| 7    | 右侧面板打开后，分割线区域无法拖拽                                | 拖拽命中区可能被内容尺寸覆盖                                                              | 已修复                      | 分割线作为主内容和右侧内容之间独立的 8px Flex 子项，不受右侧内容覆盖                                            |
| 8    | 本地生成图片有时没有立即显示预览                                  | Windows runner 的本地结果未被明确要求以 Markdown 图片回传；此前错误地在产物架补了一张预览 | 已修复，待 Windows 实机回归 | 保留 macOS 的单一 Markdown 图片预览；私有 runtime skill 要求 Windows 对 `local_paths` 用相同路径回传            |
| 9    | `--team` 不被 oo CLI 识别；`OO_API_KEY` 下 `oo team use` 不持久化 | `--team` 与 API Key 下的默认团队持久化不属于 GPT Image 2 runner 所用 oo 命令的可用契约    | 已修复 Wanta 侧引导         | 私有 GPT Image 2 runtime skill 明确禁止该 runner 的原始 `--team`，并要求该场景用 `OO_TEAM_ID` 或 `OO_TEAM_NAME` |

## Windows 标题栏设计

右侧面板处于打开状态时，Windows 标题栏的目标结构如下：

```text
[主标题 / 常规操作] [浏览器（如有）] [充值/用量] [右侧面板收起] | [右侧面板]
```

右侧面板开关不再放在左侧栏，不再靠近最小化、最大化、关闭按钮，也不放入右侧面板自身的标题栏。这样即使 Windows 原生窗口控制区占用右上角，开关也始终保持在分割线左边且可见。

非 Windows 平台保持原有行为，避免改变 macOS 和 Linux 的标题栏布局。

## 关键实现

- Windows GPT Image 2 兼容补丁：`electron/skills/gpt-image-2-windows-runtime-fix.ts`
- GPT Image 2 兼容测试：`electron/skills/gpt-image-2-windows-runtime-fix.test.ts`
- Windows 标题栏开关可见性：`src/components/app-shell/app-shell-model.ts`
- 标题栏操作顺序和位置：`src/components/app-shell/AppShell.tsx`、`src/components/app-shell/AppShellMainTitlebar.tsx`、`src/styles/app-shell.css`
- 右侧面板和分割线布局：`src/components/app-shell/AppShellRightPanel.tsx`
- 拖拽宽度状态和收起逻辑：`src/components/app-shell/use-artifacts-panel-state.ts`
- 本地 Markdown 图片预览重试：`src/components/ai-elements/message-image.tsx`
- GPT Image 2 团队范围与本地图片交付引导：`electron/skills/gpt-image-2-windows-runtime-fix.ts`

## 验证结果

已完成以下检查：

- TypeScript 检查：`corepack pnpm run ts-check` 通过。
- 静态检查：`corepack pnpm run lint` 通过。
- 格式检查：本次修改的文件通过 `oxfmt --check`。
- Diff 检查：`git diff --check` 通过。
- 完整自动化测试：`345` 个测试文件通过，`2774` 个测试通过，`4` 个跳过。

新增或更新的测试覆盖了：

- 中文全角冒号下载路径解析；
- runner 重命名后的参数处理；
- raw `oo` 场景的团队范围引导和幂等注入；
- Windows 标题栏开关在右侧面板打开时仍可见；
- 非 Windows 平台不改变原有开关可见性；
- macOS 和 Windows 共用的本地 Markdown 图片交付指引；
- 本地图片预览的延迟重试边界。

## 遗留风险和验收建议

1. 当前开发机为 macOS，无法从本机完全验证 Windows 原生标题栏控制区与真实 DPI 缩放下的最终像素位置。Windows 安装包应至少在 100% 和 125% 缩放下验证开关位置。
2. 图片预览的时序容错和 Windows 图片交付指引已经修复，但应在 Windows 上真实执行一次 GPT Image 2 生成 PNG 的流程，确认图片写入完成后聊天区与 macOS 一样只显示一张 Markdown 图片预览、右侧产物面板可正常打开图片。
3. Wanta 已在私有 GPT Image 2 runtime skill 中给出当前 oo CLI 支持的调用方式；Wanta 不会尝试为不支持的原始 `--team` 参数造兼容层。若 oo CLI 后续新增契约，应由其维护方升级后再统一采用。

## Windows 验收清单

- 使用 GPT Image 2 连续生成至少 3 张 PNG。
- 确认中文系统输出 `已保存到：<路径>` 时 runner 返回成功。
- 将 runner 复制为其他 `.js` 文件名后再次执行，确认不会报位置参数错误。
- 打开右侧面板，确认开关显示在充值/用量右侧、分割线左侧。
- 点击开关，确认可以收起并再次打开右侧面板。
- 沿分割线拖动，确认指针在整个纵向 8px 命中区均能开始拖拽，且视觉线与面板左边界同步移动。
- 在 100%、125% Windows 显示缩放下重复标题栏与拖拽检查。
