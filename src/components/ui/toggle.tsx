"use client"

import type { VariantProps } from "class-variance-authority"

import { Toggle as TogglePrimitive } from "radix-ui"
import * as React from "react"
import { toggleVariants } from "@/components/ui/toggle-variants"
import { cn } from "@/lib/utils"

function Toggle({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root data-slot="toggle" className={cn(toggleVariants({ variant, size, className }))} {...props} />
  )
}

export { Toggle }
