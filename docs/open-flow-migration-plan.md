# Console 工作流迁入 Wanta 的计划

日期：2026-09-29。以下为初始移植计划；组件接入与宿主适配已落地，实施和验证记录见文末。

## 目标与界面位置

在 Wanta 左侧导航的“知识库”下方新增同级“工作流”入口，打开原生 React 工作台。这里将“知识库下面”理解为导航顺序，而不是把工作流数据并入知识库、添加知识库子菜单或把工作流源码放进 Knowledge 模块。

保留 Console 现有的工作流列表、设计、发布、运行和变量能力，继续使用同一套团队云端工作流服务。当前计划不迁移工作流后端或在 Electron 内实现本地执行引擎。

## 源码调查结论

Console 的业务界面主要来自 `@oomol-lab/open-flow/workbench` 的 `OpenFlowWorkbench`，Console 自己负责宿主适配。

| Console 源文件                                 | 职责                                         | Wanta 处理方式                                        |
| ---------------------------------------------- | -------------------------------------------- | ----------------------------------------------------- |
| `src/pages/open-flow-workbench.tsx`            | 装配工作台，传入团队、语言、主题、位置与导航 | 改为 `src/routes/Flows/index.tsx`，接入 Wanta 状态    |
| `src/pages/open-flow-workbench-host.ts`        | HTTP、通知、外部页面、WebSocket、偏好存储    | 复用结构与事件过滤逻辑，替换宿主相关行为              |
| `src/pages/open-flow-workbench-route.ts`       | `design/publications/runs` 的位置与路径转换  | 保留位置模型；按 Wanta 内部状态导航改写               |
| `src/pages/open-flow-workbench-loading.tsx`    | 页面加载占位                                 | 使用 Wanta 的加载组件与布局                           |
| 相应 `host.test.ts`、`route.test.ts`           | 请求保真、团队隔离、订阅、重连与路径校验     | 迁入适用案例并针对 Wanta 扩充                         |
| `src/lib/wanta-flow.ts` 与 Console Wanta panel | iframe 消息桥，向嵌入的 Wanta 返回当前工作流 | 原生页面首期无需迁入；后续 Agent 联动使用类型化上下文 |

Wanta 已有 React 19、Tailwind 4、Sonner、团队选择、HttpOnly 会话 cookie 和 renderer 直连请求底座，适合组件级嵌入。无需搬入 Console 的 Router、Query Provider、整个页面壳或 Base UI 组件目录。

### 版本前置问题

Console 的 `package.json` 与 `package-lock.json` 声明 `0.1.0-beta.47`，但本机 `node_modules` 实际安装的是 `0.1.0-beta.36`；相邻 `open-flow` 仓库包声明为 `beta.10`，接口也与 Console 使用方式存在差异。

实施以 Console 锁文件版本 `beta.47` 为候选基线，先检查该发布包的实际 exports、类型、资源和 peer dependencies，再精确锁定 Wanta 的包版本。当前已安装包与 Console 锁文件均显示 `effect@4.0.0-rc.112` 为 peer dependency，React 19 在支持范围内。不要用邻接源码目录的相对路径作为正式依赖，也不要根据旧安装包保证新版本接口一致。

## 适配设计

### 1. 页面与导航

- `AppShellRoute` 增加 `flows`；侧栏紧接知识库增加工作流入口。
- 扩展 `initialRoute()`、`routeAvailableForRuntime()` 和标题栏标题映射，支持开发环境直接进入工作流。
- `AppShell.tsx` 懒加载 `FlowsRoute`，传入当前账号、团队和必要宿主回调。
- 使用 `WorkbenchLocation = { flowId?, view }` 保存列表/设计/发布/运行位置，由 `onNavigate` 更新；Wanta 当前无 Router，不为此引入 `react-router-dom`。
- 首期不增加应用级 URL 深链接。`hrefFor` 与组件内部链接点击行为必须一起核对，确保内部跳转不会触发 Electron 的外链拦截。
- 页面按 Wanta 可用内容区使用 `h-full/min-h-0`，去掉 Console 的固定顶栏高度计算。核对右侧面板和标题栏行为，不把聊天的项目编辑状态带入工作流标题栏。

### 2. 账号、团队与访问控制

- 工作流请求用 `x-oo-team-name`，来自实际团队的 `team.name`；知识库用 `x-oo-team-id`，不能混用。
- 页面实例、请求状态、订阅与偏好以账号和团队隔离；持久偏好建议同时包含 endpoint、账号 ID 和稳定团队 ID。
- 团队切换、换号、退出登录、页面卸载时，关闭旧订阅、取消可取消请求、清除旧通知，并避免迟到响应覆盖新作用域。
- 列表与工作台初始位置按作用域管理；进入另一个团队时默认回到该团队列表，不携带原团队 flow ID。
- 沿用 Wanta 当前云端页面能力门禁。工作流云端管理与 Agent 的 Link 选择是不同能力；需要配置连接的动作再接入对应 OOMOL 连接入口。
- 暂停团队、访客及只读团队的权限必须对照服务端工作流权限验证。当前已安装组件没有通用 `readOnly` prop，不能仅靠 `canManage` 假设覆盖了编辑/发布/运行权限；若目标版本也缺少支持，先定义受限访问策略或补共享组件能力。

### 3. HTTP 与会话

- 在 `electron/domain.ts` 增加 `openFlowBaseUrl = https://open-flow.${ooEndpoint}`，renderer 从 `src/lib/domain.ts` 引用。
- host 请求适配 Wanta `oomolFetch`，保持返回原始 `Response` 的契约；保留 `Request` 与 `init` 的 method、body、headers、signal 及覆盖优先级。
- `oomolFetch` 当前只接受 string/URL，因此需要在 host 做完整 Request 归一化，或审慎扩展公共底座并补回归测试。
- 使用现有 HttpOnly cookie 与 `credentials: include`；401 接入 Wanta 的恢复登录事件，移除 Console 的网页登录重定向和本地代理注入。
- 请求限制到派生的工作流服务 origin，避免把团队标识误发到其他目标。长时间操作按实际 API 契约配置超时，不能一律套用默认 15 秒。

### 4. 实时通知

- 迁入 catalog 和当前工作流两类 WebSocket，以及事件版本/flow ID 校验、退避重连、`ready` 与 `stop` 行为。
- 从统一 endpoint 构造 WSS 地址；删除 Console 开发环境固定 `localhost:5176` 的分支。
- 实测 Electron 开发与打包环境的 WebSocket cookie、Origin 和服务器握手行为。现有 HTTP CORS shim 不能证明 WebSocket 一定可用。
- 如果服务端拒绝 Electron Origin，优先修正明确受信任的服务端 Origin 策略；确有必要时才设计主进程订阅桥，并保持凭证不进入 renderer。
- 重连成功重新同步；卸载后不再重连。草稿、运行变化和跨窗口变更验证以真实服务为准。

### 5. 外部页面与连接配置

Console 的 `openExternalPage` 先 `window.open('about:blank')` 再异步设置 URL。Wanta 的主窗口拦截新窗口并转交系统浏览器，此流程不能照搬。

新 host 先解析最终 URL，再通过 Wanta 现有外链机制打开，并按契约明确返回值与失败处理；若现有桥无法报告打开成功，需要补一个最小的类型化宿主能力。只允许现有外链协议策略，失败显示可操作错误。

核对目标组件版本的 `onConfigureConnector`、`onManageConnectorAccess` 等回调，能接入时复用现有 Connections 入口；新授权完成后验证工作台连接信息刷新。

### 6. 样式、语言与打包

- 懒加载工作台 JS 与 CSS，降低聊天首屏负担。
- Wanta 外壳继续使用自身组件与 tokens；工作台内部使用包自带样式，检查弹层、字体、滚动、canvas、暗色与快捷键作用范围。
- Wanta 页面新增文案同步全部八种语言；工作台用包支持的语言集合映射，不支持的语言回落英文。
- 核查发布包内部 CSS、图标、代码编辑器 Worker 等资源是否自包含，验证 Vite 构建及 Electron `file://` 下资源路径。不能用开发服务器成功代替打包成功。
- 工作台 CSS 或内部实现需要修复时，优先在共享包修复并升级版本，避免在 Wanta 复制整套内部源码。

## 实施阶段与验收

| 阶段              | 交付内容                                                         | 验收条件                                                                       |
| ----------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 0. 依赖与网络探针 | 确认 beta.47 发布包、锁定依赖，最小工作台装配，HTTP/WSS/外链探针 | 目标版本类型契约清楚；登录后列表请求与订阅握手可用；打包资源可加载             |
| 1. 页面壳         | 导航、路由状态、标题、语言、主题、作用域生命周期                 | 知识库下方可进入工作流；团队/账号切换没有串数据；离开再进入行为确定            |
| 2. 工作台功能     | 完整 host 与设计/发布/运行/变量接入                              | 创建、编辑、保存、重新打开、发布、运行、日志/结果和变量按 Console 现有能力工作 |
| 3. 桌面收尾       | 外链与授权、断线恢复、权限、样式与打包处理                       | 开发和打包版本均通过核心操作；401/403、删除、退出与切换状态可靠                |

建议新增文件：

```text
src/routes/Flows/
  index.tsx
  host.ts
  location.ts
  preferences.ts
  host.test.ts
  location.test.ts
  index.test.tsx
```

建议修改：`package.json`、`pnpm-lock.yaml`、`electron/domain.ts`、AppShell 的 types/model/navigation/render 分支，以及 `src/i18n` 文案。只有验证表明必要时才修改 main/preload 或 Vite 配置。

测试重点：Request 保真、401 恢复、团队名编码与作用域隔离、订阅清理与重连、内部导航、外链失败及权限行为。执行 `pnpm run ts-check`、相关 Vitest、`pnpm run i18n:check`、lint/format 检查与 `pnpm run build`。按照项目开发调试指南，用真实 Electron 运行和日志/截图证据验证 UI，并补打包环境验证。

离开编辑器、切换团队及关闭窗口时的草稿保存行为是重点：先验证共享工作台的保存/销毁语义，再决定是否需要保存等待或提示，不能凭组件卸载假设草稿已保存。

## 后续可独立推进的 Agent 联动

首期完成工作台移植。后续可让聊天理解“当前工作流”：通过 Wanta 类型化上下文绑定 endpoint/账号/团队/flow ID，明确用户选中的对象，再接入已有 oo Flow 能力。需要遵守宿主上下文和各 Agent adapter 的能力一致性规则；不依赖 Console iframe 的 postMessage 桥，也不让 Agent 猜 flow ID。该联动不作为首期工作台可用的前置条件。

## 当前评估

属于工作台组件接入和桌面宿主适配，前端业务重写量相对有限。主要不确定性是目标包版本契约、WebSocket 在 Electron 中的鉴权与 Origin、外部授权打开、保存生命周期和细粒度权限。阶段 0 解决这些问题后，再给出可靠工时估算与具体任务拆分。

## 实施记录（2026-09-29）

- 新增 `src/routes/Flows` 原生工作台、知识库下方入口、内部导航和云端能力门禁。
- 精确锁定 `@oomol-lab/open-flow@0.1.0-beta.47` 与 `effect@4.0.0-rc.112`。
- 完成 HTTP Request 兼容、cookie 鉴权、团队名绑定、账号/团队隔离、只读写入拦截、外链打开与 WSS 订阅适配。
- 覆盖 beta.47 新增的 `flow.created/run.changed/access.changed` 通知。
- 页面离开时保留同团队工作台，支持连接配置后返回；账号/团队变化清理旧实例。语言切换不重建编辑器。
- 新增八种语言文案、桌面宽度下的紧凑列表样式与开发依赖预构建。
- 类型检查、相关 lint/format、国际化检查、生产构建和 147 项相关测试通过（包括已有知识库与连接请求回归）。
- 在真实 Electron 开发窗口中验证了列表、设计器、草稿 HTTP 200 和工作流 WSS 101 握手。
- 使用独立测试 profile，将仓库相对路径 `dist/index.html` 从各自的本地 checkout 解析为绝对 `file://` URL 后加载生产构建，验证列表、设计器、两个团队的切换及工作台往返保留。
- 在 `laicai` 团队新建 `Wanta migration smoke 20260929` 验证草稿，添加手动触发节点，草稿保存成功；运行记录显示成功、67ms，运行 ID 为 `01a0edc4-8ddb-7695-ae4b-324c215dc9af`，输出与时间线可查看。测试草稿保留为复验样例，没有线上发布或自动触发器。
- 发布确认界面已验证并取消；未进行实际线上发布、外部 SaaS 新授权、签名安装包或 Windows/Linux 发行验证。上述操作不影响本次原生工作台代码接入完成，但不能将其描述为已经端到端实测。

维护说明见 `docs/ai/flows.md`。Agent 当前工作流上下文继续作为独立后续阶段。
