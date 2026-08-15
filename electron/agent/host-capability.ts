import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js"
import type { z } from "zod"

export interface HostCapabilityContext {
  sessionId: string
  turnId?: string
  teamName?: string
  projectRoot?: string
  artifactDir?: string
  processDir?: string
  bindings: Readonly<Record<string, unknown>>
}

export interface HostToolResult {
  text: string
  /** Optional MCP-native rich content. `text` remains the portable fallback and sidecar result. */
  content?: readonly HostToolContent[]
}

export type HostToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource_link"; name: string; uri: string; mimeType?: string; description?: string }

export interface HostToolDefinition {
  name: string
  description: string
  /** MCP-native safety hints; host enforcement never relies on these hints. */
  annotations?: ToolAnnotations
  inputSchema: z.ZodObject
  execute: (
    context: HostCapabilityContext,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<HostToolResult>
}

export interface HostCapability {
  id: string
  version: string
  instructions?: string
  tools: readonly HostToolDefinition[]
}

export interface HostCapabilityAuditRecord {
  capability: string
  durationMs: number
  outcome: "error" | "success" | "validation_error"
  sessionId: string
  tool: string
  turnId?: string
}

export interface HostCapabilityKernelOptions {
  onAudit?: (record: HostCapabilityAuditRecord) => void
}

/** Agent-independent registry and execution boundary for Wanta-owned tools. */
export class HostCapabilityKernel {
  private readonly capabilities = new Map<string, HostCapability>()
  private readonly options: HostCapabilityKernelOptions

  public constructor(options: HostCapabilityKernelOptions = {}) {
    this.options = options
  }

  public register(capability: HostCapability): void {
    if (!capability.id.trim()) throw new Error("Host capability id is required.")
    if (this.capabilities.has(capability.id)) {
      throw new Error(`Host capability "${capability.id}" is already registered.`)
    }
    const names = new Set<string>()
    for (const tool of capability.tools) {
      if (!tool.name.trim()) throw new Error(`Host capability "${capability.id}" has an unnamed tool.`)
      if (names.has(tool.name)) {
        throw new Error(`Host capability "${capability.id}" has duplicate tool "${tool.name}".`)
      }
      names.add(tool.name)
    }
    this.capabilities.set(capability.id, capability)
  }

  public capability(id: string): HostCapability {
    const capability = this.capabilities.get(id)
    if (!capability) throw new Error(`Unknown host capability "${id}".`)
    return capability
  }

  public async execute(
    capabilityId: string,
    toolName: string,
    context: HostCapabilityContext,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<HostToolResult> {
    const capability = this.capability(capabilityId)
    const tool = capability.tools.find((candidate) => candidate.name === toolName)
    if (!tool) throw new Error(`Unknown host tool "${capabilityId}.${toolName}".`)
    const startedAt = performance.now()
    const parsed = tool.inputSchema.safeParse(input)
    if (!parsed.success) {
      this.audit(capabilityId, toolName, context, startedAt, "validation_error")
      throw new Error(`Invalid input for ${capabilityId}.${toolName}: ${parsed.error.message}`)
    }
    try {
      const result = await tool.execute(context, parsed.data as Record<string, unknown>, signal)
      this.audit(capabilityId, toolName, context, startedAt, "success")
      return result
    } catch (error) {
      this.audit(capabilityId, toolName, context, startedAt, "error")
      throw error
    }
  }

  private audit(
    capability: string,
    tool: string,
    context: HostCapabilityContext,
    startedAt: number,
    outcome: HostCapabilityAuditRecord["outcome"],
  ): void {
    this.options.onAudit?.({
      capability,
      durationMs: Math.max(0, performance.now() - startedAt),
      outcome,
      sessionId: context.sessionId,
      tool,
      ...(context.turnId ? { turnId: context.turnId } : {}),
    })
  }
}

export function hostCapabilityBinding<T>(context: HostCapabilityContext, key: string): T | null {
  const value = context.bindings[key]
  return value === undefined || value === null ? null : (value as T)
}
