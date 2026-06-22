import type { AppIconComponent } from "@/components/AppIcons"

import * as React from "react"
import { cn } from "@/lib/utils"

interface SectionHeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  children: React.ReactNode
  icon?: AppIconComponent
  level?: "h2" | "h3"
  trailing?: React.ReactNode
}

export function SectionHeading({
  children,
  className,
  icon: Icon,
  level = "h2",
  trailing,
  ...props
}: SectionHeadingProps) {
  const Heading = level

  return (
    <Heading
      className={cn("oo-text-caption-compact flex min-h-5 items-center gap-1.5 px-1 font-medium", className)}
      {...props}
    >
      {Icon ? <Icon aria-hidden="true" className="oo-icon-muted size-3.5 shrink-0" /> : null}
      <span className="min-w-0 truncate">{children}</span>
      {trailing ? <span className="inline-flex size-3.5 shrink-0 items-center justify-center">{trailing}</span> : null}
    </Heading>
  )
}
