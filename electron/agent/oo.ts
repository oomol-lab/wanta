import type { LinkRuntime } from "../runtime/agent-runtime.ts"

import path from "node:path"
import { connectorBaseUrl, consoleBaseUrl, ooEndpoint } from "../domain.ts"

// 授权阻断码（上游 connector 透传，非 oo-cli 常量；权威以 connector openapi 为准）。
export const AUTH_BLOCKING_ERROR_CODES: ReadonlySet<string> = new Set([
  "connection_required",
  "app_not_found",
  "app_not_ready",
  "credential_expired",
  "scope_missing",
  "connection_not_found",
  "oauth_token_expired",
  "oauth_refresh_unavailable",
  "authorization_failed",
])

// 从 oo-cli stderr 提取 errorCode token。en/zh 文案都内嵌 `errorCode: <code>`；
// zh 用全角括号，故字符类排除半角与全角右括号。注意：仅上游返回 errorCode 时才有该 token。
// （此正则与 tool-sources.ts 中 call_action 内联实现保持一致。）
export function parseConnectorErrorCode(stderr: string): string | null {
  const match = stderr.match(/errorCode:\s*([^\s)）]+)/)
  return match ? match[1] : null
}

export function isAuthBlocking(code: string | null): boolean {
  return code != null && AUTH_BLOCKING_ERROR_CODES.has(code)
}

export interface AgentLinkEnvOptions {
  linkRuntime: LinkRuntime
  /** 当前团队工作区名称；未设置表示团队身份尚未解析。 */
  teamName?: string
  /** 当前团队工作区状态文件；工具运行时读取，避免切换工作区时重启 sidecar。 */
  teamScopePath?: string
  /** oo-cli 私有目录根（App userData 下）。 */
  storeDir: string
  /** oo 二进制绝对路径（注入 WANTA_OO_BIN，供自定义工具直接调用，比 PATH 更稳）。 */
  ooBinPath?: string
}

export interface OoMaintenanceEnvOptions {
  /** 网关鉴权凭证：现为会话 token（注入到 OO_API_KEY，网关层接受 cookie/token/api-key）。 */
  authToken: string
  /** oo 配置目录。维护全局 oo store 时需要直接指向用户级 oo 根目录。 */
  configDir: string
  /** oo 数据目录。 */
  dataDir: string
  /** oo 日志目录。 */
  logDir: string
  /** oo 二进制绝对路径（注入 WANTA_OO_BIN，供自定义工具直接调用，比 PATH 更稳）。 */
  ooBinPath?: string
}

/** R3：自定义工具经 OpenCode 调用 oo 所需的全部环境变量。 */
export function buildAgentLinkEnv({
  linkRuntime,
  teamName,
  teamScopePath,
  storeDir,
  ooBinPath,
}: AgentLinkEnvOptions): Record<string, string> {
  const env = buildOoBaseEnv({
    configDir: path.join(storeDir, "config"),
    dataDir: path.join(storeDir, "data"),
    logDir: path.join(storeDir, "log"),
    ooBinPath,
  })
  if (teamScopePath) {
    env.WANTA_TEAM_SCOPE_PATH = teamScopePath
  }
  if (linkRuntime.kind === "oomol") {
    env.OO_API_KEY = linkRuntime.sessionToken
    env.OO_ENDPOINT = ooEndpoint
    env.WANTA_ENDPOINT = ooEndpoint
    env.WANTA_CONSOLE_URL = consoleBaseUrl
    env.WANTA_CONNECTOR_URL = connectorBaseUrl
    env.WANTA_LINK_RUNTIME = "oomol"
  } else {
    env.OO_CONNECTOR_URL = linkRuntime.baseUrl
    env.WANTA_CONNECTOR_URL = linkRuntime.baseUrl
    env.WANTA_CONSOLE_URL = linkRuntime.consoleUrl
    env.WANTA_LINK_RUNTIME = "openconnector"
    if (linkRuntime.runtimeToken) env.OO_CONNECTOR_TOKEN = linkRuntime.runtimeToken
  }
  if (linkRuntime.kind === "oomol" && teamName) {
    env.WANTA_TEAM_NAME = teamName
  }
  return env
}

/** R3: Build the oo environment used to maintain the Skill store with caller-owned directories. */
export function buildOomolMaintenanceEnv({
  authToken,
  configDir,
  dataDir,
  logDir,
  ooBinPath,
}: OoMaintenanceEnvOptions): Record<string, string> {
  return {
    ...buildOoBaseEnv({ configDir, dataDir, logDir, ooBinPath }),
    // OO_API_KEY is fixed by the oo CLI contract; its value is the session token.
    OO_API_KEY: authToken,
    OO_ENDPOINT: ooEndpoint,
    // Custom tools read these connector endpoints, all derived centrally in domain.ts.
    WANTA_ENDPOINT: ooEndpoint,
    WANTA_CONSOLE_URL: consoleBaseUrl,
    WANTA_CONNECTOR_URL: connectorBaseUrl,
    WANTA_LINK_RUNTIME: "oomol",
  }
}

function buildOoBaseEnv({
  configDir,
  dataDir,
  logDir,
  ooBinPath,
}: Omit<OoMaintenanceEnvOptions, "authToken">): Record<string, string> {
  const env: Record<string, string> = {
    OO_CONFIG_DIR: configDir,
    OO_DATA_DIR: dataDir,
    OO_LOG_DIR: logDir,
    OO_SKILLS_SYNC_DISABLED: "1",
    OO_NO_SELF_UPDATE: "1",
    OO_TELEMETRY_DISABLED: "1",
    OO_LOG_LEVEL: "warn",
  }
  if (ooBinPath) {
    env.WANTA_OO_BIN = ooBinPath
  }
  return env
}
