import type { AgentPermissionMode, ChatPermissionRequest } from "./common.ts"
import type { SessionPermissionGrant } from "./permission-request.ts"

function permissionReplyKey(sessionId: string, requestId: string): string {
  return `${sessionId}\n${requestId}`
}

/** 集中持有会话权限模式、临时 grant、pending request 与自动 reply 去重状态。 */
export class PermissionState {
  private readonly modes = new Map<string, AgentPermissionMode>()
  private readonly modeVersions = new Map<string, number>()
  private readonly grants = new Map<string, SessionPermissionGrant[]>()
  private readonly automaticReplies = new Set<string>()
  private readonly pendingRequests = new Map<string, ChatPermissionRequest>()

  public clear(): void {
    this.modes.clear()
    this.modeVersions.clear()
    this.grants.clear()
    this.automaticReplies.clear()
    this.pendingRequests.clear()
  }

  public mode(sessionId: string): AgentPermissionMode {
    return this.modes.get(sessionId) ?? "default"
  }

  public setMode(sessionId: string, mode: AgentPermissionMode, version?: number): boolean {
    if (typeof version === "number") {
      const currentVersion = this.modeVersions.get(sessionId) ?? 0
      if (version < currentVersion) {
        return false
      }
      this.modeVersions.set(sessionId, version)
    }
    this.modes.set(sessionId, mode)
    return true
  }

  public sessionGrants(sessionId: string): readonly SessionPermissionGrant[] | undefined {
    return this.grants.get(sessionId)
  }

  public addGrant(sessionId: string, grant: SessionPermissionGrant): boolean {
    const grants = this.grants.get(sessionId) ?? []
    const exists = grants.some(
      (item) =>
        item.action === grant.action &&
        item.kind === grant.kind &&
        item.patterns.join("\n") === grant.patterns.join("\n") &&
        item.generationId === grant.generationId &&
        item.projectRoot === grant.projectRoot &&
        item.processRoot === grant.processRoot,
    )
    if (exists) {
      return false
    }
    this.grants.set(sessionId, [...grants, grant])
    return true
  }

  public removeGenerationGrants(sessionId: string, generationId: string | undefined): void {
    if (!generationId) {
      return
    }
    const grants = this.grants.get(sessionId)
    if (!grants) {
      return
    }
    const retained = grants.filter((grant) => grant.generationId !== generationId)
    if (retained.length === grants.length) {
      return
    }
    if (retained.length > 0) {
      this.grants.set(sessionId, retained)
    } else {
      this.grants.delete(sessionId)
    }
  }

  public rememberPending(request: ChatPermissionRequest): void {
    this.pendingRequests.set(permissionReplyKey(request.sessionId, request.id), request)
  }

  public forgetPending(sessionId: string, requestId: string): void {
    this.pendingRequests.delete(permissionReplyKey(sessionId, requestId))
  }

  public forgetSessionPending(sessionId: string): void {
    for (const [key, request] of this.pendingRequests) {
      if (request.sessionId === sessionId) {
        this.pendingRequests.delete(key)
      }
    }
  }

  public pending(sessionId: string, requestId: string): ChatPermissionRequest | undefined {
    return this.pendingRequests.get(permissionReplyKey(sessionId, requestId))
  }

  public beginAutomaticReply(sessionId: string, requestId: string): boolean {
    const key = permissionReplyKey(sessionId, requestId)
    if (this.automaticReplies.has(key)) {
      return false
    }
    this.automaticReplies.add(key)
    return true
  }

  public endAutomaticReply(sessionId: string, requestId: string): void {
    this.automaticReplies.delete(permissionReplyKey(sessionId, requestId))
  }

  public copySession(parentSessionId: string, childSessionId: string): boolean {
    const mode = this.modes.get(parentSessionId)
    const version = this.modeVersions.get(parentSessionId)
    const grants = this.grants.get(parentSessionId)
    if (!mode && typeof version !== "number" && !grants) {
      return false
    }
    if (mode) {
      this.modes.set(childSessionId, mode)
    }
    if (typeof version === "number") {
      this.modeVersions.set(childSessionId, version)
    }
    if (grants) {
      this.grants.set(childSessionId, [...grants])
    }
    return true
  }

  public deleteSession(sessionId: string): void {
    this.modes.delete(sessionId)
    this.modeVersions.delete(sessionId)
    this.grants.delete(sessionId)
    this.forgetSessionPending(sessionId)
  }
}
