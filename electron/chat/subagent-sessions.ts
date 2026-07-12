import type { ChatEmit } from "../agent/event-translator.ts"
import type { PermissionState } from "./permission-state.ts"
import type { TrustedLocalAccess } from "./trusted-local-access.ts"

export class SubagentSessions {
  private childSessionsByParent = new Map<string, Set<string>>()
  private parentSessionByChild = new Map<string, string>()
  private trustedSessionsByParent = new Map<string, Set<string>>()
  private readonly permissions: PermissionState
  private readonly trustedAccess: TrustedLocalAccess

  public constructor(permissions: PermissionState, trustedAccess: TrustedLocalAccess) {
    this.permissions = permissions
    this.trustedAccess = trustedAccess
  }

  public clear(): void {
    this.childSessionsByParent.clear()
    this.parentSessionByChild.clear()
    this.trustedSessionsByParent.clear()
  }

  public remember(parentSessionId: string, childSessionId: string): void {
    const childSessionIds = this.childSessionsByParent.get(parentSessionId) ?? new Set<string>()
    childSessionIds.add(childSessionId)
    this.childSessionsByParent.set(parentSessionId, childSessionIds)
    this.parentSessionByChild.set(childSessionId, parentSessionId)

    const copiedPermissionState = this.permissions.copySession(parentSessionId, childSessionId)
    const copiedLocalAccess = this.trustedAccess.copySession(parentSessionId, childSessionId)
    if (!copiedPermissionState && !copiedLocalAccess) return
    const trustedSessionIds = this.trustedSessionsByParent.get(parentSessionId) ?? new Set<string>()
    trustedSessionIds.add(childSessionId)
    this.trustedSessionsByParent.set(parentSessionId, trustedSessionIds)
  }

  public forget(parentSessionId: string, childSessionId: string): void {
    const childSessionIds = this.childSessionsByParent.get(parentSessionId)
    childSessionIds?.delete(childSessionId)
    if (childSessionIds?.size === 0) this.childSessionsByParent.delete(parentSessionId)
    if (this.parentSessionByChild.get(childSessionId) === parentSessionId) {
      this.parentSessionByChild.delete(childSessionId)
    }

    const trustedSessionIds = this.trustedSessionsByParent.get(parentSessionId)
    if (!trustedSessionIds?.delete(childSessionId)) return
    this.permissions.deleteSession(childSessionId)
    this.trustedAccess.deleteSession(childSessionId)
    if (trustedSessionIds.size === 0) this.trustedSessionsByParent.delete(parentSessionId)
  }

  public forgetAll(parentSessionId: string): void {
    for (const childSessionId of this.childSessionsByParent.get(parentSessionId) ?? []) {
      if (this.parentSessionByChild.get(childSessionId) === parentSessionId) {
        this.parentSessionByChild.delete(childSessionId)
      }
    }
    this.childSessionsByParent.delete(parentSessionId)

    for (const childSessionId of this.trustedSessionsByParent.get(parentSessionId) ?? []) {
      this.permissions.deleteSession(childSessionId)
      this.trustedAccess.deleteSession(childSessionId)
    }
    this.trustedSessionsByParent.delete(parentSessionId)
  }

  public forDisplay(translated: ChatEmit): ChatEmit {
    const sessionId = translated.data.sessionId
    if (!sessionId) return translated
    const displaySessionId = this.displaySessionId(sessionId)
    if (displaySessionId === sessionId) return translated
    switch (translated.event) {
      case "permissionAsked":
        return {
          ...translated,
          data: {
            sessionId: displaySessionId,
            request: { ...translated.data.request, sessionId: displaySessionId },
          },
        }
      case "questionAsked":
        return {
          ...translated,
          data: {
            sessionId: displaySessionId,
            request: { ...translated.data.request, sessionId: displaySessionId },
          },
        }
      case "permissionReplied":
      case "questionRejected":
      case "questionReplied":
        return { ...translated, data: { ...translated.data, sessionId: displaySessionId } }
      default:
        return translated
    }
  }

  public displaySessionId(sessionId: string): string {
    return this.parentSessionByChild.get(sessionId) ?? sessionId
  }

  public parentSessionId(childSessionId: string): string | undefined {
    return this.parentSessionByChild.get(childSessionId)
  }

  public childSessionIds(parentSessionId: string): string[] {
    return [...(this.childSessionsByParent.get(parentSessionId) ?? [])]
  }

  public trustedChildSessionIds(parentSessionId: string): string[] {
    return [...(this.trustedSessionsByParent.get(parentSessionId) ?? [])]
  }
}
