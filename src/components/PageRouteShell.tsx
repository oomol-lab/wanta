import { ArrowLeftIcon } from "lucide-react"
import * as React from "react"
import { cn } from "@/lib/utils"

export function PageRouteShell({
  backLabel,
  children,
  contentClassName,
  contentLayout = "scroll",
  animateContent = false,
  onBack,
  titlebarActions,
  title,
}: React.PropsWithChildren<{
  backLabel: string
  contentClassName?: string
  contentLayout?: "scroll" | "fill"
  animateContent?: boolean
  onBack: () => void
  titlebarActions?: React.ReactNode
  title?: string
}>) {
  return (
    <div className="grid h-full min-h-0 grid-rows-[var(--app-titlebar-height)_minmax(0,1fr)] bg-background text-foreground">
      <header className="oo-titlebar oo-page-titlebar oo-titlebar-window-controls oo-border-divider flex h-[var(--app-titlebar-height)] shrink-0 items-center border-b [-webkit-app-region:drag]">
        <button
          type="button"
          onClick={onBack}
          className="oo-sidebar-nav-item oo-text-control flex h-8 w-fit items-center gap-2 rounded-md px-2 text-muted-foreground [-webkit-app-region:no-drag] hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          <span>{backLabel}</span>
        </button>
        {title ? (
          <h1 className="oo-text-control ml-4 min-w-0 truncate border-l border-border pl-4 font-medium">{title}</h1>
        ) : null}
        {titlebarActions ? (
          <div className="ml-auto flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">{titlebarActions}</div>
        ) : null}
      </header>

      <main className={cn("min-h-0", contentLayout === "fill" ? "overflow-hidden" : "overflow-y-auto")}>
        <div
          className={cn(
            "mx-auto w-full max-w-[110rem] gap-6 px-10 max-[760px]:px-5",
            title ? "pt-5" : "pt-10 max-[760px]:pt-8",
            contentLayout === "fill" ? "flex h-full min-h-0 flex-col pb-6" : "grid pb-16",
            animateContent && "oo-page-content-enter",
            contentClassName,
          )}
        >
          {children}
        </div>
      </main>
    </div>
  )
}
