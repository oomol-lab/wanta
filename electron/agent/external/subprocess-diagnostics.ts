const DEFAULT_STDERR_TAIL_CHARS = 4 * 1024

/** Append subprocess stderr while keeping memory and diagnostic payloads bounded. */
export function appendStderrTail(current: string, chunk: string, maxChars = DEFAULT_STDERR_TAIL_CHARS): string {
  return `${current}${chunk}`.slice(-maxChars)
}

/** Pick the most useful single line from a bounded stderr tail for a user-facing error. */
export function subprocessFailureSummary(stderrTail: string): string | undefined {
  const lines = stderrTail
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
  return lines.find((line) => /^(?:Error|TypeError|ReferenceError|SyntaxError):/u.test(line)) ?? lines.at(-1)
}
