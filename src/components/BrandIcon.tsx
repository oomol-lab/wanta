import * as React from "react"
import appIconUrl from "@/assets/app-icon.png"
import { cn } from "@/lib/utils"

function BrandIcon({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span className={cn("inline-block shrink-0 overflow-hidden rounded-[22%]", className)} {...props}>
      <img className="block size-full" src={appIconUrl} alt="" draggable={false} />
    </span>
  )
}

export { BrandIcon }
