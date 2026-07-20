// 自定义工具只需要 plugin 的 tool helper 与 Zod schema。构建期把二者合并成单个 ESM 文件，
// 工具运行时不再从用户 workspace 解析或下载 @opencode-ai/plugin。
export { tool } from "@opencode-ai/plugin/tool"
