# 聊天侧面预览优化与验证

本次修改针对同日审计报告中的 A1–A9，保留现有 Univer 工作簿交互、可信文件访问、HTML 沙箱和资源租约。

## 已实施的修改

| 审计项            | 修改后的行为                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1 压缩包处理预算 | 大于 64 MiB 的压缩包在可信快照复制前拒绝；ZIP 按需读取中央目录，最多解析 300 项；TAR/TGZ 达到 300 项、32 MiB 解压后输入或 1.5 秒解析预算即停止。无法确定总数时显示已列出数量。 |
| A2 失败缓存       | `read_failed`、`missing` 不进入长期成功缓存；重新选中文件会重新读取。缩略图 null/错误也不长期缓存。稳定的格式不支持仍可缓存。                                                  |
| A3 取消后重新订阅 | 不再复用已经 abort 的共享请求；Hook 按文件语义身份订阅，等价的新对象不触发重订阅。缩略图也使用对应规则。                                                                       |
| A4 旧请求写回     | 成功和失败回调均检查请求身份，已失效或被更新请求替代的结果无法覆盖当前缓存。                                                                                                   |
| A5 重试预算       | 每个失败周期最多自动重试一次，只有真实图片加载、媒体加载、PDF 首次成功渲染或 DOCX 完成渲染才恢复预算；提供显式重试入口。PDF 后续页的渲染事件不能反复补充额度。                 |
| A6 导航状态       | 外部 selection 作为打开/跳转命令应用一次；内部目录导航保留自己的选中项。切换 selection、卸载面板时使旧目录请求失效。                                                           |
| A7 预览实例       | XLSX/CSV/TSV 在文件切换和等待数据时复用 Univer host，替换工作簿并隔离旧内容；信息页保留实例。PDF/HTML 保持明确的视口高度，切换文件重置滚动位置。                               |
| A8 并发阻塞       | 前台预览使用 2 个槽位，原生缩略图使用独立的 4 个槽位。已启动的原生任务按真实完成时刻释放槽位，不虚假减少并发计数。同步抛错的 loader 也能正常释放槽位。                         |
| A9 冗余           | 移除 DOCX 重叠的 generation 判断、重复空值判断、不可达 HTML 提示；合并图片展示的恢复逻辑，保留图库原有外观与图片双击操作。                                                     |

预览状态由分散的 loading、preview、loadedKey 改为带文件 key 的联合类型，减少互相矛盾的状态组合。租约新鲜度检查收敛到缓存读取入口。ErrorBoundary 可按 resetKey 重置错误，而无需在正常文件切换时卸载健康子树。

## 实际 Electron 验证

通过项目 `dev:worktree` 启动开发构建，再用 Playwright 启动独立 Electron 测试配置，未使用或修改正式应用的用户配置。测试使用实际组件、Univer、PDF.js 和 docx-preview，以固定的合成数据代替 Chat IPC 返回值；这验证了真实渲染和组件生命周期，后台文件 I/O 另由单元测试覆盖。

- CSV → XLSX → 信息页 → 预览 → CSV：观察到 **1 个真实 Univer 实例**；运行时 host 始终保留；两个文件合计 **2 次 loader 调用**，返回已缓存文件不重读。
- PDF：合成的一页 PDF 正常渲染，页面内容区域高度 **627 CSS px**。
- HTML：iframe 高度 **667 CSS px**，按钮点击后文字发生预期变化，内联交互可用。
- DOCX：合成文档正文可见，实际执行 docx-preview 解包和渲染。
- 上述成功验证中未捕获到页面或渲染错误。

实际验证发现并修复了新增包装层导致 PDF 内容区域高度为零的问题；也修复了异步模块测试依赖固定等待时间的时序问题。

证据文件：

- [表格实例及请求计数](/Users/wushuang/code/wanta/artifacts/preview-optimization/electron-smoke.json)
- [PDF/HTML/DOCX 验证数据](/Users/wushuang/code/wanta/artifacts/preview-optimization/document-smoke.json)
- [切换信息页后的表格截图](/Users/wushuang/code/wanta/artifacts/preview-optimization/spreadsheet-after-info.png)
- [PDF 截图](/Users/wushuang/code/wanta/artifacts/preview-optimization/pdf.png)
- [HTML 截图](/Users/wushuang/code/wanta/artifacts/preview-optimization/html.png)
- [DOCX 截图](/Users/wushuang/code/wanta/artifacts/preview-optimization/docx.png)

## 边界与取舍

- **未增加 renderer → IPC 的通用取消协议。**原生缩略图仍不可中断，正在进行的普通文件读取也不是抢占式取消；本次通过独立并发池、解析预算和旧结果隔离降低影响。连续旧前台请求仍可能占用前台槽位，不能承诺任意慢文件都即时取消。
- 1.5 秒是解析阶段的协作式预算，不能抢占已经发出的文件系统读取，也不包含前面的可信快照复制；复制受 64 MiB 文件大小上限约束。
- 表格实例复用只覆盖当前挂载的表格预览。离开表格类型、关闭面板、切换主题/语言仍可以释放并重建实例。未引入全局 PDF/DOCX 实例缓存。
- TAR 在恰好 300 项时也保守显示未知总数；预览功能优先保证有限处理量。
- 没有引入网格虚拟化或通用状态机框架。未做真实超大 DOCX 的长任务与峰值内存基准，不提供未经测量的百分比提速。

## 最终自动化检查

- 全量测试：**389 个测试文件通过，2 个跳过；3137 项测试通过，4 项跳过**。
- `corepack pnpm run build:app`：通过，包含全项目 TypeScript 检查与 renderer/main/preload 生产构建。
- `corepack pnpm run lint`：通过。
- 修改文件格式检查与 `git diff --check`：通过。
- 生产构建仍提示部分 chunk 超过 500 kB，其中 Univer 仍以独立懒加载 chunk 提供；本次没有通过删除或替换 Univer 来降低包体积，也未做安装包签名、发布。

ZIP64 和 Unicode Path extra 字段已添加有界处理及兼容回归。针对带 401 个目录项和 2 MiB 文件正文的 ZIP，探针确认只读取目录前缀与尾部，不读取全部正文；TAR/TGZ 探针验证了达到预算后不再解析后续损坏条目。超预算可信文件的探针确认拒绝前未调用可信句柄读取，并正确关闭句柄。
