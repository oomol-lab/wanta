import { voiceAsrBaseUrl } from "@/lib/domain"
import { oomolFetch } from "@/lib/oomol-http"

// Studio 语音转写：音频本就在渲染层录制并 base64 编码，故直接由渲染层 POST 到 ASR 网关，
// 不再把（可能数 MB 的）音频字节经 IPC 来回搬到主进程让主进程代发。凭证是 httpOnly 的
// oomol-token 会话 cookie，credentials:"include" 时自动附带——渲染层不持有也读不到 token（守 R4）。

const voiceAsrTimeoutMs = 60_000

export interface VoiceAsrResponse {
  audio_info?: {
    duration?: number
  }
  result?: {
    text?: string
    utterances?: unknown[]
  }
}

export function createVoiceAsrRequestId(): string {
  return crypto.randomUUID()
}

export function buildVoiceAsrBody(audioBase64: string, requestId: string): string {
  return JSON.stringify({
    user: { uid: requestId },
    audio: { data: audioBase64 },
    request: {
      model_name: "bigmodel",
      enable_itn: true,
      enable_punc: true,
    },
  })
}

export function parseVoiceAsrTranscript(payload: VoiceAsrResponse | undefined): string {
  const transcript = payload?.result?.text?.trim() ?? ""
  if (!transcript) {
    throw new Error("No speech was recognized.")
  }
  return transcript
}

export function describeVoiceAsrFetchFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const cause = error instanceof Error ? error.cause : undefined
  const causeCode =
    cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string" ? cause.code : undefined
  const causeMessage =
    cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string"
      ? cause.message
      : undefined
  const details = [causeCode, causeMessage].filter((item): item is string => Boolean(item)).join(": ")
  return details ? `${message} (${details})` : message
}

/** 直接向 ASR 网关 POST 录音并返回转写文本。会话 cookie 自动鉴权，超时 60s。 */
export async function transcribeVoice(audioBase64: string): Promise<string> {
  const requestId = createVoiceAsrRequestId()
  let response: Response
  try {
    response = await oomolFetch(voiceAsrBaseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Request-Id": requestId,
      },
      body: buildVoiceAsrBody(audioBase64, requestId),
      timeoutMs: voiceAsrTimeoutMs,
    })
  } catch (error) {
    // 保留原始错误链：describeVoiceAsrFetchFailure 已提取 cause.code/message 入文案，cause 再留结构化细节。
    throw new Error(`Voice transcription request failed: ${describeVoiceAsrFetchFailure(error)}`, { cause: error })
  }
  const text = await response.text()
  let payload: VoiceAsrResponse | undefined
  if (text) {
    try {
      payload = JSON.parse(text) as VoiceAsrResponse
    } catch {
      payload = undefined
    }
  }
  if (!response.ok) {
    throw new Error(`Voice transcription failed with status ${response.status}: ${text || response.statusText}`)
  }
  return parseVoiceAsrTranscript(payload)
}
