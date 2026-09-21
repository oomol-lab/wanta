// Built-in tools use the same host capability as ACP. They have no raw CLI fallback.
function source(name: string, description: string, args: string): string {
  return `import { tool } from "../runtime/tool.js"
export default tool({
  description: ${JSON.stringify(description)},
  args: { ${args} },
  async execute(input, context) {
    const url = process.env.WANTA_HOST_CAPABILITY_URL
    const token = process.env.WANTA_HOST_CAPABILITY_TOKEN
    if (!url || !token) throw new Error("Spaces requires Wanta's managed host capability.")
    const response = await fetch(url.replace(/\\/+$/, "") + "/v1/invoke", {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify({ capability: "spaces", tool: ${JSON.stringify(name)}, input, sessionId: context.sessionID }),
      signal: context.abort,
    })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || "Spaces operation failed.")
    return payload.result
  },
})
`
}

export const SPACES_AGENT_TOOL_FILES: Readonly<Record<string, string>> = {
  "spaces_read.ts": source(
    "spaces_read",
    "Read or poll Spaces in the active team. Only for explicit Spaces management or a full-stack workflow; never probe Spaces for static website requests.",
    `
    operation: tool.schema.enum(["list", "get", "deploys", "job", "usage"]),
    space: tool.schema.string().optional(), jobId: tool.schema.string().optional(), cursor: tool.schema.string().optional()
  `,
  ),
  "spaces_create.ts": source(
    "spaces_create",
    "Create a paid Space only for a website needing a real Convex backend and persistent database. Prepare source first and explain why static hosting or an existing backend is insufficient. Wanta displays billing and waits for the user's confirmation; no shell fallback or model-provided approval. The first deployment is included in that confirmation.",
    `
    project: tool.schema.string(), slug: tool.schema.string(), name: tool.schema.string(),
    requirement: tool.schema.enum(["shared_persistent_data", "server_functions_and_database"]), reason: tool.schema.string()
  `,
  ),
  "spaces_deploy.ts": source(
    "spaces_deploy",
    "Deploy a real Convex backend plus a frontend build producing dist/index.html. Wanta confirms the target. Poll the returned job with spaces_read and verify the database. Backend changes may remain live after frontend failure. No auto-resume of suspended Spaces.",
    `
    space: tool.schema.string(), project: tool.schema.string(), reason: tool.schema.string()
  `,
  ),
}
