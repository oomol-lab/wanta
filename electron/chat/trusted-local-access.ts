import type { ChatAttachment, ChatMessage, ChatPermissionRequest } from "./common.ts"

import { realpath } from "node:fs/promises"
import os from "node:os"
import { logDiagnostic } from "../diagnostics-log.ts"
import { normalizeLocalPathCandidate } from "./artifacts.ts"
import { isPathInside } from "./turn-output-files.ts"

const rootsCacheMs = 1_000

export interface TrustedLocalAccessOptions {
  loadAdditionalRoots: () => Promise<Iterable<string>>
  trustedAttachmentPaths?: ReadonlySet<string>
}

/** 汇总会话明确授权的本地路径，并统一处理 realpath、缓存失效与路径包含校验。 */
export class TrustedLocalAccess {
  private readonly projectRoots = new Map<string, string>()
  private readonly attachmentPaths = new Map<string, Set<string>>()
  private readonly permissionPaths = new Map<string, Set<string>>()
  private readonly options: TrustedLocalAccessOptions
  private cache: { expiresAt: number; roots: string[] } | undefined
  private generation = 0

  public constructor(options: TrustedLocalAccessOptions) {
    this.options = options
  }

  public clear(): void {
    this.projectRoots.clear()
    this.attachmentPaths.clear()
    this.permissionPaths.clear()
    this.invalidate()
  }

  public projectRoot(sessionId: string): string | undefined {
    return this.projectRoots.get(sessionId)
  }

  public setProjectRoot(sessionId: string, projectRoot: string | undefined): void {
    if (projectRoot) {
      this.projectRoots.set(sessionId, projectRoot)
    } else {
      this.projectRoots.delete(sessionId)
    }
    this.invalidate()
  }

  public copySession(parentSessionId: string, childSessionId: string): boolean {
    const projectRoot = this.projectRoots.get(parentSessionId)
    const permissionPaths = this.permissionPaths.get(parentSessionId)
    if (!projectRoot && !permissionPaths) {
      return false
    }
    if (projectRoot) {
      this.projectRoots.set(childSessionId, projectRoot)
    }
    if (permissionPaths) {
      this.permissionPaths.set(childSessionId, new Set(permissionPaths))
    }
    this.invalidate()
    return true
  }

  public deleteSession(sessionId: string): void {
    this.projectRoots.delete(sessionId)
    this.attachmentPaths.delete(sessionId)
    this.permissionPaths.delete(sessionId)
    this.invalidate()
  }

  public rememberAttachments(sessionId: string, attachments: readonly ChatAttachment[] | undefined): void {
    if (!attachments?.length) {
      return
    }
    const paths = this.attachmentPaths.get(sessionId) ?? new Set<string>()
    for (const attachment of attachments) {
      if (attachment.path.trim()) {
        paths.add(attachment.path)
      }
      if (attachment.agentPath?.trim()) {
        paths.add(attachment.agentPath)
      }
    }
    if (paths.size > 0) {
      this.attachmentPaths.set(sessionId, paths)
      this.invalidate()
    }
  }

  public rememberMessageAttachments(sessionId: string, messages: readonly ChatMessage[]): void {
    const attachments: ChatAttachment[] = []
    for (const message of messages) {
      if (message.role !== "user") {
        continue
      }
      for (const part of message.parts) {
        if (part.kind === "attachment" && part.attachment) {
          attachments.push(part.attachment)
        }
      }
    }
    this.rememberAttachments(sessionId, attachments)
  }

  public rememberPermissionResources(sessionId: string, request: ChatPermissionRequest): void {
    const paths = this.permissionPaths.get(sessionId) ?? new Set<string>()
    for (const resource of [...request.resources, ...(request.save ?? [])]) {
      const wildcardIndex = resource.search(/[*?[\]{}]/u)
      const candidate = wildcardIndex === -1 ? resource : resource.slice(0, wildcardIndex).replace(/[\\/]+$/u, "")
      const filePath = normalizeLocalPathCandidate(candidate, os.homedir())
      if (filePath) {
        paths.add(filePath)
      }
    }
    if (paths.size > 0) {
      this.permissionPaths.set(sessionId, paths)
      this.invalidate()
    }
  }

  public invalidate(): void {
    this.generation += 1
    this.cache = undefined
  }

  public async roots(): Promise<string[]> {
    const cached = this.cache
    if (cached && cached.expiresAt > Date.now()) {
      return cached.roots
    }
    const generation = this.generation
    const roots = new Set<string>()
    for (const projectRoot of this.projectRoots.values()) {
      roots.add(projectRoot)
    }
    for (const paths of this.attachmentPaths.values()) {
      for (const filePath of paths) {
        roots.add(filePath)
      }
    }
    for (const filePath of this.options.trustedAttachmentPaths ?? []) {
      roots.add(filePath)
    }
    for (const paths of this.permissionPaths.values()) {
      for (const filePath of paths) {
        roots.add(filePath)
      }
    }
    try {
      for (const root of await this.options.loadAdditionalRoots()) {
        roots.add(root)
      }
    } catch (error) {
      console.warn("[wanta] failed to read trusted local roots:", error)
      logDiagnostic("chat-service", "failed to read trusted local roots", { error }, "warn")
    }
    const normalizedRoots = (
      await Promise.all([...roots].filter((root) => root.trim()).map((root) => realpath(root).catch(() => null)))
    ).filter((root): root is string => Boolean(root))
    if (this.generation !== generation) {
      return this.roots()
    }
    this.cache = { expiresAt: Date.now() + rootsCacheMs, roots: normalizedRoots }
    return normalizedRoots
  }

  public async isPathInRoots(filePath: string, roots: readonly string[]): Promise<boolean> {
    const target = await realpath(filePath).catch(() => null)
    return Boolean(target && roots.some((root) => isPathInside(root, target)))
  }

  public async assertPath(filePath: string): Promise<void> {
    if (!(await this.isPathInRoots(filePath, await this.roots()))) {
      throw new Error("Local path is not available from this conversation.")
    }
  }
}
