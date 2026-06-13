import * as React from "react"
import { AppIcons } from "@/components/AppIcons"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type SearchFieldProps = Omit<React.ComponentProps<typeof Input>, "role" | "type">

export function SearchField({ className, ...props }: SearchFieldProps) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <AppIcons.utility.search className="oo-icon-muted pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
      <Input
        className="oo-search-surface h-[var(--oo-control-height)] border-transparent pl-8 shadow-none focus-visible:border-transparent focus-visible:ring-0"
        type="text"
        role="searchbox"
        {...props}
      />
    </div>
  )
}
