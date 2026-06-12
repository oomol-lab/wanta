// 自定义工具（R5）的源码，以字符串内嵌：运行时由 workspace.ts 写入
// <workspace>/.opencode/tools/，供 OpenCode sidecar 加载（OpenCode 自带
// @opencode-ai/plugin，无需在 workspace 旁安装）。工具通过 execFile 调用内置
// oo（路径由 LUMO_OO_BIN 注入），将连接器发现/调用/授权信号都走"工具结果"。
//
// 用 String.raw 内嵌：保留正则中的反斜杠；工具代码刻意不含反引号与 ${}，
// 故无转义陷阱。这些代码运行在 OpenCode 的 Bun 运行时，不参与本项目 tsc/oxlint。

const SEARCH_ACTIONS_TOOL_TS = String.raw`import { tool } from "@opencode-ai/plugin"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const OO_BIN = process.env.LUMO_OO_BIN || "oo"

export default tool({
  description:
    "Search the OOMOL connector catalog (~600 SaaS providers, 6000+ actions) for actions matching a natural-language query. Returns a JSON array; each item has service (slug), name (action name), description, and authenticated (whether the current user has already connected that service). Use this to discover the exact service + action. The search result does NOT include the input parameters — after picking an action, call inspect_action to read its inputSchema before call_action.",
  args: {
    query: tool.schema.string().describe("Natural-language description of the desired action, e.g. 'list hacker news top stories'"),
    keywords: tool.schema.string().optional().describe("Optional comma-separated keywords to refine the search"),
  },
  async execute(args) {
    const argv = ["connector", "search", args.query, "--json"]
    if (args.keywords) argv.push("--keywords", args.keywords)
    try {
      const result = await execFileAsync(OO_BIN, argv, { maxBuffer: 16 * 1024 * 1024 })
      return (result.stdout || "").trim() || "[]"
    } catch (error) {
      const e = error || {}
      const message = String(e.stderr || e.message || "search failed").trim()
      return JSON.stringify({ status: "error", message: message })
    }
  },
})
`

const INSPECT_ACTION_TOOL_TS = String.raw`import { tool } from "@opencode-ai/plugin"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const OO_BIN = process.env.LUMO_OO_BIN || "oo"

export default tool({
  description:
    "Fetch the contract for one OOMOL connector action. Returns a JSON object with description, inputSchema (a JSON Schema describing the EXACT input field names, types, required fields, and constraints), and outputSchema. ALWAYS call this after picking a service+action and before call_action, so the call_action params use the real declared field names instead of guesses. The schema is identity-independent and read-only; calling it never sends or changes anything.",
  args: {
    service: tool.schema.string().describe("Service slug, e.g. 'hackernews'"),
    action: tool.schema.string().describe("Action name, e.g. 'get_item'"),
  },
  async execute(args) {
    const argv = ["connector", "schema", args.service, "--action", args.action, "--json"]
    try {
      const result = await execFileAsync(OO_BIN, argv, { maxBuffer: 16 * 1024 * 1024 })
      return (result.stdout || "").trim() || "{}"
    } catch (error) {
      const e = error || {}
      const message = String(e.stderr || e.message || "schema lookup failed").trim()
      return JSON.stringify({ status: "error", message: message })
    }
  },
})
`

const CALL_ACTION_TOOL_TS = String.raw`import { tool } from "@opencode-ai/plugin"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const OO_BIN = process.env.LUMO_OO_BIN || "oo"

// 授权阻断码（上游 connector 透传）。命中即返回结构化 authorization_required。
const AUTH_BLOCKING = new Set([
  "connection_required",
  "app_not_found",
  "app_not_ready",
  "credential_expired",
  "scope_missing",
])

export default tool({
  description:
    "Execute one OOMOL connector action. Provide the exact service slug and action name (discover them with search_actions first). params is a JSON string of the action's input object and MUST match the inputSchema returned by inspect_action — call inspect_action before this so the field names and types are real, not guessed; unknown or misnamed fields are rejected. If the service is not authorized this returns a JSON object with status 'authorization_required' and an authUrl; when you see that, STOP for this service, tell the user it needs authorization and surface the authUrl. Do NOT retry or fabricate a result.",
  args: {
    service: tool.schema.string().describe("Service slug, e.g. 'hackernews'"),
    action: tool.schema.string().describe("Action name, e.g. 'get_top_stories'"),
    params: tool.schema.string().optional().describe("JSON string of the action input parameters built from inspect_action's inputSchema; omit or '{}' if the schema declares no required fields"),
  },
  async execute(args) {
    let data = "{}"
    if (args.params && args.params.trim()) {
      try {
        data = JSON.stringify(JSON.parse(args.params))
      } catch (parseError) {
        return JSON.stringify({ status: "error", message: "params is not valid JSON: " + args.params })
      }
    }
    const argv = ["connector", "run", args.service, "--action", args.action, "--data", data, "--json"]
    try {
      const result = await execFileAsync(OO_BIN, argv, { maxBuffer: 16 * 1024 * 1024 })
      return (result.stdout || "").trim() || "{}"
    } catch (error) {
      const e = error || {}
      const stderr = String(e.stderr || e.message || "")
      const match = stderr.match(/errorCode:\s*([^\s)）]+)/)
      const code = match ? match[1] : null
      if (code && AUTH_BLOCKING.has(code)) {
        const base = process.env.LUMO_CONSOLE_URL || "https://console.oomol.com"
        return JSON.stringify({
          status: "authorization_required",
          service: args.service,
          displayName: args.service,
          authUrl: base + "/app-connections?provider=" + encodeURIComponent(args.service),
          errorCode: code,
          message: stderr.trim(),
        })
      }
      return JSON.stringify({ status: "error", errorCode: code, message: stderr.trim() })
    }
  },
})
`

/** workspace 写入用：文件名 → 源码。 */
export const AGENT_TOOL_FILES: Readonly<Record<string, string>> = {
  "search_actions.ts": SEARCH_ACTIONS_TOOL_TS,
  "inspect_action.ts": INSPECT_ACTION_TOOL_TS,
  "call_action.ts": CALL_ACTION_TOOL_TS,
}
