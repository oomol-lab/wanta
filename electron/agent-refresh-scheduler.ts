export interface AgentRefreshSchedulerOptions {
  canRefresh: () => boolean
  isBusy: () => boolean
  isQuitting: () => boolean
  refresh: (reason: string) => Promise<void>
}

/** Skill 变更后延迟重启 Agent；优先避开正在运行的 generation，但不会无限等待。 */
export class AgentRefreshScheduler {
  private pending: NodeJS.Timeout | undefined
  private readonly options: AgentRefreshSchedulerOptions

  public constructor(options: AgentRefreshSchedulerOptions) {
    this.options = options
  }

  public schedule(reason: string, delayMs = 1_500, busyRetryCount = 0): void {
    if (this.options.isQuitting()) return
    if (this.pending) clearTimeout(this.pending)
    this.pending = setTimeout(() => {
      this.pending = undefined
      this.refresh(reason, busyRetryCount)
    }, delayMs)
    this.pending.unref()
  }

  public dispose(): void {
    if (this.pending) clearTimeout(this.pending)
    this.pending = undefined
  }

  private refresh(reason: string, busyRetryCount: number): void {
    if (this.options.isQuitting() || !this.options.canRefresh()) return
    if (this.options.isBusy()) {
      if (busyRetryCount < 10) {
        this.schedule(reason, 2_000, busyRetryCount + 1)
        return
      }
      console.warn("[wanta] refreshing agent after skill change while generation is still active:", {
        busyRetryCount,
        reason,
      })
    }
    void this.options.refresh(reason).catch((error: unknown) => {
      console.error("[wanta] failed to restart agent after skill change:", { error, reason })
    })
  }
}
