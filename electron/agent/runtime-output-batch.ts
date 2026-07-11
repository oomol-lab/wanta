export interface RuntimeOutputBatchSnapshot {
  droppedLineCount: number
  lineCount: number
  lines: string[]
  truncatedLineCount: number
}

const defaultMaxRetainedLines = 20

/** 保留固定数量的运行时输出样本，其余只计数，避免异常日志风暴拖高主进程和磁盘。 */
export class RuntimeOutputBatch {
  private droppedLineCount = 0
  private lineCount = 0
  private readonly lines: string[] = []
  private readonly maxRetainedLines: number
  private truncatedLineCount = 0

  public constructor(maxRetainedLines = defaultMaxRetainedLines) {
    this.maxRetainedLines = Math.max(0, maxRetainedLines)
  }

  public add(line: string, truncated: boolean): void {
    this.lineCount += 1
    if (truncated) {
      this.truncatedLineCount += 1
    }
    if (this.lines.length < this.maxRetainedLines) {
      this.lines.push(line)
    } else {
      this.droppedLineCount += 1
    }
  }

  public take(): RuntimeOutputBatchSnapshot | null {
    if (this.lineCount === 0) {
      return null
    }
    const snapshot = {
      droppedLineCount: this.droppedLineCount,
      lineCount: this.lineCount,
      lines: this.lines.splice(0),
      truncatedLineCount: this.truncatedLineCount,
    }
    this.droppedLineCount = 0
    this.lineCount = 0
    this.truncatedLineCount = 0
    return snapshot
  }
}
