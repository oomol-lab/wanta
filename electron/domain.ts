// 全局唯一 endpoint：由构建期常量替换注入（vite define `__OO_ENDPOINT__`）。
// 缺省 oomol.com；本地开发可在 .env.local 设 WANTA_ENDPOINT 覆盖（见 .env.example）。
// **App 层不可见、不可切换**，其余域名一律由它派生。**禁止散落硬编码具体域名**。
//
// 注入点见 vite.config.ts（dev/构建）与 vitest.config.ts（测试），均经 loadEnv 读取。

declare const __OO_ENDPOINT__: string
declare const __PACKAGE_ASSETS_BASE_URL__: string

/** 当前 endpoint 主域（如 `oomol.com`）。oo-cli 的 OO_ENDPOINT / WANTA_ENDPOINT 用此裸值。 */
export const ooEndpoint: string = __OO_ENDPOINT__

/** LLM 网关基址，如 `https://llm.oomol.com/v1`（模型清单见 `electron/models/builtin.ts`）。 */
export const llmBaseUrl = `https://llm.${ooEndpoint}/v1`

/** 连接器网关基址，如 `https://connector.oomol.com`。 */
export const connectorBaseUrl = `https://connector.${ooEndpoint}`

/** 团队控制服务基址，如 `https://org-control.oomol.com`。 */
export const teamControlBaseUrl = `https://org-control.${ooEndpoint}`

/** 控制台基址，如 `https://console.oomol.com`。 */
export const consoleBaseUrl = `https://console.${ooEndpoint}`

/** 控制台 API 基址，如 `https://console-server.oomol.com`。 */
export const consoleServerBaseUrl = `https://console-server.${ooEndpoint}`

/** 用量 / 余额查询服务基址，如 `https://insight.oomol.com`。 */
export const insightBaseUrl = `https://insight.${ooEndpoint}`

/** 账号 API 基址，如 `https://api.oomol.com`（登录换 token / api-key / profile）。 */
export const apiBaseUrl = `https://api.${ooEndpoint}`

/** 技能 registry 基址，如 `https://registry.oomol.com`。 */
export const registryBaseUrl = `https://registry.${ooEndpoint}`

/** 技能搜索基址，如 `https://search.oomol.com`。 */
export const searchBaseUrl = `https://search.${ooEndpoint}`

/** 技能资源文件基址，由构建期常量注入，避免运行时代码分支硬编码环境域名。 */
export const packageAssetsBaseUrl: string = __PACKAGE_ASSETS_BASE_URL__

/** 自动更新静态分发基址，如 `https://static.oomol.com`（路径段见 branding.updateFeedPath）。 */
export const staticBaseUrl = `https://static.${ooEndpoint}`

/** 语音转写服务基址。当前 Studio Chat 使用同一账号鉴权；域名仍由统一 endpoint 派生。 */
export const voiceAsrBaseUrl = `https://chat-as-proxy-dev.${ooEndpoint}`

/** 第三方自定义模型提供方默认 API 基址。业务代码统一从这里引用，避免域名散落。 */
export const externalModelProviderBaseUrls = {
  deepseek: "https://api.deepseek.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  openrouter: "https://openrouter.ai/api/v1",
  zhipuCn: "https://open.bigmodel.cn/api/paas/v4",
  zhipuGlobal: "https://api.z.ai/api/paas/v4",
  zhipuCoding: "https://api.z.ai/api/coding/paas/v4",
  kimiCn: "https://api.moonshot.cn/v1",
  kimiGlobal: "https://api.moonshot.ai/v1",
  minimaxCn: "https://api.minimaxi.com/v1",
  minimaxGlobal: "https://api.minimax.io/v1",
  qwenStandardCn: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  qwenStandardGlobal: "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
  qwenCodingCn: "https://coding.dashscope.aliyuncs.com/v1",
  qwenCodingGlobal: "https://coding-intl.dashscope.aliyuncs.com/v1",
  xiaomiStandard: "https://api.xiaomimimo.com/v1",
  xiaomiTokenCn: "https://token-plan-cn.xiaomimimo.com/v1",
  xiaomiTokenSgp: "https://token-plan-sgp.xiaomimimo.com/v1",
  xiaomiTokenAms: "https://token-plan-ams.xiaomimimo.com/v1",
} as const
