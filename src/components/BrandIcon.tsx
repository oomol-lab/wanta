import * as React from "react"
import appLogoUrl from "../../resources/branding/logo.png"
import { cn } from "@/lib/utils"

function BrandIcon({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center", className)} {...props}>
      <img className="block size-full object-contain" src={appLogoUrl} alt="" draggable={false} />
    </span>
  )
}

export { BrandIcon }
