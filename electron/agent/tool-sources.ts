// 自定义工具（R5）的源码，以字符串内嵌：运行时由 workspace.ts 写入
// <workspace>/.opencode/tools/，供 OpenCode sidecar 加载（OpenCode 自带
// @opencode-ai/plugin，无需在 workspace 旁安装）。工具通过 execFile 调用内置
// oo（路径由 WANTA_OO_BIN 注入），将连接器发现/调用/授权信号都走"工具结果"。
//
// 用 String.raw 内嵌：保留正则中的反斜杠；工具代码刻意不含反引号与 ${}，
// 故无转义陷阱。这些代码运行在 OpenCode 的 Bun 运行时，不参与本项目 tsc/oxlint。

const SEARCH_ACTIONS_TOOL_TS = String.raw`import { tool } from "@opencode-ai/plugin"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const OO_BIN = process.env.WANTA_OO_BIN || "oo"

export default tool({
  description:
    "Search the OOMOL connector catalog for Link actions matching a natural-language query. Use this only after deciding the task needs private/account-specific SaaS data or actions and the exact service + action is unknown. Do NOT use it for direct answers, local files, concrete URLs, webpage fetching/crawling/scraping, or general web browsing. Returns a JSON array; each item has service (slug), name (action name), description, and authenticated (whether the current user has already connected that service). The search result does NOT include input parameters — after selecting an action, call inspect_action to read its inputSchema before call_action.",
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
const OO_BIN = process.env.WANTA_OO_BIN || "oo"

export default tool({
  description:
    "Fetch the contract for one selected OOMOL Link action. Returns a JSON object with description, inputSchema (a JSON Schema describing the EXACT input field names, types, required fields, and constraints), and outputSchema. ALWAYS call this after selecting a service+action and before call_action, so the call_action params use the real declared field names instead of guesses. Inspecting a schema does not mean you must execute the action; if the schema does not fit the task, choose another path or explain the limitation. The schema is identity-independent and read-only; calling it never sends or changes anything.",
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
import { readFileSync } from "node:fs"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const OO_BIN = process.env.WANTA_OO_BIN || "oo"

function currentOrganizationName() {
  const scopePath = process.env.WANTA_ORGANIZATION_SCOPE_PATH || ""
  if (scopePath) {
    try {
      const parsed = JSON.parse(readFileSync(scopePath, "utf8"))
      if (parsed && typeof parsed.organizationName === "string") {
        return parsed.organizationName
      }
    } catch {
      // 启动期或文件损坏时回退到进程启动时的组织名。
    }
  }
  return process.env.WANTA_ORGANIZATION_NAME || ""
}

function appendIdentityArgs(argv) {
  const organizationName = currentOrganizationName().trim()
  if (organizationName) {
    argv.push("--organization", organizationName)
  }
}

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
    "Execute one selected OOMOL Link action. Use this only for a selected action that matches the user's task; do not probe unrelated services or actions. params is a JSON string of the action's input object and MUST match the inputSchema returned by inspect_action — call inspect_action before this so the field names and types are real, not guessed; unknown or misnamed fields are rejected. If the service is not authorized this returns a JSON object with status 'authorization_required' plus service/action/errorCode; when you see that, stop trying this provider/action and tell the user Wanta needs that connection authorized. Do NOT retry this provider/action or fabricate a result.",
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
    appendIdentityArgs(argv)
    try {
      const result = await execFileAsync(OO_BIN, argv, { maxBuffer: 16 * 1024 * 1024 })
      return (result.stdout || "").trim() || "{}"
    } catch (error) {
      const e = error || {}
      const stderr = String(e.stderr || e.message || "")
      const match = stderr.match(/errorCode:\s*([^\s)）]+)/)
      const code = match ? match[1] : null
      if (code && AUTH_BLOCKING.has(code)) {
        return JSON.stringify({
          status: "authorization_required",
          service: args.service,
          action: args.action,
          displayName: args.service,
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
