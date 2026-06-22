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
  for (const listener of listeners) {
    listener()
  }
}
