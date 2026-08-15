import type { PromptAgentInput } from "../contract/input.ts"

/** Agent-neutral HTTP MCP descriptor; adapters translate it to their native config. */
export interface HostMcpServer {
  headers: Record<string, string>
  name: string
  url: string
}

export type HostMcpServerProvider = (input: PromptAgentInput) => Promise<HostMcpServer[]>
