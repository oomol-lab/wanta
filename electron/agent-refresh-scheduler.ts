export interface AgentRefreshSchedulerOptions {
  canRefresh: () => boolean
  isBusy: () => boolean
  isQuitting: () => boolean
  refresh: (reason: string) => Promise<void>
}

/** 运行时配置变更后延迟重启 Agent；正在运行 generation 时保持 pending，绝不静默打断任务。 */
export class AgentRefreshScheduler {
  private pending: NodeJS.Timeout | undefined
  private readonly options: AgentRefreshSchedulerOptions

  public constructor(options: AgentRefreshSchedulerOptions) {
    this.options = options
  }

  public schedule(reason: string, delayMs = 1_500): void {
    if (this.options.isQuitting()) return
    if (this.pending) clearTimeout(this.pending)
    this.pending = setTimeout(() => {
      this.pending = undefined
      this.refresh(reason)
    }, delayMs)
    this.pending.unref()
  }

  public dispose(): void {
    if (this.pending) clearTimeout(this.pending)
    this.pending = undefined
  }

  private refresh(reason: string): void {
    if (this.options.isQuitting() || !this.options.canRefresh()) return
    if (this.options.isBusy()) {
      this.schedule(reason, 2_000)
      return
    }
    void this.options.refresh(reason).catch((error: unknown) => {
      console.error("[wanta] failed to restart agent after runtime configuration change:", { error, reason })
    })
  }
}
