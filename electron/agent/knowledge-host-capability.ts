import type { WikiGraphQueryExecutor } from "../knowledge/query-runner.ts"
import type { HostCapability } from "./host-capability.ts"

import { z } from "zod"

export const KNOWLEDGE_CAPABILITY_ID = "knowledge"

const querySchema = z.object({
  uri: z.string().min(1),
  operation: z.enum(["read", "inspect", "evidence", "related", "pack"]).optional(),
  query: z.string().min(1).optional(),
  evidence: z.number().int().min(0).max(20).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  reverse: z.boolean().optional(),
  budget: z.number().int().min(100).max(50_000).optional(),
  json: z.boolean().optional(),
})

export function createKnowledgeHostCapability(executor: WikiGraphQueryExecutor): HostCapability {
  return {
    id: KNOWLEDGE_CAPABILITY_ID,
    version: "1.0.0",
    instructions:
      "Read Wanta knowledge contexts only through knowledge_query. The host restricts access to wikg://lib and its archives. Never invent results after a query failure.",
    tools: [
      {
        name: "knowledge_query",
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        description:
          "Read or search Wanta's WikiGraph library/archive context. Start with inspect or a broad read query, then use returned entity, triple, chunk, chapter, source, or summary URIs for focused evidence.",
        inputSchema: querySchema,
        execute: async (_context, input) => ({ text: await executor.run(buildQueryArgv(input)) }),
      },
      {
        name: "knowledge_next",
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        description: "Continue a paginated WikiGraph result using the opaque cursor returned by knowledge_query.",
        inputSchema: z.object({ cursor: z.string().min(1), uri: z.string().min(1).optional() }),
        execute: async (_context, input) => {
          const cursor = requiredString(input.cursor)
          const uri = input.uri === undefined ? undefined : libraryUri(input.uri)
          return { text: await executor.run(["next", ...(uri ? [uri] : []), cursor]) }
        },
      },
    ],
  }
}

function buildQueryArgv(input: Record<string, unknown>): string[] {
  const argv = [libraryUri(input.uri)]
  const operation = input.operation
  if (operation !== undefined && operation !== "read") argv.push(requiredString(operation))
  appendStringFlag(argv, "--query", input.query)
  appendNumberFlag(argv, "--evidence", input.evidence)
  appendNumberFlag(argv, "--limit", input.limit)
  appendNumberFlag(argv, "--budget", input.budget)
  if (input.reverse === true) argv.push("--reverse")
  if (input.json === true) argv.push("--json")
  return argv
}

function libraryUri(value: unknown): string {
  const uri = requiredString(value).trim()
  if (!/^wikg:\/\/lib(?:\/|$)/u.test(uri) || /[\s\\]/u.test(uri)) {
    throw new Error("Knowledge URI must stay within wikg://lib.")
  }
  return uri
}

function appendStringFlag(argv: string[], flag: string, value: unknown): void {
  if (value !== undefined) argv.push(flag, requiredString(value))
}

function appendNumberFlag(argv: string[], flag: string, value: unknown): void {
  if (typeof value === "number") argv.push(flag, String(value))
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Expected a validated string input.")
  return value
}
