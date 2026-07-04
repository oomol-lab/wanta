import * as React from "react"
import { toast } from "sonner"
import { writeClipboardText } from "@/lib/clipboard"

interface UseClipboardCopyOptions {
  failureMessage: string
  resetDelayMs?: number
}

export function useClipboardCopy({ failureMessage, resetDelayMs = 1200 }: UseClipboardCopyOptions) {
  const [copied, setCopied] = React.useState(false)
  const timeoutRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const copyText = React.useCallback(
    async (value: string): Promise<boolean> => {
      const ok = await writeClipboardText(value)
      if (!ok) {
        toast.error(failureMessage)
        return false
      }
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
      }
      setCopied(true)
      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null
        setCopied(false)
      }, resetDelayMs)
      return true
    },
    [failureMessage, resetDelayMs],
  )

  return { copied, copyText }
}
