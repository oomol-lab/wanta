import * as React from "react"
import appIconUrl from "@/assets/app-icon.png"
import { cn } from "@/lib/utils"

function BrandIcon({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span className={cn("inline-grid shrink-0 place-items-center overflow-hidden rounded-full", className)} {...props}>
      <img className="block size-full scale-[1.62]" src={appIconUrl} alt="" draggable={false} />
    </span>
  )
}

export { BrandIcon }
