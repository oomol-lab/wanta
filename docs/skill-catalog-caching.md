# Skill Catalog 缓存设计

> 相关：[architecture.md](architecture.md)（渲染层直连请求边界）· [organization-skills-plan.md](organization-skills-plan.md)（组织 Skill 配置与 runtime 生效）

## 目标

Skill 页面、组织页面和连接器推荐会消费同一类 registry / search 数据。缓存必须在请求客户端统一处理，不能由每个页面分别维护 `useState + useEffect`，否则页面切换会产生重复请求，且同一 package 的详情会被不同入口重复读取。

缓存的目标是：

- 同一 app 会话内，同一 catalog key 只发起一次请求；并发消费者共享 in-flight promise。
- 公共市场、组织市场、Provider 推荐和精确包名查询复用同一份 package detail。
- 用户主动刷新、发布成功等明确变更才强制绕过或失效缓存。
- 账号私有的“我发布的”列表和 package detail 必须按账号隔离，不能被公共缓存或另一个账号复用。
- 已安装 Skill 是本地文件系统 inventory，不进入 catalog cache；它继续由主进程 watcher + 短 TTL resource 保证正确性。

## 分层与归属

```text
页面 / Dialog / Provider 推荐
          │
          ▼
src/lib/skills-catalog-client.ts
  - key 化缓存
  - in-flight 去重
  - TTL / 精确失效
          │
          ├── search.<endpoint>（公共列表、搜索、我的发布）
          └── registry.<endpoint>（package detail）
```

缓存放在 `skills-catalog-client.ts`，因为这些请求都在渲染层以 httpOnly session cookie 直连；不引入主进程转发，也不将 token 带到渲染层。

## 缓存 scope 与 TTL

| 数据                       | key scope                                    |                           TTL | 说明                                      |
| -------------------------- | -------------------------------------------- | ----------------------------: | ----------------------------------------- |
| 公共市场列表 / 分页        | `public:list:{next,size}`                    |                        5 分钟 | 技能页与组织市场共享                      |
| 公共市场搜索               | `search:skills:{query,next,size}`            |                        2 分钟 | 搜索输入会变化较快                        |
| 公共 package detail        | `public:package:{name,version}`              |                       10 分钟 | 精确包名查询、搜索补全、Provider 推荐共享 |
| 我的发布列表               | `my:{accountId}:{next}`                      |                        2 分钟 | 仅账号隔离的内存缓存                      |
| 我的发布 package detail    | `account:{accountId}:package:{name,version}` |                       10 分钟 | 绝不复用到其他账号                        |
| Provider → package 解析    | `service + provider displayName`             |                       10 分钟 | 找不到 package 仍保留 24 小时负缓存       |
| 组织 Skill 配置            | `accountId + organizationId`                 | 30 秒新鲜期 / 24 小时本地保留 | 见 `useOrganizationSkills.ts`             |
| 本机已安装 Skill inventory | 全局 resource                                |                         60 秒 | 本地扫描，不是市场 catalog                |

## 失效规则

- 发布 Skill 成功：失效当前账号的“我发布的”列表和私有 package detail，以及公共市场 / 搜索缓存。
- 登录、登出或切换账号：清空整个会话级 catalog cache，避免任何可能受权限影响的 package 响应展示给另一账号。
- 安装、更新、删除本机 Skill：只更新 `skillInventory`，不失效市场 catalog。
- 组织配置增删改：失效当前组织配置缓存；不失效公共 market 数据。
- 连接器集合变化：Provider 推荐层按候选 provider key 重新计算；公共 package detail 继续复用。
- 用户显式刷新：调用方传 `forceRefresh`，客户端重新请求该 key。

## 非目标

- 不将公共市场 list 持久化到磁盘。公共 catalog 的实时性比跨重启复用更重要；页面切换和多入口重复请求由会话级共享缓存解决。
- 不以“打开页面”作为强制刷新条件。打开 Market tab 只读取缓存；仅缓存过期、查询变化或显式刷新才请求网络。
- 不把组织 Skill artifact/runtime 同步混入 catalog cache。那一层依赖 `resolved` artifact、checksum 和主进程私有目录，属于后续 runtime 同步工作。
