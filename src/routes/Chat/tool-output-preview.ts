export const toolOutputPreviewLimitChars = 24_000

export interface ToolOutputPreview {
  text: string
  truncated: boolean
}

/**
 * 工具结果可能是很大的 JSON。详情面板只需要即时呈现一个可读预览，
 * 超过上限时避免在渲染进程同步解析、缩进并排版整个结果。
 */
export function formatToolOutputPreview(output: string): ToolOutputPreview {
  if (output.length > toolOutputPreviewLimitChars) {
    return {
      text: `${output.slice(0, toolOutputPreviewLimitChars)}\n…`,
      truncated: true,
    }
  }
  try {
    return { text: JSON.stringify(JSON.parse(output), null, 2), truncated: false }
  } catch {
    return { text: output, truncated: false }
  }
}
