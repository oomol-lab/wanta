import type { ChatStatus } from "ai"
import type { ComponentProps, FormEvent, FormEventHandler, HTMLAttributes, KeyboardEventHandler } from "react"

import { ArrowUpIcon, Loader2Icon, SquareIcon, XIcon } from "lucide-react"
import { Children, useState } from "react"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { cn } from "@/lib/utils"

export type PromptInputMessage = {
  text: string
}

export type PromptInputProps = Omit<HTMLAttributes<HTMLFormElement>, "onSubmit"> & {
  onSubmit: (message: PromptInputMessage, event: FormEvent<HTMLFormElement>) => void
}

export const PromptInput = ({ className, onSubmit, children, ...props }: PromptInputProps) => {
  const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const text = ((formData.get("message") as string) || "").trim()
    onSubmit({ text }, event)
  }

  return (
    <form className={cn("w-full", className)} onSubmit={handleSubmit} {...props}>
      <InputGroup className="oo-prompt-input-surface overflow-hidden rounded-[1.375rem]">{children}</InputGroup>
    </form>
  )
}

export type PromptInputBodyProps = HTMLAttributes<HTMLDivElement>

export const PromptInputBody = ({ className, ...props }: PromptInputBodyProps) => (
  <div className={cn("contents", className)} {...props} />
)

export type PromptInputTextareaProps = ComponentProps<typeof InputGroupTextarea>

export const PromptInputTextarea = ({
  className,
  placeholder = "What would you like to know?",
  ...props
}: PromptInputTextareaProps) => {
  const [isComposing, setIsComposing] = useState(false)

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === "Enter") {
      if (isComposing || e.nativeEvent.isComposing) {
        return
      }
      if (e.shiftKey) {
        return
      }
      e.preventDefault()

      // 提交按钮禁用时（如空输入 / agent 未就绪）不提交。
      const form = e.currentTarget.form
      const submitButton = form?.querySelector('button[type="submit"]') as HTMLButtonElement | null
      if (submitButton?.disabled) {
        return
      }
      form?.requestSubmit()
    }
  }

  return (
    <InputGroupTextarea
      className={cn("field-sizing-content max-h-52 min-h-14 px-4 pt-3 pb-1.5", className)}
      name="message"
      onCompositionEnd={() => setIsComposing(false)}
      onCompositionStart={() => setIsComposing(true)}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      {...props}
    />
  )
}

export type PromptInputToolbarProps = Omit<ComponentProps<typeof InputGroupAddon>, "align">

export const PromptInputToolbar = ({ className, ...props }: PromptInputToolbarProps) => (
  <InputGroupAddon align="block-end" className={cn("justify-between gap-1 px-4 pt-0 pb-2.5", className)} {...props} />
)

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>

export const PromptInputTools = ({ className, ...props }: PromptInputToolsProps) => (
  <div className={cn("flex items-center gap-1", className)} {...props} />
)

export type PromptInputButtonProps = ComponentProps<typeof InputGroupButton>

export const PromptInputButton = ({ variant = "ghost", className, size, ...props }: PromptInputButtonProps) => {
  const newSize = size ?? (Children.count(props.children) > 1 ? "sm" : "icon-sm")

  return <InputGroupButton className={cn(className)} size={newSize} type="button" variant={variant} {...props} />
}

export type PromptInputSubmitProps = ComponentProps<typeof InputGroupButton> & {
  status?: ChatStatus
}

export const PromptInputSubmit = ({
  className,
  variant = "default",
  size = "icon-sm",
  status,
  children,
  ...props
}: PromptInputSubmitProps) => {
  let Icon = <ArrowUpIcon className="size-4" />

  if (status === "submitted") {
    Icon = <Loader2Icon className="size-4 animate-spin" />
  } else if (status === "streaming") {
    Icon = <SquareIcon className="size-4" />
  } else if (status === "error") {
    Icon = <XIcon className="size-4" />
  }

  return (
    <InputGroupButton
      aria-label="Submit"
      className={cn("rounded-full", className)}
      size={size}
      type="submit"
      variant={variant}
      {...props}
    >
      {children ?? Icon}
    </InputGroupButton>
  )
}
