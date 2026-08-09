import type { ModelChoice } from "../models/common.ts"
import type { GenerateSessionTitleRequest } from "../session/common.ts"

import { logDiagnostic } from "../diagnostics-log.ts"
import { buildFallbackSessionTitle, sanitizeGeneratedSessionTitle } from "../session/title.ts"

export interface GeneratedSessionTitle {
  generated: boolean
  title: string
}

export interface SessionTitleTarget {
  apiKey: string
  baseUrl: string
  modelID: string
  requestProfile: "compatible" | "deepseek" | "openai-reasoning"
  structuredOutput: boolean
}

const titleMaxOutputTokens = 4_096

const systemPrompt = [
  "Generate a concise chat title as a task label.",
  'Return JSON only, exactly like {"title":"Gmail 三日报告"}.',
  "Return the JSON immediately without analysis or reasoning.",
  "Keep the user's language when possible.",
  "Keep Chinese titles within about 10 characters and English titles within 6 words.",
  "- Preserve complete brand, product, app, domain, and file names. Never cut Gmail to Gma or truncate any word.",
  "- Prefer the core action and object; remove polite wording such as help me, 请, 帮我, 麻烦.",
  "- No URLs, no ellipses, no markdown, no explanations, no trailing punctuation.",
  "Examples:",
  'User: 你帮我分析一下我最近三天的 Gmail 信息，然后给我总结出一个报告 -> {"title":"Gmail 三日报告"}',
  'User: 你帮我将这个店铺中商品相关的图片都抓下来 -> {"title":"抓取店铺商品图片"}',
  'User: Search 1688 product images with Metaso and Puppeteer -> {"title":"1688 Product Images"}',
].join("\n")

export async function generateSessionTitle(
  input: GenerateSessionTitleRequest,
  resolveTarget: (choice: ModelChoice | undefined) => SessionTitleTarget,
): Promise<GeneratedSessionTitle> {
  const fallback = buildFallbackSessionTitle(input)
  const source = buildTitleSource(input)
  if (!source) return { generated: false, title: fallback }
  let target: SessionTitleTarget | undefined
  try {
    target = resolveTarget(input.model)
    const rawTitle = await requestTitle(source, target)
    const title = sanitizeGeneratedSessionTitle(rawTitle, input)
    return title.usedFallback ? { generated: false, title: fallback } : { generated: true, title: title.title }
  } catch (error) {
    console.warn("[wanta] failed to generate session title, using fallback:", error)
    logDiagnostic(
      "session-title",
      "failed to generate session title",
      { error, modelID: target?.modelID, requestProfile: target?.requestProfile },
      "warn",
    )
    return { generated: false, title: fallback }
  }
}

async function requestTitle(source: string, target: SessionTitleTarget): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (target.apiKey) headers.Authorization = `Bearer ${target.apiKey}`
  const outputTokenOptions =
    target.requestProfile === "openai-reasoning"
      ? { max_completion_tokens: titleMaxOutputTokens, reasoning_effort: "low" }
      : { max_tokens: titleMaxOutputTokens }
  const response = await fetch(`${target.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: target.modelID,
      ...outputTokenOptions,
      ...(target.requestProfile === "deepseek" ? { thinking: { type: "disabled" } } : {}),
      ...(target.structuredOutput ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: source },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`session title request failed: ${response.status} ${response.statusText}`)
  const payload = (await response.json()) as {
    choices?: Array<{
      finish_reason?: string
      message?: { content?: string; reasoning_content?: string }
    }>
  }
  const choice = payload.choices?.[0]
  const content = choice?.message?.content?.trim() ?? ""
  if (!content) {
    const finishReason = choice?.finish_reason ?? "missing"
    const reasoning = choice?.message?.reasoning_content ? "present" : "missing"
    throw new Error(
      `session title response had no content (finish_reason=${finishReason}, reasoning_content=${reasoning})`,
    )
  }
  return content
}

function buildTitleSource(input: GenerateSessionTitleRequest): string {
  return [input.text, ...(input.attachmentNames ?? []).map((name) => `Attachment: ${name}`)]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 1600)
}
