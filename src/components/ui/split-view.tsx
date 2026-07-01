import * as React from "react"
import { cn } from "@/lib/utils"

type SplitViewPane = "detail" | "list"

interface SplitViewRootProps extends React.ComponentProps<"section"> {
  narrowPane: SplitViewPane
}

function SplitViewRoot({ children, className, narrowPane, ...props }: SplitViewRootProps) {
  return (
    <section
      data-slot="split-view"
      data-narrow-pane={narrowPane}
      className={cn(
        "grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]",
        narrowPane === "detail" && "max-[959px]:grid-rows-[minmax(0,1fr)]",
        className,
      )}
      {...props}
    >
      {children}
    </section>
  )
}

interface SplitViewHeaderProps extends React.ComponentProps<"header"> {
  narrowPane: SplitViewPane
}

function SplitViewHeader({ children, className, narrowPane, ...props }: SplitViewHeaderProps) {
  return (
    <header
      data-slot="split-view-header"
      className={cn(
        "grid min-h-12 gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
        narrowPane === "detail" && "max-[959px]:hidden",
        className,
      )}
      {...props}
    >
      {children}
    </header>
  )
}

interface SplitViewBodyProps extends React.ComponentProps<"div"> {
  desktopLayout?: "default" | "narrow-list" | "single"
}

function SplitViewBody({ children, className, desktopLayout = "default", ...props }: SplitViewBodyProps) {
  return (
    <div
      data-slot="split-view-body"
      className={cn(
        "grid min-h-0 overflow-hidden",
        desktopLayout === "default" && "min-[960px]:grid-cols-[minmax(0,1fr)_minmax(24rem,min(46%,34rem))]",
        desktopLayout === "narrow-list" && "min-[960px]:grid-cols-[minmax(24rem,31rem)_minmax(22rem,1fr)]",
        desktopLayout === "single" && "min-[960px]:grid-cols-[minmax(0,1fr)]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

interface SplitViewListPaneProps extends React.ComponentProps<"div"> {
  narrowPane: SplitViewPane
}

const SplitViewListPane = React.forwardRef<HTMLDivElement, SplitViewListPaneProps>(function SplitViewListPane(
  { children, className, narrowPane, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      data-slot="split-view-list"
      className={cn(
        "min-h-0 overflow-auto px-3 pb-2 min-[960px]:block min-[960px]:pb-3",
        narrowPane === "detail" && "max-[959px]:hidden",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
})

interface SplitViewMobileDetailPaneProps extends React.ComponentProps<"aside"> {
  narrowPane: SplitViewPane
}

function SplitViewMobileDetailPane({ children, className, narrowPane, ...props }: SplitViewMobileDetailPaneProps) {
  return (
    <aside
      data-slot="split-view-mobile-detail"
      className={cn(
        "min-h-0 overflow-auto p-3 min-[960px]:hidden",
        narrowPane === "list" && "max-[959px]:hidden",
        className,
      )}
      {...props}
    >
      {children}
    </aside>
  )
}

function SplitViewDesktopDetailPane({ children, className, ...props }: React.ComponentProps<"aside">) {
  return (
    <aside
      data-slot="split-view-desktop-detail"
      className={cn(
        "oo-border-divider hidden min-h-0 min-w-0 overflow-x-hidden overflow-y-auto border-l p-3 min-[960px]:block",
        className,
      )}
      {...props}
    >
      {children}
    </aside>
  )
}

export {
  SplitViewBody,
  SplitViewDesktopDetailPane,
  SplitViewHeader,
  SplitViewListPane,
  SplitViewMobileDetailPane,
  SplitViewRoot,
}
