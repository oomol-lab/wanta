// 全局唯一 endpoint：由构建期常量替换注入（vite define `__OO_ENDPOINT__`）。
// 缺省 oomol.com；本地开发可在 .env.local 设 LUMO_ENDPOINT 覆盖（见 .env.example）。
// **App 层不可见、不可切换**，其余域名一律由它派生。**禁止散落硬编码具体域名**。
//
// 注入点见 vite.config.ts（dev/构建）与 vitest.config.ts（测试），均经 loadEnv 读取。

declare const __OO_ENDPOINT__: string

/** 当前 endpoint 主域（如 `oomol.com`）。oo-cli 的 OO_ENDPOINT / LUMO_ENDPOINT 用此裸值。 */
export const ooEndpoint: string = __OO_ENDPOINT__

/** LLM OpenAI 兼容网关基址，如 `https://llm.oomol.com/v1`（模型名见 opencode provider 配置 = oomol-chat）。 */
export const llmBaseUrl = `https://llm.${ooEndpoint}/v1`

/** 连接器网关基址，如 `https://connector.oomol.com`。 */
export const connectorBaseUrl = `https://connector.${ooEndpoint}`

/** 控制台基址，如 `https://console.oomol.com`。 */
export const consoleBaseUrl = `https://console.${ooEndpoint}`

/** 账号 API 基址，如 `https://api.oomol.com`（登录换 token / api-key / profile）。 */
export const apiBaseUrl = `https://api.${ooEndpoint}`

/** Hub 基址，如 `https://hub.oomol.com`（浏览器登录页所在域）。 */
export const hubBaseUrl = `https://hub.${ooEndpoint}`

/** 技能 registry 基址，如 `https://registry.oomol.com`。 */
export const registryBaseUrl = `https://registry.${ooEndpoint}`

/** 技能搜索基址，如 `https://search.oomol.com`。 */
export const searchBaseUrl = `https://search.${ooEndpoint}`

/** 自动更新静态分发基址，如 `https://static.oomol.com`（路径段见 branding.updateFeedPath）。 */
export const staticBaseUrl = `https://static.${ooEndpoint}`

/** 语音转写服务基址。当前 Studio Chat 使用同一账号鉴权；域名仍由统一 endpoint 派生。 */
export const voiceAsrBaseUrl = `https://chat-as-proxy-dev.${ooEndpoint}`
