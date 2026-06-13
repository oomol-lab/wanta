import * as React from "react"
import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "rounded-md bg-muted-foreground/10 motion-safe:animate-pulse dark:bg-muted-foreground/15",
        className,
      )}
      {...props}
    />
  )
}

export { Skeleton }
