// 组织数据变更的渲染层进程内事件总线：替代原先主进程 OrganizationsService 的 organizationChanged
// RPC 广播。组织相关请求搬到渲染层后，跨组件同步（如 OrganizationManagement 建组后通知 AppShell 的
// useOrganizationWorkspace 刷新）不再需要跨进程事件，进程内订阅即可。

type OrganizationChangeListener = () => void

const listeners = new Set<OrganizationChangeListener>()

export function onOrganizationChanged(listener: OrganizationChangeListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitOrganizationChanged(): void {
  // 逐个隔离异常：单个 listener 抛错不应中断后续广播（否则会出现"部分组件未刷新"）。
  for (const listener of listeners) {
    try {
      listener()
    } catch (error) {
      console.error("[lumo] organization change listener failed:", error)
    }
  }
}
