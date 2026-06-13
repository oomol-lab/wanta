import * as React from "react"
import { AccordionItem } from "@/components/ui/accordion"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export function InspectorCard({ className, ...props }: React.ComponentProps<typeof Card>) {
  return (
    <Card
      className={cn("gap-2 rounded-md border-0 bg-[var(--oo-inspector-surface)] py-3 shadow-none", className)}
      {...props}
    />
  )
}

export function InspectorInsetCard({ className, ...props }: React.ComponentProps<typeof Card>) {
  return (
    <Card className={cn("gap-2 rounded-md border-0 bg-[var(--oo-surface-raised)] shadow-none", className)} {...props} />
  )
}

export function InspectorAccordionItem({ className, ...props }: React.ComponentProps<typeof AccordionItem>) {
  return (
    <AccordionItem
      className={cn("min-w-0 overflow-hidden rounded-md !border-0 bg-[var(--oo-inspector-surface)] px-3", className)}
      {...props}
    />
  )
}
