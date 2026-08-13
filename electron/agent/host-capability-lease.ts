import type { HostCapabilityContext } from "./host-capability.ts"

import { randomUUID } from "node:crypto"

export type HostCapabilityLeaseStatus = "active" | "disabled" | "revoked"

export interface HostCapabilityLeaseSnapshot {
  id: string
  issuedAt: number
  sessionId: string
  status: HostCapabilityLeaseStatus
  updatedAt: number
}

/** Mutable session lease whose context is refreshed before every agent turn. */
export class HostCapabilityLease {
  private contextValue: HostCapabilityContext | null
  private readonly idValue = randomUUID()
  private readonly issuedAtValue = Date.now()
  private statusValue: HostCapabilityLeaseStatus = "active"
  private readonly sessionIdValue: string
  private updatedAtValue = this.issuedAtValue

  public constructor(context: HostCapabilityContext) {
    this.contextValue = context
    this.sessionIdValue = context.sessionId
  }

  public get sessionId(): string {
    return this.sessionIdValue
  }

  public update(context: HostCapabilityContext): void {
    if (this.statusValue === "revoked") throw new Error("Host capability lease has been revoked.")
    if (context.sessionId !== this.sessionIdValue) {
      throw new Error("Host capability lease cannot change session identity.")
    }
    this.contextValue = context
    this.statusValue = "active"
    this.updatedAtValue = Date.now()
  }

  public context(): HostCapabilityContext {
    if (this.statusValue !== "active" || !this.contextValue) {
      throw new Error("Wanta host capability context is unavailable.")
    }
    return this.contextValue
  }

  public disable(): void {
    if (this.statusValue === "revoked") return
    this.contextValue = null
    this.statusValue = "disabled"
    this.updatedAtValue = Date.now()
  }

  public revoke(): void {
    this.contextValue = null
    this.statusValue = "revoked"
    this.updatedAtValue = Date.now()
  }

  public snapshot(): HostCapabilityLeaseSnapshot {
    return {
      id: this.idValue,
      issuedAt: this.issuedAtValue,
      sessionId: this.sessionId,
      status: this.statusValue,
      updatedAt: this.updatedAtValue,
    }
  }
}
