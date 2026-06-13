import * as React from "react"
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia } from "@/components/ui/item"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

interface ObjectRowSkeletonProps {
  badge?: boolean
  chevron?: boolean
  className?: string
  descriptionWidth?: string
  meta?: boolean
  rows?: 1 | 2 | 3
  status?: boolean
  titleWidth?: string
}

interface SectionHeaderSkeletonProps {
  action?: boolean
  className?: string
  description?: boolean
}

export function SkeletonText({ className, ...props }: React.ComponentProps<typeof Skeleton>) {
  return <Skeleton className={cn("h-3 rounded-sm", className)} {...props} />
}

export function SkeletonIcon({ className, ...props }: React.ComponentProps<typeof Skeleton>) {
  return <Skeleton className={cn("size-4 shrink-0 rounded-sm", className)} {...props} />
}

export function ObjectRowSkeleton({
  badge = false,
  chevron = false,
  className,
  descriptionWidth = "w-3/5 max-w-64",
  meta = false,
  rows = 2,
  status = false,
  titleWidth = "w-2/5 max-w-48",
}: ObjectRowSkeletonProps) {
  return (
    <Item role="listitem" size="sm" className={cn("w-full min-w-0 gap-3 rounded-md border-0 px-3 py-2.5", className)}>
      <ItemMedia className="size-auto items-start gap-2 pt-0.5">
        {status ? <SkeletonIcon className="rounded-full" /> : null}
        <SkeletonIcon className="rounded-md" />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-1">
        <SkeletonText className={cn("h-4", titleWidth)} />
        {rows >= 2 ? <SkeletonText className={descriptionWidth} /> : null}
        {rows >= 3 ? <SkeletonText className="w-1/2 max-w-56" /> : null}
      </ItemContent>
      {meta || badge || chevron ? (
        <ItemActions className="min-w-0 justify-end">
          {meta ? <SkeletonText className="hidden w-16 min-[720px]:block" /> : null}
          {badge && !meta ? <Skeleton className="h-5 w-14 rounded-md" /> : null}
          {chevron ? <SkeletonIcon className="rounded-full" /> : null}
        </ItemActions>
      ) : null}
    </Item>
  )
}

export function ObjectRowSkeletonGroup({ count = 3, ...props }: ObjectRowSkeletonProps & { count?: number }) {
  return (
    <ItemGroup className="gap-1">
      {Array.from({ length: count }, (_, index) => (
        <ObjectRowSkeleton key={index} {...props} />
      ))}
    </ItemGroup>
  )
}

export function SectionHeaderSkeleton({ action = false, className, description = true }: SectionHeaderSkeletonProps) {
  return (
    <div className={cn("flex min-w-0 items-start justify-between gap-3 px-1", className)}>
      <div className="grid min-w-0 gap-1">
        <SkeletonText className="h-3.5 w-20" />
        {description ? <SkeletonText className="w-36 max-w-full" /> : null}
      </div>
      {action ? <Skeleton className="h-6 w-16 shrink-0 rounded-md" /> : null}
    </div>
  )
}
