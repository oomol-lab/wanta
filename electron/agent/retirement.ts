export interface DisposableAgentRuntime {
  dispose(): Promise<void>
}

/**
 * 跟踪已退出前台引用、但进程树仍在后台回收的 Agent。
 * shutdown 必须 drain 全部任务，避免旧 sidecar 在主进程退出时被遗留给 launchd。
 */
export class AgentRetirementPool {
  private readonly pending = new Set<Promise<void>>()

  public get size(): number {
    return this.pending.size
  }

  public retire(runtime: DisposableAgentRuntime): Promise<void> {
    const disposal = Promise.resolve().then(() => runtime.dispose())
    const tracked = disposal.finally(() => {
      this.pending.delete(tracked)
    })
    this.pending.add(tracked)
    return tracked
  }

  public async drain(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled(this.pending)
    }
  }
}
