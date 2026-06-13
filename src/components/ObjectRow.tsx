import * as React from "react"
import { AppIcons } from "@/components/AppIcons"
import { objectRowLeadingCenterClassName, objectRowLeadingClassName } from "@/components/object-row-styles"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item"
import { cn } from "@/lib/utils"

export type ObjectStatusTone = "attention" | "danger" | "pending" | "ready"

interface ObjectStatusIconProps {
  className?: string
  tone: ObjectStatusTone
}

export function ObjectStatusIcon({ className, tone }: ObjectStatusIconProps) {
  if (tone === "attention") {
    return <AppIcons.status.attention className={cn("oo-status-warning size-4 shrink-0", className)} />
  }

  if (tone === "danger") {
    return <AppIcons.status.attention className={cn("size-4 shrink-0 text-destructive", className)} />
  }

  if (tone === "pending") {
    return <AppIcons.status.pending className={cn("oo-status-pending size-4 shrink-0", className)} />
  }

  return <AppIcons.status.ready className={cn("oo-status-ready size-4 shrink-0", className)} />
}

export type ObjectRowBadgeTone = "attention" | "danger" | "neutral" | "pending"

export interface ObjectRowBadge {
  label: React.ReactNode
  tone?: ObjectRowBadgeTone
}

interface ObjectRowProps {
  badge?: ObjectRowBadge | React.ReactNode
  chevron?: boolean
  className?: string
  icon?: React.ReactNode
  iconAlignment?: "center" | "title"
  meta?: React.ReactNode
  onClick?: () => void
  selected?: boolean
  statusVisibility?: "always" | "auto" | "hidden"
  statusTone: ObjectStatusTone
  subtitle?: React.ReactNode
  title: React.ReactNode
}

export function ObjectRow({
  badge,
  chevron,
  className,
  icon,
  iconAlignment = "title",
  meta,
  onClick,
  selected = false,
  statusVisibility = "auto",
  statusTone,
  subtitle,
  title,
}: ObjectRowProps) {
  const shouldShowChevron = chevron ?? Boolean(onClick)
  const hasTrailing = meta != null || badge != null || shouldShowChevron
  const shouldShowStatusIcon = statusVisibility === "always" || (statusVisibility === "auto" && statusTone !== "ready")
  const leadingAlignment = subtitle && iconAlignment === "title" ? "title" : "center"
  const content = (
    <>
      <ItemMedia className={cn("size-auto gap-2", leadingAlignment === "title" ? "items-start" : "items-center")}>
        {shouldShowStatusIcon ? (
          <span
            className={cn(objectRowLeadingClassName, leadingAlignment === "center" && objectRowLeadingCenterClassName)}
          >
            <ObjectStatusIcon tone={statusTone} />
          </span>
        ) : null}
        {icon ? (
          <span
            className={cn(objectRowLeadingClassName, leadingAlignment === "center" && objectRowLeadingCenterClassName)}
          >
            {icon}
          </span>
        ) : null}
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="max-w-full truncate">{title}</ItemTitle>
        {subtitle ? <ItemDescription className="max-w-full truncate">{subtitle}</ItemDescription> : null}
      </ItemContent>
      {hasTrailing ? (
        <ItemActions className="min-w-0 justify-end gap-3">
          {meta != null ? (
            <span className="min-w-0 truncate text-right text-sm text-muted-foreground">{meta}</span>
          ) : null}
          {badge != null ? renderObjectRowBadge(badge) : null}
          {shouldShowChevron ? <AppIcons.status.navigate className="oo-icon-muted size-4 shrink-0" /> : null}
        </ItemActions>
      ) : null}
    </>
  )
  const rowClassName = cn(
    "w-full min-w-0 gap-3 rounded-md border-0 px-3 py-2.5",
    onClick &&
      "cursor-default text-left hover:bg-[var(--oo-row-hover)] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
    selected && "bg-[var(--oo-row-selected)] text-foreground hover:bg-[var(--oo-row-selected)]",
    className,
  )

  if (!onClick) {
    return (
      <Item role="listitem" size="sm" className={rowClassName}>
        {content}
      </Item>
    )
  }

  return (
    <Item asChild size="sm" className={rowClassName}>
      <Button
        type="button"
        variant="ghost"
        className={cn(
          "h-auto justify-start hover:bg-[var(--oo-row-hover)]",
          selected && "hover:bg-[var(--oo-row-selected)]",
        )}
        onClick={onClick}
      >
        {content}
      </Button>
    </Item>
  )
}

function renderObjectRowBadge(badge: ObjectRowBadge | React.ReactNode): React.ReactNode {
  if (isObjectRowBadge(badge)) {
    return (
      <Badge className={getObjectRowBadgeClassName(badge.tone)} variant={getObjectRowBadgeVariant(badge.tone)}>
        {badge.label}
      </Badge>
    )
  }

  return badge
}

function getObjectRowBadgeVariant(tone: ObjectRowBadgeTone | undefined): React.ComponentProps<typeof Badge>["variant"] {
  switch (tone) {
    case "attention":
      return "outline"
    case "danger":
      return "destructive"
    case "pending":
    case "neutral":
    case undefined:
      return "outline"
  }
}

function getObjectRowBadgeClassName(tone: ObjectRowBadgeTone | undefined): string | undefined {
  if (tone !== "attention") {
    return undefined
  }

  return "border-[var(--oo-warning-border)] bg-[var(--oo-warning-surface)] text-[var(--oo-warning-foreground)]"
}

function isObjectRowBadge(value: ObjectRowBadge | React.ReactNode): value is ObjectRowBadge {
  return Boolean(value && typeof value === "object" && !React.isValidElement(value) && "label" in value)
}
