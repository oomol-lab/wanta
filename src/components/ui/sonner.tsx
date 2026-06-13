import type { ToasterProps } from "sonner"

import { Toaster as Sonner } from "sonner"
import { useTheme } from "@/components/theme-context"

function Toaster({ ...props }: ToasterProps) {
  const { effectiveTheme } = useTheme()

  return (
    <Sonner
      theme={effectiveTheme}
      className="toaster group"
      richColors={false}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
