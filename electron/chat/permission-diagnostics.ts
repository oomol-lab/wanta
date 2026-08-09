import type { LocalPermissionPromptReason } from "./common.ts"

export type AutomaticPermissionOutcome = "failed" | "first_attempt" | "reconciled" | "retry_succeeded"

export interface PermissionDiagnosticsSnapshot {
  automaticReplies: Record<AutomaticPermissionOutcome, number>
  prompts: Partial<Record<LocalPermissionPromptReason, number>>
}

export class PermissionDiagnostics {
  private readonly promptCounts = new Map<LocalPermissionPromptReason, number>()
  private readonly promptRequestKeys = new Set<string>()
  private readonly promptRequestOrder: string[] = []
  private readonly automaticReplyCounts: Record<AutomaticPermissionOutcome, number> = {
    failed: 0,
    first_attempt: 0,
    reconciled: 0,
    retry_succeeded: 0,
  }

  public recordPrompt(reason: LocalPermissionPromptReason, requestKey?: string): void {
    if (requestKey) {
      if (this.promptRequestKeys.has(requestKey)) return
      this.promptRequestKeys.add(requestKey)
      this.promptRequestOrder.push(requestKey)
      const oldest = this.promptRequestOrder.length > 1_000 ? this.promptRequestOrder.shift() : undefined
      if (oldest) this.promptRequestKeys.delete(oldest)
    }
    this.promptCounts.set(reason, (this.promptCounts.get(reason) ?? 0) + 1)
  }

  public recordAutomaticReply(outcome: AutomaticPermissionOutcome): void {
    this.automaticReplyCounts[outcome] += 1
  }

  public snapshot(): PermissionDiagnosticsSnapshot {
    return {
      automaticReplies: { ...this.automaticReplyCounts },
      prompts: Object.fromEntries(
        [...this.promptCounts.entries()].sort(([left], [right]) => left.localeCompare(right)),
      ),
    }
  }
}
